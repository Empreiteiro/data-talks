"""
Intercom Q&A: fetch Intercom resources via API, load into SQLite,
then use LLM + SQL to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import re
import sqlite3
import tempfile

import httpx

INTERCOM_API_BASE = "https://api.intercom.io"
INTERCOM_API_VERSION = "2.11"

INTERCOM_TABLES = [
    "contacts",
    "companies",
    "conversations",
    "conversation_parts",
    "tags",
    "teams",
    "admins",
    "articles",
]

REPORT_TEMPLATES = [
    {
        "name": "Support Overview",
        "description": "Overview of support volume, open conversations, and contact distribution.",
        "questions": [
            "How many open conversations are there?",
            "How many contacts do we have?",
            "What is the distribution of conversations by status?",
        ],
    },
    {
        "name": "Response Time",
        "description": "Analysis of response and resolution times across conversations.",
        "questions": [
            "What is the average time to first response?",
            "What is the average resolution time for closed conversations?",
            "Which conversations have been open the longest?",
        ],
    },
    {
        "name": "Team Performance",
        "description": "Performance metrics broken down by team and admin.",
        "questions": [
            "How many conversations has each admin handled?",
            "Which team has the most open conversations?",
            "What is the average number of conversation parts per admin?",
        ],
    },
    {
        "name": "Customer Health",
        "description": "Customer engagement and health indicators.",
        "questions": [
            "How many contacts are associated with each company?",
            "Which companies have the most conversations?",
            "What tags are most frequently applied to contacts?",
        ],
    },
    {
        "name": "Knowledge Base",
        "description": "Insights into help center article coverage and usage.",
        "questions": [
            "How many articles are published?",
            "What is the distribution of articles by state (published, draft)?",
            "Which articles were most recently updated?",
        ],
    },
]


def _intercom_headers(access_token: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Intercom-Version": INTERCOM_API_VERSION,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _test_connection_sync(access_token: str) -> dict:
    """Test if an Intercom access token is valid by calling GET /me."""
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{INTERCOM_API_BASE}/me", headers=_intercom_headers(access_token))
        r.raise_for_status()
        return r.json()


def _fetch_contacts_sync(access_token: str, max_pages: int = 100) -> list[dict]:
    """Fetch contacts using scroll pagination."""
    contacts: list[dict] = []
    headers = _intercom_headers(access_token)
    with httpx.Client(timeout=60) as client:
        url = f"{INTERCOM_API_BASE}/contacts"
        params: dict = {"per_page": 150}
        page = 0
        while url and page < max_pages:
            r = client.get(url, headers=headers, params=params if page == 0 else None)
            r.raise_for_status()
            data = r.json()
            contacts.extend(data.get("data", []))
            pages = data.get("pages", {})
            next_page = pages.get("next")
            url = next_page if isinstance(next_page, str) else (next_page.get("starting_after") if isinstance(next_page, dict) else None)
            if isinstance(next_page, dict) and next_page.get("starting_after"):
                url = f"{INTERCOM_API_BASE}/contacts"
                params = {"per_page": 150, "starting_after": next_page["starting_after"]}
                page += 1
                continue
            elif isinstance(next_page, str):
                url = next_page
                params = {}
            else:
                url = None
            page += 1
    return contacts


def _fetch_companies_sync(access_token: str, max_pages: int = 100) -> list[dict]:
    """Fetch companies using scroll pagination."""
    companies: list[dict] = []
    headers = _intercom_headers(access_token)
    with httpx.Client(timeout=60) as client:
        url = f"{INTERCOM_API_BASE}/companies"
        params: dict = {"per_page": 150}
        page = 0
        while url and page < max_pages:
            r = client.get(url, headers=headers, params=params if page == 0 else None)
            r.raise_for_status()
            data = r.json()
            companies.extend(data.get("data", []))
            pages = data.get("pages", {})
            next_page = pages.get("next")
            if isinstance(next_page, str):
                url = next_page
                params = {}
            elif isinstance(next_page, dict) and next_page.get("starting_after"):
                params = {"per_page": 150, "starting_after": next_page["starting_after"]}
            else:
                url = None
            page += 1
    return companies


def _fetch_conversations_sync(access_token: str, max_pages: int = 50) -> list[dict]:
    """Fetch conversations with cursor-based pagination."""
    conversations: list[dict] = []
    headers = _intercom_headers(access_token)
    with httpx.Client(timeout=60) as client:
        url = f"{INTERCOM_API_BASE}/conversations"
        params: dict = {"per_page": 150}
        page = 0
        while url and page < max_pages:
            r = client.get(url, headers=headers, params=params if page == 0 else None)
            r.raise_for_status()
            data = r.json()
            conversations.extend(data.get("conversations", []))
            pages = data.get("pages", {})
            next_page = pages.get("next")
            if isinstance(next_page, str):
                url = next_page
                params = {}
            else:
                url = None
            page += 1
    return conversations


def _fetch_conversation_parts_sync(access_token: str, conversation_ids: list[str], max_conversations: int = 50) -> list[dict]:
    """Fetch conversation parts for the first N conversations."""
    parts: list[dict] = []
    headers = _intercom_headers(access_token)
    with httpx.Client(timeout=60) as client:
        for conv_id in conversation_ids[:max_conversations]:
            try:
                r = client.get(
                    f"{INTERCOM_API_BASE}/conversations/{conv_id}",
                    headers=headers,
                )
                r.raise_for_status()
                data = r.json()
                conv_parts = data.get("conversation_parts", {}).get("conversation_parts", [])
                for part in conv_parts:
                    part["conversation_id"] = conv_id
                parts.extend(conv_parts)
            except Exception:
                continue
    return parts


def _fetch_tags_sync(access_token: str) -> list[dict]:
    """Fetch all tags."""
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{INTERCOM_API_BASE}/tags", headers=_intercom_headers(access_token))
        r.raise_for_status()
        data = r.json()
        return data.get("data", [])


def _fetch_teams_sync(access_token: str) -> list[dict]:
    """Fetch all teams."""
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{INTERCOM_API_BASE}/teams", headers=_intercom_headers(access_token))
        r.raise_for_status()
        data = r.json()
        return data.get("teams", [])


def _fetch_admins_sync(access_token: str) -> list[dict]:
    """Fetch all admins."""
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{INTERCOM_API_BASE}/admins", headers=_intercom_headers(access_token))
        r.raise_for_status()
        data = r.json()
        return data.get("admins", [])


def _fetch_articles_sync(access_token: str, max_pages: int = 50) -> list[dict]:
    """Fetch articles with pagination."""
    articles: list[dict] = []
    headers = _intercom_headers(access_token)
    with httpx.Client(timeout=60) as client:
        url = f"{INTERCOM_API_BASE}/articles"
        params: dict = {"per_page": 150}
        page = 0
        while url and page < max_pages:
            r = client.get(url, headers=headers, params=params if page == 0 else None)
            r.raise_for_status()
            data = r.json()
            articles.extend(data.get("data", []))
            pages = data.get("pages", {})
            next_page = pages.get("next")
            if isinstance(next_page, str):
                url = next_page
                params = {}
            else:
                url = None
            page += 1
    return articles


def _discover_resources_sync(access_token: str) -> list[dict]:
    """Discover available Intercom resources and their record counts."""
    resources: list[dict] = []

    fetch_map = {
        "contacts": _fetch_contacts_sync,
        "companies": _fetch_companies_sync,
        "conversations": _fetch_conversations_sync,
        "tags": _fetch_tags_sync,
        "teams": _fetch_teams_sync,
        "admins": _fetch_admins_sync,
        "articles": _fetch_articles_sync,
    }

    for table_name, fetch_fn in fetch_map.items():
        try:
            data = fetch_fn(access_token)
            resources.append({
                "id": table_name,
                "name": table_name,
                "count": len(data),
            })
        except Exception:
            resources.append({
                "id": table_name,
                "name": table_name,
                "count": 0,
            })

    # conversation_parts depends on conversations
    resources.append({
        "id": "conversation_parts",
        "name": "conversation_parts",
        "count": -1,  # unknown until conversations are fetched
    })

    return resources


def _flatten(obj: Any, prefix: str = "") -> dict:
    """Flatten a nested dict into a single-level dict with dotted keys."""
    flat: dict = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
            if isinstance(v, dict):
                flat.update(_flatten(v, new_key))
            elif isinstance(v, (list, tuple)):
                flat[new_key] = json.dumps(v, default=str)
            else:
                flat[new_key] = v
    return flat


def _records_to_columns(records: list[dict]) -> list[str]:
    """Get all unique column names from a list of flattened records."""
    cols: set[str] = set()
    for r in records:
        flat = _flatten(r)
        cols.update(flat.keys())
    return sorted(cols)


def _create_sqlite_db(tables: dict[str, list[dict]]) -> str:
    """Create an in-memory SQLite database from table data, return path to temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    conn = sqlite3.connect(tmp.name)

    for table_name, records in tables.items():
        if not records:
            continue
        flat_records = [_flatten(r) for r in records]
        columns = _records_to_columns(records)
        if not columns:
            continue

        safe_table = table_name.replace("-", "_")
        col_defs = ", ".join(f'"{c}" TEXT' for c in columns)
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{safe_table}" ({col_defs})')

        placeholders = ", ".join("?" for _ in columns)
        col_names = ", ".join(f'"{c}"' for c in columns)
        for rec in flat_records:
            flat_rec = _flatten(rec)
            values = [str(flat_rec.get(c, "")) if flat_rec.get(c) is not None else None for c in columns]
            conn.execute(f'INSERT INTO "{safe_table}" ({col_names}) VALUES ({placeholders})', values)

    conn.commit()
    conn.close()
    return tmp.name


