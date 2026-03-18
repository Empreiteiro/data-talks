"""
GitHub Analytics Q&A: fetch repository data via GitHub REST API,
normalize to tabular data, then use LLM + SQLite to answer natural
language questions.
"""
from typing import Any
import asyncio
import json
import re
import sqlite3
import tempfile

import httpx

GITHUB_API_BASE = "https://api.github.com"

GITHUB_ANALYTICS_TABLES = [
    "repositories",
    "pull_requests",
    "issues",
    "commits",
    "releases",
    "workflows",
    "workflow_runs",
    "contributors",
]

REPORT_TEMPLATES = [
    {
        "name": "PR Metrics",
        "description": "Pull request throughput, merge time, and review cycle analysis",
        "questions": [
            "How many pull requests were opened and merged this month?",
            "What is the average time to merge a pull request?",
            "Which contributors open the most pull requests?",
        ],
    },
    {
        "name": "Issue Tracking",
        "description": "Issue volume, resolution rate, and label distribution",
        "questions": [
            "How many issues are currently open vs closed?",
            "What is the average time to close an issue?",
            "Which labels appear most frequently on issues?",
        ],
    },
    {
        "name": "Commit Activity",
        "description": "Commit frequency, contributor activity, and code velocity",
        "questions": [
            "How many commits were pushed in the last 30 days?",
            "Who are the top 5 contributors by commit count?",
            "What day of the week has the most commits?",
        ],
    },
    {
        "name": "CI/CD Health",
        "description": "Workflow success rate, run duration, and failure analysis",
        "questions": [
            "What is the overall workflow success rate?",
            "Which workflow has the most failures?",
            "What is the average workflow run duration?",
        ],
    },
    {
        "name": "Release Cadence",
        "description": "Release frequency, version progression, and changelog overview",
        "questions": [
            "How many releases were published this year?",
            "What is the average time between releases?",
            "List the last 5 releases with their dates and tag names.",
        ],
    },
]


def _github_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _parse_link_header(link_header: str | None) -> str | None:
    """Parse GitHub Link header to find the next page URL."""
    if not link_header:
        return None
    for part in link_header.split(","):
        if 'rel="next"' in part:
            match = re.search(r"<([^>]+)>", part)
            if match:
                return match.group(1)
    return None


def _fetch_paginated_sync(
    url: str, token: str, max_pages: int = 50
) -> list[dict]:
    """Fetch all pages from a GitHub paginated endpoint using Link header."""
    results = []
    current_url: str | None = url
    page = 0
    with httpx.Client(timeout=30.0) as client:
        while current_url and page < max_pages:
            r = client.get(current_url, headers=_github_headers(token))
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                results.extend(data)
            elif isinstance(data, dict):
                # Some endpoints wrap results (e.g., workflows, workflow_runs)
                for key in ("workflows", "workflow_runs", "items"):
                    if key in data and isinstance(data[key], list):
                        results.extend(data[key])
                        break
                else:
                    results.append(data)
            current_url = _parse_link_header(r.headers.get("link"))
            page += 1
    return results


def _test_connection_sync(token: str, owner: str, repo: str) -> dict:
    """Test GitHub token and repo access, return repo metadata."""
    with httpx.Client(timeout=15.0) as client:
        r = client.get(
            f"{GITHUB_API_BASE}/repos/{owner}/{repo}",
            headers=_github_headers(token),
        )
        r.raise_for_status()
        return r.json()


def _discover_resources_sync(token: str, owner: str, repo: str) -> dict:
    """Discover repo stats for the connection form."""
    repo_data = _test_connection_sync(token, owner, repo)
    return {
        "full_name": repo_data.get("full_name", ""),
        "description": repo_data.get("description", ""),
        "stars": repo_data.get("stargazers_count", 0),
        "forks": repo_data.get("forks_count", 0),
        "open_issues": repo_data.get("open_issues_count", 0),
        "language": repo_data.get("language", ""),
        "default_branch": repo_data.get("default_branch", "main"),
        "visibility": repo_data.get("visibility", ""),
        "tables": GITHUB_ANALYTICS_TABLES,
    }


