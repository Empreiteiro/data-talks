"""Static lint: every query against a tenant-scoped model must include
either `tenant_filter(Model, …)` or an explicit `Model.organization_id ==`
predicate in its `WHERE` clause.

Runs as a normal pytest so it ships in CI. It is AST-based, not regex —
so `select(Source).where(foo == 1)` triggers a failure, while
`select(Source).where(tenant_filter(Source, scope), Source.id == sid)`
passes.

The rule is **additive**: user_id filters are still allowed (and often
present) but a tenant filter is now mandatory.

A per-file allowlist (`ALLOW_FILES`) exempts modules that legitimately
need to query across tenants (the auth_router resolving the active org,
the multi-tenant test suite itself, the migration scripts, etc.).
"""
from __future__ import annotations

import ast
import pathlib
from typing import Iterable

import pytest


ROOT = pathlib.Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"

# SQLAlchemy models that carry `organization_id` and therefore must be
# filtered by the caller's tenant on every read/write.
TENANT_SCOPED_MODELS: frozenset[str] = frozenset({
    "Source",
    "Agent",
    "PipelineRun",
    "PipelineVersion",
    "LineageEdge",
    "ApiKey",
    "GithubConnection",
    "QASession",
    "Dashboard",
    "DashboardChart",
    "Alert",
    "AlertExecution",
})

# Files allowed to query those models without a tenant filter. Each entry
# MUST include a `why` comment so future contributors know whether to add
# a new exception or fix the code. Paths are relative to the backend/ root.
ALLOW_FILES: dict[str, str] = {
    # The tenancy test suite deliberately probes cross-org access.
    "tests/test_tenancy.py": "test fixtures deliberately seed cross-tenant data",
    "tests/test_pipeline_versioning.py": "test seeds single-tenant data directly",
    "tests/test_lineage.py": "tracker unit tests operate on scope-less sessions",
    "tests/test_storage.py": "storage tests don't touch models",
    "tests/test_tenancy_lint.py": "this file",
    # auth_router needs to look up memberships and user's orgs globally
    # before the tenant scope has been established.
    "app/routers/auth_router.py": "resolves the active org on login/switch-org",
    # The MCP scope resolver looks up an ApiKey by hash before knowing the
    # tenant; the key itself identifies the tenant.
    "app/mcp_server.py": "resolves the caller's tenant from the API key",
    # Core auth dependency: looks up ApiKey / memberships before scope exists.
    "app/auth.py": "core scope resolver — by definition runs before tenant is known",
    # Lineage service filters by run_id which is already tenant-scoped
    # through the PipelineRun row.
    "app/services/lineage.py": "edges inherit tenant via their parent run",
    # Audit router filters by organization_id but on a generic model that
    # doesn't live in the scoped list — skip for now.
    "app/routers/audit_router.py": "audit log tenant filter applied separately",
    # Public API gets its scope from the API key; filter is applied via
    # key.organization_id but not through a Model.organization_id predicate.
    "app/routers/public_api_router.py": "scope resolved via ApiKey",
    # Pipeline versioning service: callers pass an already-scoped agent_id
    # (validated by _require_agent in the router). The queries narrow by
    # agent_id + pipeline_id, which transitively enforces the tenant.
    "app/services/pipeline_versioning.py": "agent_id is pre-validated to belong to the caller's org",
    # Alert scheduler: background worker that scans ALL alerts to fire
    # them on schedule. Cross-tenant by design; no caller context.
    "app/services/alert_scheduler.py": "background scheduler scans all tenants' alerts by design",
}


def _iter_python_files() -> Iterable[pathlib.Path]:
    for path in APP_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        yield path


def _rel(path: pathlib.Path) -> str:
    return path.relative_to(ROOT).as_posix()