def _get_schema_text(db_path: str) -> str:
    """Get schema text from SQLite database for LLM context."""
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]

    schema_parts: list[str] = []
    for table in tables:
        cursor = conn.execute(f'PRAGMA table_info("{table}")')
        cols = cursor.fetchall()
        col_strs = [f"  {c[1]} {c[2]}" for c in cols]
        schema_parts.append(f"Table: {table}\nColumns:\n" + "\n".join(col_strs))

        cursor = conn.execute(f'SELECT COUNT(*) FROM "{table}"')
        count = cursor.fetchone()[0]
        schema_parts[-1] += f"\nRow count: {count}"

    conn.close()
    return "\n\n".join(schema_parts)


def _run_sql(db_path: str, sql: str) -> list[dict]:
    """Execute SQL on the SQLite database and return results as list of dicts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(sql)
        rows = [dict(row) for row in cursor.fetchall()]
        return rows
    finally:
        conn.close()


async def ask_intercom(
    access_token: str | None,
    selected_resources: list[str] | None = None,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    schema_text: str | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Intercom Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not access_token:
        raise ValueError("Intercom access token is required")

    loop = asyncio.get_event_loop()

    resources = selected_resources or INTERCOM_TABLES

    # Fetch data for selected resources
    tables: dict[str, list[dict]] = {}

    def _fetch_all():
        fetchers = {
            "contacts": lambda: _fetch_contacts_sync(access_token),
            "companies": lambda: _fetch_companies_sync(access_token),
            "conversations": lambda: _fetch_conversations_sync(access_token),
            "tags": lambda: _fetch_tags_sync(access_token),
            "teams": lambda: _fetch_teams_sync(access_token),
            "admins": lambda: _fetch_admins_sync(access_token),
            "articles": lambda: _fetch_articles_sync(access_token),
        }
        result: dict[str, list[dict]] = {}
        for resource in resources:
            if resource == "conversation_parts":
                continue  # handled after conversations
            if resource in fetchers:
                try:
                    result[resource] = fetchers[resource]()
                except Exception:
                    result[resource] = []

        # Fetch conversation_parts if requested
        if "conversation_parts" in resources and "conversations" in result:
            conv_ids = [c.get("id", "") for c in result.get("conversations", []) if c.get("id")]
            try:
                result["conversation_parts"] = _fetch_conversation_parts_sync(access_token, conv_ids)
            except Exception:
                result["conversation_parts"] = []

        return result

    tables = await loop.run_in_executor(None, _fetch_all)

    # Create SQLite database
    db_path = await loop.run_in_executor(None, lambda: _create_sqlite_db(tables))

    if not schema_text:
        schema_text = await loop.run_in_executor(None, lambda: _get_schema_text(db_path))

    # Build LLM prompt
    system = (
        "You are a data analyst assistant. The user has Intercom data loaded into a SQLite database. "
        "You are given the database schema below. "
        "Answer the question by writing a SQL query that retrieves the relevant data. "
        "Return ONLY valid JSON with keys: "
        '"answer" (string - a brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"sql" (string - the SQL query, or null if not needed). '
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
    trace["source_type"] = "intercom"
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
            answer = f"{answer}\n\n*Error executing SQL on Intercom data: {e}*"

    # Cleanup temp file
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
        sql = data.get("sql") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql, str):
            sql = ""
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "sql": sql,
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
    follow_up: list[str] = []
    for line in raw.split("\n"):
        cleaned = line.strip().lstrip("-0123456789. ").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