def _fetch_all_tables_sync(
    token: str, owner: str, repo: str
) -> dict[str, list[dict]]:
    """Fetch data for all 8 tables from GitHub API."""
    base = f"{GITHUB_API_BASE}/repos/{owner}/{repo}"
    tables: dict[str, list[dict]] = {}

    # repositories (single item)
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(base, headers=_github_headers(token))
            r.raise_for_status()
            repo_data = r.json()
        tables["repositories"] = [
            {
                "id": repo_data.get("id"),
                "name": repo_data.get("name"),
                "full_name": repo_data.get("full_name"),
                "description": repo_data.get("description"),
                "language": repo_data.get("language"),
                "stars": repo_data.get("stargazers_count"),
                "forks": repo_data.get("forks_count"),
                "open_issues": repo_data.get("open_issues_count"),
                "watchers": repo_data.get("watchers_count"),
                "default_branch": repo_data.get("default_branch"),
                "visibility": repo_data.get("visibility"),
                "created_at": repo_data.get("created_at"),
                "updated_at": repo_data.get("updated_at"),
                "pushed_at": repo_data.get("pushed_at"),
            }
        ]
    except Exception:
        tables["repositories"] = []

    # pull_requests
    try:
        raw = _fetch_paginated_sync(
            f"{base}/pulls?state=all&per_page=100", token
        )
        tables["pull_requests"] = [
            {
                "id": pr.get("id"),
                "number": pr.get("number"),
                "title": pr.get("title"),
                "state": pr.get("state"),
                "user_login": (pr.get("user") or {}).get("login"),
                "created_at": pr.get("created_at"),
                "updated_at": pr.get("updated_at"),
                "closed_at": pr.get("closed_at"),
                "merged_at": pr.get("merged_at"),
                "draft": pr.get("draft"),
                "labels": ", ".join(
                    l.get("name", "") for l in (pr.get("labels") or [])
                ),
                "base_branch": (pr.get("base") or {}).get("ref"),
                "head_branch": (pr.get("head") or {}).get("ref"),
                "comments": pr.get("comments", 0),
                "review_comments": pr.get("review_comments", 0),
                "additions": pr.get("additions"),
                "deletions": pr.get("deletions"),
                "changed_files": pr.get("changed_files"),
            }
            for pr in raw
        ]
    except Exception:
        tables["pull_requests"] = []

    # issues (filter out PRs)
    try:
        raw = _fetch_paginated_sync(
            f"{base}/issues?state=all&per_page=100", token
        )
        tables["issues"] = [
            {
                "id": issue.get("id"),
                "number": issue.get("number"),
                "title": issue.get("title"),
                "state": issue.get("state"),
                "user_login": (issue.get("user") or {}).get("login"),
                "created_at": issue.get("created_at"),
                "updated_at": issue.get("updated_at"),
                "closed_at": issue.get("closed_at"),
                "labels": ", ".join(
                    l.get("name", "") for l in (issue.get("labels") or [])
                ),
                "comments": issue.get("comments", 0),
                "assignee_login": (issue.get("assignee") or {}).get("login"),
                "milestone": (issue.get("milestone") or {}).get("title"),
                "state_reason": issue.get("state_reason"),
            }
            for issue in raw
            if "pull_request" not in issue
        ]
    except Exception:
        tables["issues"] = []

    # commits
    try:
        raw = _fetch_paginated_sync(
            f"{base}/commits?per_page=100", token
        )
        tables["commits"] = [
            {
                "sha": c.get("sha"),
                "message": (c.get("commit") or {}).get("message", "")[:500],
                "author_name": ((c.get("commit") or {}).get("author") or {}).get("name"),
                "author_email": ((c.get("commit") or {}).get("author") or {}).get("email"),
                "author_login": (c.get("author") or {}).get("login"),
                "committer_login": (c.get("committer") or {}).get("login"),
                "date": ((c.get("commit") or {}).get("author") or {}).get("date"),
                "comment_count": (c.get("commit") or {}).get("comment_count", 0),
            }
            for c in raw
        ]
    except Exception:
        tables["commits"] = []

    # releases
    try:
        raw = _fetch_paginated_sync(
            f"{base}/releases?per_page=100", token
        )
        tables["releases"] = [
            {
                "id": rel.get("id"),
                "tag_name": rel.get("tag_name"),
                "name": rel.get("name"),
                "draft": rel.get("draft"),
                "prerelease": rel.get("prerelease"),
                "created_at": rel.get("created_at"),
                "published_at": rel.get("published_at"),
                "author_login": (rel.get("author") or {}).get("login"),
                "body": (rel.get("body") or "")[:500],
                "asset_count": len(rel.get("assets") or []),
            }
            for rel in raw
        ]
    except Exception:
        tables["releases"] = []

    # workflows
    try:
        raw = _fetch_paginated_sync(
            f"{base}/actions/workflows", token
        )
        tables["workflows"] = [
            {
                "id": wf.get("id"),
                "name": wf.get("name"),
                "path": wf.get("path"),
                "state": wf.get("state"),
                "created_at": wf.get("created_at"),
                "updated_at": wf.get("updated_at"),
            }
            for wf in raw
        ]
    except Exception:
        tables["workflows"] = []

    # workflow_runs
    try:
        raw = _fetch_paginated_sync(
            f"{base}/actions/runs?per_page=100", token
        )
        tables["workflow_runs"] = [
            {
                "id": run.get("id"),
                "name": run.get("name"),
                "workflow_id": run.get("workflow_id"),
                "status": run.get("status"),
                "conclusion": run.get("conclusion"),
                "event": run.get("event"),
                "branch": run.get("head_branch"),
                "actor_login": (run.get("actor") or {}).get("login"),
                "run_number": run.get("run_number"),
                "run_attempt": run.get("run_attempt"),
                "created_at": run.get("created_at"),
                "updated_at": run.get("updated_at"),
                "run_started_at": run.get("run_started_at"),
            }
            for run in raw
        ]
    except Exception:
        tables["workflow_runs"] = []

    # contributors
    try:
        raw = _fetch_paginated_sync(
            f"{base}/contributors?per_page=100", token
        )
        tables["contributors"] = [
            {
                "id": c.get("id"),
                "login": c.get("login"),
                "contributions": c.get("contributions"),
                "type": c.get("type"),
                "site_admin": c.get("site_admin"),
            }
            for c in raw
        ]
    except Exception:
        tables["contributors"] = []

    return tables


