"""
Answer questions about dbt project models using an LLM.

Supports two manifest sources:
  - "github": fetches manifest.json from a GitHub repository via API
  - "cloud":  fetches the latest artifact from dbt Cloud API

After resolving the manifest, delegates query execution to ask_sql logic.
"""
from typing import Any
import asyncio
import base64
import json
import httpx


async def _fetch_manifest_from_github(
    token: str | None,
    repo: str,
    branch: str,
    manifest_path: str,
) -> dict:
    """Download and parse manifest.json from a GitHub repository."""
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://api.github.com/repos/{repo}/contents/{manifest_path}?ref={branch}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code == 401:
        raise ValueError("GitHub authentication failed. Check the token.")
    if resp.status_code == 404:
        raise ValueError(f"manifest.json not found at '{manifest_path}' in {repo}@{branch}.")
    if resp.status_code != 200:
        raise ValueError(f"GitHub API error {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    encoding = data.get("encoding", "")
    content = data.get("content", "")
    if encoding == "base64":
        raw = base64.b64decode(content).decode("utf-8")
    else:
        raw = content
    return json.loads(raw)


async def _fetch_manifest_from_dbt_cloud(
    token: str,
    account_id: str,
    job_id: str,
) -> dict:
    """Download manifest.json artifact from the latest completed dbt Cloud run for a job."""
    headers = {"Authorization": f"Token {token}"}
    base = "https://cloud.getdbt.com/api/v2"
    # Find latest completed run for job
    runs_url = f"{base}/accounts/{account_id}/runs/?job_definition_id={job_id}&order_by=-finished_at&limit=1"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(runs_url, headers=headers)
    if resp.status_code == 401:
        raise ValueError("dbt Cloud authentication failed. Check the service token.")
    if resp.status_code != 200:
        raise ValueError(f"dbt Cloud API error {resp.status_code}: {resp.text[:200]}")
    runs_data = resp.json()
    runs = runs_data.get("data", [])
    if not runs:
        raise ValueError(f"No completed runs found for job {job_id}.")
    run_id = runs[0]["id"]
    # Fetch manifest artifact
    artifact_url = f"{base}/accounts/{account_id}/runs/{run_id}/artifacts/manifest.json"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(artifact_url, headers=headers)
    if resp.status_code != 200:
        raise ValueError(f"dbt Cloud artifact error {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _extract_table_infos_from_manifest(
    manifest: dict,
    selected_models: list[str] | None = None,
) -> list[dict]:
    """
    Parse dbt manifest nodes to build table_infos compatible with ask_sql.

    Returns [{"table": "model_name", "columns": ["col1", ...], "description": "..."}]
    """
    nodes = manifest.get("nodes", {})
    sources = manifest.get("sources", {})
    table_infos: list[dict] = []

    def _columns_from_node(node: dict) -> list[str]:
        raw = node.get("columns", {})
        if isinstance(raw, dict):
            return list(raw.keys())
        if isinstance(raw, list):
            return [c.get("name", "") if isinstance(c, dict) else str(c) for c in raw]
        return []

    for key, node in nodes.items():
        resource_type = node.get("resource_type", "")
        if resource_type not in ("model", "seed", "snapshot"):
            continue
        name = node.get("name") or node.get("alias") or key.split(".")[-1]
        if selected_models and name not in selected_models:
            continue
        cols = _columns_from_node(node)
        description = node.get("description") or ""
        table_infos.append({"table": name, "columns": cols, "description": description})

    for key, node in sources.items():
        name = node.get("name") or key.split(".")[-1]
        if selected_models and name not in selected_models:
            continue
        cols = _columns_from_node(node)
        description = node.get("description") or ""
        table_infos.append({"table": name, "columns": cols, "description": description})

    return table_infos


async def ask_dbt(
    project_source: str,
    connection_string: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    # GitHub source params
    github_token: str | None = None,
    github_repo: str = "",
    github_branch: str = "main",
    manifest_path: str = "target/manifest.json",
    # dbt Cloud params
    dbt_cloud_token: str | None = None,
    dbt_cloud_account_id: str = "",
    dbt_cloud_job_id: str = "",
    # Shared
    selected_models: list[str] | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
    sql_mode: bool = False,
) -> dict[str, Any]:
    """
    Main entry point for dbt source questions.

    Resolves the dbt manifest (from GitHub or dbt Cloud) if table_infos is not
    already cached, then delegates to ask_sql for query generation and execution.
    """
    from app.scripts.ask_sql import ask_sql

    # Resolve table_infos from manifest if not cached
    if not table_infos:
        if project_source == "github":
            if not github_repo:
                raise ValueError("githubRepo is required for GitHub dbt source.")
            manifest = await _fetch_manifest_from_github(
                token=github_token,
                repo=github_repo,
                branch=github_branch or "main",
                manifest_path=manifest_path or "target/manifest.json",
            )
        elif project_source == "cloud":
            if not dbt_cloud_token or not dbt_cloud_account_id or not dbt_cloud_job_id:
                raise ValueError("dbtCloudToken, dbtCloudAccountId and dbtCloudJobId are required for dbt Cloud source.")
            manifest = await _fetch_manifest_from_dbt_cloud(
                token=dbt_cloud_token,
                account_id=dbt_cloud_account_id,
                job_id=dbt_cloud_job_id,
            )
        else:
            raise ValueError(f"Unknown projectSource: '{project_source}'. Use 'github' or 'cloud'.")

        table_infos = _extract_table_infos_from_manifest(manifest, selected_models)

    if not connection_string:
        raise ValueError("connectionString is required to query dbt models.")

    return await ask_sql(
        connection_string=connection_string,
        question=question,
        agent_description=agent_description,
        source_name=source_name,
        table_infos=table_infos,
        llm_overrides=llm_overrides,
        history=history,
        channel=channel,
        sql_mode=sql_mode,
    )
