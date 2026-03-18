"""
Jira Q&A: fetch Jira issues, projects, sprints, worklogs, changelogs,
users, and boards via REST API, load into a local SQLite DB, then use
LLM + SQL to answer natural language questions.
"""
from typing import Any
import asyncio
import base64
import json
import re
import sqlite3
import tempfile

import httpx

JIRA_REST_BASE = "https://{domain}.atlassian.net/rest/api/3"
JIRA_AGILE_BASE = "https://{domain}.atlassian.net/rest/agile/1.0"


def _jira_headers(email: str, api_token: str) -> dict:
    """Build Basic auth headers for Jira Cloud."""
    encoded = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    return {
        "Authorization": f"Basic {encoded}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _test_connection_sync(domain: str, email: str, api_token: str) -> dict:
    """Test if Jira credentials are valid by fetching /myself."""
    url = JIRA_REST_BASE.format(domain=domain) + "/myself"
    with httpx.Client(timeout=15) as client:
        r = client.get(url, headers=_jira_headers(email, api_token))
        r.raise_for_status()
        return r.json()


def _paginate_jira(
    client: httpx.Client,
    url: str,
    headers: dict,
    results_key: str,
    max_results: int = 1000,
    params: dict | None = None,
) -> list[dict]:
    """Generic offset-based pagination for Jira REST endpoints."""
    all_results: list[dict] = []
    start_at = 0
    page_size = 100
    while True:
        p = dict(params or {})
        p["startAt"] = start_at
        p["maxResults"] = page_size
        r = client.get(url, headers=headers, params=p)
        r.raise_for_status()
        data = r.json()
        items = data.get(results_key, [])
        if isinstance(items, list):
            all_results.extend(items)
        else:
            break
        total = data.get("total", len(all_results))
        start_at += len(items)
        if start_at >= total or len(items) == 0 or len(all_results) >= max_results:
            break
    return all_results[:max_results]


def _paginate_agile(
    client: httpx.Client,
    url: str,
    headers: dict,
    results_key: str,
    max_results: int = 1000,
) -> list[dict]:
    """Pagination for Jira Agile endpoints (isLast-based)."""
    all_results: list[dict] = []
    start_at = 0
    page_size = 50
    while True:
        p = {"startAt": start_at, "maxResults": page_size}
        r = client.get(url, headers=headers, params=p)
        r.raise_for_status()
        data = r.json()
        items = data.get(results_key, [])
        all_results.extend(items)
        if data.get("isLast", True) or len(items) == 0 or len(all_results) >= max_results:
            break
        start_at += len(items)
    return all_results[:max_results]


# ── Data fetching helpers ─────────────────────────────────────────────

def _fetch_projects(client: httpx.Client, base: str, headers: dict) -> list[dict]:
    return _paginate_jira(client, f"{base}/project/search", headers, "values")


def _fetch_boards(client: httpx.Client, agile_base: str, headers: dict) -> list[dict]:
    return _paginate_agile(client, f"{agile_base}/board", headers, "values")


def _fetch_issues(client: httpx.Client, base: str, headers: dict, max_results: int = 2000) -> list[dict]:
    return _paginate_jira(
        client,
        f"{base}/search",
        headers,
        "issues",
        max_results=max_results,
        params={"jql": "ORDER BY created DESC", "fields": "*all", "expand": "changelog"},
    )


def _fetch_sprints_for_board(client: httpx.Client, agile_base: str, headers: dict, board_id: int) -> list[dict]:
    try:
        return _paginate_agile(client, f"{agile_base}/board/{board_id}/sprint", headers, "values")
    except httpx.HTTPStatusError:
        return []


def _fetch_sprint_issues(client: httpx.Client, agile_base: str, headers: dict, sprint_id: int) -> list[dict]:
    try:
        return _paginate_jira(
            client, f"{agile_base}/sprint/{sprint_id}/issue", headers, "issues", max_results=500,
        )
    except httpx.HTTPStatusError:
        return []


def _fetch_users(client: httpx.Client, base: str, headers: dict) -> list[dict]:
    try:
        r = client.get(f"{base}/users/search", headers=headers, params={"maxResults": 1000})
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError:
        return []


# ── SQLite loader ─────────────────────────────────────────────────────

def _create_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            key TEXT,
            name TEXT,
            project_type TEXT,
            style TEXT,
            is_private INTEGER
        );
        CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            project_key TEXT
        );
        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            key TEXT,
            summary TEXT,
            status TEXT,
            status_category TEXT,
            issue_type TEXT,
            priority TEXT,
            assignee TEXT,
            assignee_email TEXT,
            reporter TEXT,
            reporter_email TEXT,
            project_key TEXT,
            created TEXT,
            updated TEXT,
            resolved TEXT,
            due_date TEXT,
            story_points REAL,
            labels TEXT,
            components TEXT,
            fix_versions TEXT,
            time_spent_seconds INTEGER,
            time_estimate_seconds INTEGER
        );
        CREATE TABLE IF NOT EXISTS sprints (
            id INTEGER PRIMARY KEY,
            name TEXT,
            state TEXT,
            board_id INTEGER,
            start_date TEXT,
            end_date TEXT,
            complete_date TEXT,
            goal TEXT
        );
        CREATE TABLE IF NOT EXISTS sprint_issues (
            sprint_id INTEGER,
            issue_id TEXT,
            issue_key TEXT,
            PRIMARY KEY (sprint_id, issue_id)
        );
        CREATE TABLE IF NOT EXISTS worklogs (
            id TEXT PRIMARY KEY,
            issue_id TEXT,
            issue_key TEXT,
            author TEXT,
            author_email TEXT,
            started TEXT,
            time_spent_seconds INTEGER,
            comment TEXT
        );
        CREATE TABLE IF NOT EXISTS changelogs (
            id TEXT PRIMARY KEY,
            issue_id TEXT,
            issue_key TEXT,
            author TEXT,
            author_email TEXT,
            created TEXT,
            field TEXT,
            from_value TEXT,
            to_value TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
            account_id TEXT PRIMARY KEY,
            display_name TEXT,
            email TEXT,
            active INTEGER,
            account_type TEXT
        );
    """)


def _insert_projects(conn: sqlite3.Connection, projects: list[dict]) -> None:
    for p in projects:
        conn.execute(
            "INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?)",
            (
                p.get("id", ""),
                p.get("key", ""),
                p.get("name", ""),
                p.get("projectTypeKey", ""),
                p.get("style", ""),
                1 if p.get("isPrivate") else 0,
            ),
        )


def _insert_boards(conn: sqlite3.Connection, boards: list[dict]) -> None:
    for b in boards:
        loc = b.get("location", {}) or {}
        conn.execute(
            "INSERT OR REPLACE INTO boards VALUES (?,?,?,?)",
            (
                b.get("id", 0),
                b.get("name", ""),
                b.get("type", ""),
                loc.get("projectKey", ""),
            ),
        )


def _insert_issues(conn: sqlite3.Connection, issues: list[dict]) -> list[dict]:
    """Insert issues and return extracted worklogs + changelogs."""
    all_worklogs: list[dict] = []
    all_changelogs: list[dict] = []
    for issue in issues:
        fields = issue.get("fields", {})
        assignee = fields.get("assignee") or {}
        reporter = fields.get("reporter") or {}
        status = fields.get("status") or {}
        status_cat = (status.get("statusCategory") or {}).get("name", "")
        priority = (fields.get("priority") or {}).get("name", "")
        issue_type = (fields.get("issuetype") or {}).get("name", "")
        labels = ",".join(fields.get("labels", []))
        components = ",".join(c.get("name", "") for c in (fields.get("components") or []))
        fix_versions = ",".join(v.get("name", "") for v in (fields.get("fixVersions") or []))
        # Story points: check common custom field names
        story_points = None
        for key in ("story_points", "customfield_10028", "customfield_10016"):
            if fields.get(key) is not None:
                try:
                    story_points = float(fields[key])
                except (ValueError, TypeError):
                    pass
                break

        conn.execute(
            "INSERT OR REPLACE INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                issue.get("id", ""),
                issue.get("key", ""),
                fields.get("summary", ""),
                status.get("name", ""),
                status_cat,
                issue_type,
                priority,
                assignee.get("displayName", ""),
                assignee.get("emailAddress", ""),
                reporter.get("displayName", ""),
                reporter.get("emailAddress", ""),
                (fields.get("project") or {}).get("key", ""),
                fields.get("created", ""),
                fields.get("updated", ""),
                fields.get("resolutiondate", ""),
                fields.get("duedate", ""),
                story_points,
                labels,
                components,
                fix_versions,
                fields.get("timespent"),
                fields.get("timeoriginalestimate"),
            ),
        )

        # Worklogs (embedded in fields)
        worklog_data = (fields.get("worklog") or {}).get("worklogs", [])
        for wl in worklog_data:
            wl_author = wl.get("author") or {}
            all_worklogs.append({
                "id": wl.get("id", ""),
                "issue_id": issue.get("id", ""),
                "issue_key": issue.get("key", ""),
                "author": wl_author.get("displayName", ""),
                "author_email": wl_author.get("emailAddress", ""),
                "started": wl.get("started", ""),
                "time_spent_seconds": wl.get("timeSpentSeconds", 0),
                "comment": "",
            })

        # Changelogs (from expand=changelog)
        changelog = (issue.get("changelog") or {}).get("histories", [])
        for history in changelog:
            h_author = history.get("author") or {}
            for item in history.get("items", []):
                all_changelogs.append({
                    "id": f"{history.get('id', '')}_{item.get('field', '')}",
                    "issue_id": issue.get("id", ""),
                    "issue_key": issue.get("key", ""),
                    "author": h_author.get("displayName", ""),
                    "author_email": h_author.get("emailAddress", ""),
                    "created": history.get("created", ""),
                    "field": item.get("field", ""),
                    "from_value": item.get("fromString", ""),
                    "to_value": item.get("toString", ""),
                })

    return all_worklogs, all_changelogs


def _insert_sprints(conn: sqlite3.Connection, sprints: list[dict]) -> None:
    for s in sprints:
        conn.execute(
            "INSERT OR REPLACE INTO sprints VALUES (?,?,?,?,?,?,?,?)",
            (
                s.get("id", 0),
                s.get("name", ""),
                s.get("state", ""),
                s.get("originBoardId", 0),
                s.get("startDate", ""),
                s.get("endDate", ""),
                s.get("completeDate", ""),
                s.get("goal", ""),
            ),
        )


def _insert_sprint_issues(conn: sqlite3.Connection, sprint_id: int, issues: list[dict]) -> None:
    for issue in issues:
        conn.execute(
            "INSERT OR REPLACE INTO sprint_issues VALUES (?,?,?)",
            (sprint_id, issue.get("id", ""), issue.get("key", "")),
        )


def _insert_worklogs(conn: sqlite3.Connection, worklogs: list[dict]) -> None:
    for wl in worklogs:
        conn.execute(
            "INSERT OR REPLACE INTO worklogs VALUES (?,?,?,?,?,?,?,?)",
            (
                wl["id"], wl["issue_id"], wl["issue_key"],
                wl["author"], wl["author_email"],
                wl["started"], wl["time_spent_seconds"], wl.get("comment", ""),
            ),
        )


def _insert_changelogs(conn: sqlite3.Connection, changelogs: list[dict]) -> None:
    for cl in changelogs:
        conn.execute(
            "INSERT OR REPLACE INTO changelogs VALUES (?,?,?,?,?,?,?,?,?)",
            (
                cl["id"], cl["issue_id"], cl["issue_key"],
                cl["author"], cl["author_email"],
                cl["created"], cl["field"], cl["from_value"], cl["to_value"],
            ),
        )


def _insert_users(conn: sqlite3.Connection, users: list[dict]) -> None:
    for u in users:
        conn.execute(
            "INSERT OR REPLACE INTO users VALUES (?,?,?,?,?)",
            (
                u.get("accountId", ""),
                u.get("displayName", ""),
                u.get("emailAddress", ""),
                1 if u.get("active") else 0,
                u.get("accountType", ""),
            ),
        )


# ── Full data fetch + load ────────────────────────────────────────────

def _fetch_and_load_sync(domain: str, email: str, api_token: str) -> str:
    """Fetch all Jira data and load into a temporary SQLite database.
    Returns the path to the temp SQLite file."""
    base = JIRA_REST_BASE.format(domain=domain)
    agile_base = JIRA_AGILE_BASE.format(domain=domain)
    headers = _jira_headers(email, api_token)

    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = db_file.name
    db_file.close()

    conn = sqlite3.connect(db_path)
    _create_tables(conn)

    with httpx.Client(timeout=30) as client:
        # Projects
        projects = _fetch_projects(client, base, headers)
        _insert_projects(conn, projects)

        # Boards
        boards = _fetch_boards(client, agile_base, headers)
        _insert_boards(conn, boards)

        # Issues (with embedded worklogs + changelogs)
        issues = _fetch_issues(client, base, headers)
        worklogs, changelogs = _insert_issues(conn, issues)
        _insert_worklogs(conn, worklogs)
        _insert_changelogs(conn, changelogs)

        # Sprints per board + sprint issues
        all_sprints: list[dict] = []
        for board in boards:
            board_sprints = _fetch_sprints_for_board(client, agile_base, headers, board["id"])
            all_sprints.extend(board_sprints)
        _insert_sprints(conn, all_sprints)

        for sprint in all_sprints:
            si = _fetch_sprint_issues(client, agile_base, headers, sprint["id"])
            _insert_sprint_issues(conn, sprint["id"], si)

        # Users
        users = _fetch_users(client, base, headers)
        _insert_users(conn, users)

    conn.commit()
    conn.close()
    return db_path


def _get_schema_text(db_path: str) -> str:
    """Get a description of all tables and their schemas from the SQLite DB."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]

    parts = ["Jira Data (SQLite database with the following tables):"]
    for table in tables:
        cursor.execute(f"PRAGMA table_info({table})")
        cols = cursor.fetchall()
        col_desc = ", ".join(f"{c[1]} ({c[2]})" for c in cols)
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        parts.append(f"  - {table} ({count} rows): {col_desc}")

    conn.close()
    return "\n".join(parts)