class _SelectVisitor(ast.NodeVisitor):
    """Finds each `select(<Model>)` call-chain and checks that the chain
    applies either `tenant_filter(<Model>, ...)` or `<Model>.organization_id == ...`
    somewhere inside its `.where(...)`, `.filter(...)`, or `.where_and(...)`
    invocations."""

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.violations: list[tuple[int, str, str]] = []  # (lineno, model, snippet)

    def visit_Call(self, node: ast.Call) -> None:
        # Flatten attribute chains so we can walk `.where().where().filter()`.
        chain = _chain_of_calls(node)
        if not chain:
            self.generic_visit(node)
            return

        root_call = chain[0]
        if not _is_select_call(root_call):
            self.generic_visit(node)
            return

        tenant_models = [m for m in _models_in_select(root_call) if m in TENANT_SCOPED_MODELS]
        if not tenant_models:
            self.generic_visit(node)
            return

        # Collect all filter expressions across the chain.
        filter_exprs: list[ast.expr] = []
        for call in chain[1:]:
            if isinstance(call.func, ast.Attribute) and call.func.attr in (
                "where",
                "filter",
                "filter_by",
            ):
                filter_exprs.extend(call.args)

        for model in tenant_models:
            if not _filters_have_tenant_check(filter_exprs, model):
                self.violations.append(
                    (node.lineno, model, ast.unparse(node)[:140]),
                )

        # Don't recurse into this chain again — its inner calls were already
        # considered as part of the chain walk above.


def _chain_of_calls(node: ast.Call) -> list[ast.Call]:
    """Walk back through `.where(...).where(...).filter(...)` and return
    [root_select_call, where1, where2, ...]. Returns [] when the outermost
    call is not itself a chain of attributes."""
    chain: list[ast.Call] = [node]
    current = node.func
    while isinstance(current, ast.Attribute):
        parent = current.value
        if isinstance(parent, ast.Call):
            chain.append(parent)
            current = parent.func
        else:
            break
    chain.reverse()
    return chain


def _is_select_call(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name) and func.id == "select":
        return True
    if isinstance(func, ast.Attribute) and func.attr == "select":
        return True
    return False


def _models_in_select(call: ast.Call) -> list[str]:
    out: list[str] = []
    for arg in call.args:
        if isinstance(arg, ast.Name):
            out.append(arg.id)
        elif isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name):
            # e.g. select(Source.id) — first Name walk yields the model
            out.append(arg.value.id)
    return out


def _filters_have_tenant_check(exprs: list[ast.expr], model: str) -> bool:
    for e in exprs:
        if _contains_tenant_check(e, model):
            return True
    return False


def _contains_tenant_check(node: ast.AST, model: str) -> bool:
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == "tenant_filter"
            and child.args
            and isinstance(child.args[0], ast.Name)
            and child.args[0].id == model
        ):
            return True
        if (
            isinstance(child, ast.Compare)
            and isinstance(child.left, ast.Attribute)
            and isinstance(child.left.value, ast.Name)
            and child.left.value.id == model
            and child.left.attr == "organization_id"
        ):
            return True
    return False


def test_no_tenant_scoped_query_misses_organization_filter():
    violations: list[str] = []
    for path in _iter_python_files():
        rel = _rel(path)
        if rel in ALLOW_FILES:
            continue
        try:
            tree = ast.parse(path.read_text(), filename=rel)
        except SyntaxError:
            continue  # not our problem here
        visitor = _SelectVisitor(rel)
        visitor.visit(tree)
        for lineno, model, snippet in visitor.violations:
            violations.append(f"{rel}:{lineno} select({model}) without tenant filter — {snippet}")

    if violations:
        formatted = "\n".join(f"  - {v}" for v in violations)
        allow_hint = (
            "\n\nIf this query genuinely needs to span tenants, add the file "
            "path to ALLOW_FILES in tests/test_tenancy_lint.py with a short "
            "`why` comment. Otherwise apply `tenant_filter(<Model>, scope)` "
            "or a `<Model>.organization_id == ...` predicate."
        )
        pytest.fail(
            f"Found {len(violations)} tenant-scoped query without organization filter:\n{formatted}{allow_hint}"
        )


def test_allowlist_stays_minimal():
    """Snapshot test so we notice when someone adds new exceptions. Keep
    ALLOW_FILES small — every entry is a place where a bug could hide
    behind 'trust me, this one's fine'."""
    # Bump this ceiling intentionally in the same commit that adds a new
    # entry to ALLOW_FILES so reviewers catch the expansion.
    assert len(ALLOW_FILES) <= 14, (
        f"ALLOW_FILES has grown to {len(ALLOW_FILES)} entries. "
        "Review the list; each bypasses the multi-tenant lint."
    )