def _tables_to_sqlite(tables: dict[str, list[dict]]) -> str:
    """Write tables into a temporary SQLite database, return the file path."""
    import pandas as pd

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    conn = sqlite3.connect(tmp.name)
    for table_name, rows in tables.items():
        if rows:
            df = pd.DataFrame(rows)
            df.to_sql(table_name, conn, if_exists="replace", index=False)
        else:
            conn.execute(f"CREATE TABLE IF NOT EXISTS [{table_name}] (_empty TEXT)")
    conn.close()
    return tmp.name


def _get_schema_text(db_path: str) -> str:
    """Generate a schema description from the SQLite database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    table_names = [r[0] for r in cursor.fetchall()]
    parts = []
    for table in table_names:
        cursor.execute(f"PRAGMA table_info([{table}])")
        cols = cursor.fetchall()
        col_defs = ", ".join(f"{c[1]} ({c[2]})" for c in cols)
        cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
        row_count = cursor.fetchone()[0]
        parts.append(f"Table: {table} ({row_count} rows)\n  Columns: {col_defs}")
    conn.close()
    return "\n".join(parts)


def _run_sql(db_path: str, sql: str, limit: int = 500) -> list[dict]:
    """Execute SQL against the SQLite database and return results."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(sql)
    rows = [dict(r) for r in cursor.fetchmany(limit)]
    conn.close()
    return rows


async def ask_github_analytics(
    token: str | None,
    owner: str = "",
    repo: str = "",
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    tables_data: dict[str, list[dict]] | None = None,
    schema_text: str | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for GitHub Analytics Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not token:
        raise ValueError("GitHub personal access token is required")
    if not owner or not repo:
        raise ValueError("GitHub owner and repo are required")

    loop = asyncio.get_event_loop()

    # Fetch all table data
    if not tables_data:
        tables_data = await loop.run_in_executor(
            None, lambda: _fetch_all_tables_sync(token, owner, repo)
        )

    # Build SQLite database
    db_path = await loop.run_in_executor(
        None, lambda: _tables_to_sqlite(tables_data)
    )

    if not schema_text:
        schema_text = await loop.run_in_executor(
            None, lambda: _get_schema_text(db_path)
        )

    system = (
        "You are a data analyst assistant. The user has a GitHub repository with analytics data "
        "loaded into a SQLite database. The available tables and their schemas are below. "
        "Answer the question by writing a SQL query against the SQLite database. "
        "Return ONLY valid JSON with keys: "
        '"answer" (string - a brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"sql" (string - the SQL query to execute, or null if not needed). '
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
    trace["source_type"] = "github_analytics"
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
            answer = f"{answer}\n\n*Error executing SQL on GitHub data: {e}*"

    # Clean up temp db
    try:
        import os
        os.unlink(db_path)
    except Exception:
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