def _run_sql(db_path: str, sql: str) -> list[dict]:
    """Execute SQL on the temp SQLite database, return rows as dicts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(sql)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def _discover_sync(domain: str, email: str, api_token: str) -> dict:
    """Discover Jira projects and boards for the source form."""
    base = JIRA_REST_BASE.format(domain=domain)
    agile_base = JIRA_AGILE_BASE.format(domain=domain)
    headers = _jira_headers(email, api_token)

    with httpx.Client(timeout=15) as client:
        projects = _fetch_projects(client, base, headers)
        boards = _fetch_boards(client, agile_base, headers)

    return {
        "projects": [{"id": p.get("id"), "key": p.get("key"), "name": p.get("name")} for p in projects],
        "boards": [{"id": b.get("id"), "name": b.get("name"), "type": b.get("type")} for b in boards],
    }


# ── Report templates ──────────────────────────────────────────────────

JIRA_REPORT_TEMPLATES = [
    {
        "id": "jira_sprint_report",
        "name": "Sprint Report",
        "description": "Summary of sprint progress: completed vs remaining issues, velocity, and burndown data.",
    },
    {
        "id": "jira_issue_breakdown",
        "name": "Issue Breakdown",
        "description": "Issue distribution by type, status, priority, and project.",
    },
    {
        "id": "jira_team_workload",
        "name": "Team Workload",
        "description": "Work distribution across team members: assigned issues, logged hours, and completion rates.",
    },
    {
        "id": "jira_cycle_time",
        "name": "Cycle Time",
        "description": "Measure how long issues take from creation to resolution, grouped by type and priority.",
    },
    {
        "id": "jira_bug_tracking",
        "name": "Bug Tracking",
        "description": "Track open bugs by severity, project, assignee, and resolution trends over time.",
    },
]


# ── Main ask entry point ──────────────────────────────────────────────

async def ask_jira(
    domain: str,
    email: str,
    api_token: str,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Jira Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    loop = asyncio.get_event_loop()

    # Fetch all Jira data into a temp SQLite DB
    db_path = await loop.run_in_executor(
        None, lambda: _fetch_and_load_sync(domain, email, api_token)
    )

    schema_text = _get_schema_text(db_path)

    system = (
        "You are a data analyst assistant. The user has Jira project management data loaded "
        "into a SQLite database. You are given the database schema below.\n"
        "Answer the question by writing a SQL query that retrieves the answer from the database.\n"
        "Return ONLY valid JSON with keys: "
        '"answer" (string - a brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"sql" (string - a SQLite-compatible SQL query to compute the answer, or null if not needed). '
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append(
        {"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"}
    )

    raw_answer, usage, trace = await chat_completion(
        messages, max_tokens=2048, llm_overrides=llm_overrides
    )
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "jira"
    await record_log(
        action="pergunta",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )

    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_code = (parsed.get("sql") or "").strip()

    chart_input = None
    if sql_code:
        try:
            result_rows = await loop.run_in_executor(
                None, lambda: _run_sql(db_path, sql_code)
            )
            if result_rows:
                chart_input = build_chart_input(result_rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=result_rows,
                    agent_description=agent_description,
                    source_name=source_name,
                    schema_text=schema_text,
                    llm_overrides=llm_overrides,
                    channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Error executing SQL on Jira data: {e}*"

    # Cleanup temp file
    try:
        import os
        os.unlink(db_path)
    except OSError:
        pass

    if not parsed["parsed_ok"]:
        if not answer:
            answer = raw_answer
        if not follow_up:
            follow_up = _extract_followups(raw_answer)

    follow_up = await refine_followup_questions(
        question=question,
        candidate_questions=follow_up,
        schema_text=schema_text,
        llm_overrides=llm_overrides,
        channel=channel,
    )
    return {
        "answer": answer,
        "imageUrl": None,
        "followUpQuestions": follow_up,
        "chartInput": chart_input,
    }


# ── JSON parsing helpers (same as other integrations) ─────────────────

def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data: Any, parsed_ok: bool) -> dict[str, Any]:
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_code = data.get("sql") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_code, str):
            sql_code = ""
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "sql": sql_code,
            "parsed_ok": parsed_ok,
        }

    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        return _coerce(json.loads(raw_clean), True)
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return _coerce(json.loads(raw_clean[start : end + 1]), True)
            except json.JSONDecodeError:
                pass
        return _coerce({}, False)


def _extract_followups(raw: str) -> list[str]:
    follow_up = []
    for line in raw.split("\n"):
        cleaned = line.strip().lstrip("-0123456789. ").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
