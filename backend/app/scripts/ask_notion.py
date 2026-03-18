"""
Notion Database Q&A: query Notion databases via API, normalize properties
to tabular data, then use LLM + pandas to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import re

import httpx

NOTION_API_VERSION = "2022-06-28"
NOTION_API_BASE = "https://api.notion.com/v1"


def _notion_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
    }


def _test_connection_sync(token: str) -> bool:
    """Test if a Notion integration token is valid."""
    with httpx.Client() as client:
        r = client.get(f"{NOTION_API_BASE}/users/me", headers=_notion_headers(token))
        r.raise_for_status()
        return True


def _list_databases_sync(token: str) -> list[dict]:
    """List accessible Notion databases."""
    results = []
    with httpx.Client() as client:
        has_more = True
        start_cursor = None
        while has_more:
            body: dict = {"filter": {"value": "database", "property": "object"}, "page_size": 100}
            if start_cursor:
                body["start_cursor"] = start_cursor
            r = client.post(f"{NOTION_API_BASE}/search", headers=_notion_headers(token), json=body)
            r.raise_for_status()
            data = r.json()
            for db in data.get("results", []):
                title_parts = db.get("title", [])
                title = "".join(p.get("plain_text", "") for p in title_parts) if title_parts else db.get("id", "")
                results.append({"id": db["id"], "title": title})
            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")
    return results


def _get_database_properties_sync(token: str, database_id: str) -> list[dict]:
    """Get property definitions for a Notion database."""
    with httpx.Client() as client:
        r = client.get(f"{NOTION_API_BASE}/databases/{database_id}", headers=_notion_headers(token))
        r.raise_for_status()
        data = r.json()
    properties = data.get("properties", {})
    result = []
    for name, prop in properties.items():
        prop_info = {"name": name, "type": prop.get("type", "")}
        if prop.get("type") == "select":
            prop_info["options"] = [o.get("name", "") for o in prop.get("select", {}).get("options", [])]
        elif prop.get("type") == "multi_select":
            prop_info["options"] = [o.get("name", "") for o in prop.get("multi_select", {}).get("options", [])]
        elif prop.get("type") == "status":
            prop_info["options"] = [o.get("name", "") for o in prop.get("status", {}).get("options", [])]
        result.append(prop_info)
    return result


def _query_database_sync(token: str, database_id: str, max_pages: int = 10000) -> list[dict]:
    """Query all pages from a Notion database."""
    pages = []
    with httpx.Client() as client:
        has_more = True
        start_cursor = None
        while has_more and len(pages) < max_pages:
            body: dict = {"page_size": 100}
            if start_cursor:
                body["start_cursor"] = start_cursor
            r = client.post(
                f"{NOTION_API_BASE}/databases/{database_id}/query",
                headers=_notion_headers(token),
                json=body,
            )
            r.raise_for_status()
            data = r.json()
            pages.extend(data.get("results", []))
            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")
    return pages


def _extract_property_value(prop: dict) -> Any:
    """Extract a scalar value from a Notion property object."""
    ptype = prop.get("type", "")

    if ptype == "title":
        return "".join(t.get("plain_text", "") for t in prop.get("title", []))
    elif ptype == "rich_text":
        return "".join(t.get("plain_text", "") for t in prop.get("rich_text", []))
    elif ptype == "number":
        return prop.get("number")
    elif ptype == "select":
        sel = prop.get("select")
        return sel.get("name", "") if sel else None
    elif ptype == "multi_select":
        return ", ".join(o.get("name", "") for o in prop.get("multi_select", []))
    elif ptype == "status":
        st = prop.get("status")
        return st.get("name", "") if st else None
    elif ptype == "date":
        d = prop.get("date")
        return d.get("start", "") if d else None
    elif ptype == "checkbox":
        return prop.get("checkbox", False)
    elif ptype == "email":
        return prop.get("email")
    elif ptype == "phone_number":
        return prop.get("phone_number")
    elif ptype == "url":
        return prop.get("url")
    elif ptype == "people":
        return ", ".join(p.get("name", "") for p in prop.get("people", []))
    elif ptype == "created_time":
        return prop.get("created_time")
    elif ptype == "last_edited_time":
        return prop.get("last_edited_time")
    elif ptype == "formula":
        formula = prop.get("formula", {})
        return formula.get(formula.get("type", ""), None)
    elif ptype == "rollup":
        rollup = prop.get("rollup", {})
        return rollup.get(rollup.get("type", ""), None)
    elif ptype == "relation":
        return ", ".join(r.get("id", "") for r in prop.get("relation", []))
    elif ptype == "files":
        files = prop.get("files", [])
        return ", ".join(f.get("name", "") for f in files)
    else:
        return str(prop.get(ptype, ""))


def _pages_to_rows(pages: list[dict]) -> list[dict]:
    """Convert Notion pages to flat tabular rows."""
    rows = []
    for page in pages:
        row = {"_id": page.get("id", "")}
        for name, prop in page.get("properties", {}).items():
            row[name] = _extract_property_value(prop)
        rows.append(row)
    return rows


def _run_pandas_code(code: str, df) -> Any:
    """Execute pandas code in a restricted namespace."""
    import pandas as pd

    safe_globals = {
        "__builtins__": {
            "len": len, "range": range, "enumerate": enumerate,
            "list": list, "dict": dict, "str": str, "int": int,
            "float": float, "bool": bool, "round": round,
            "sum": sum, "min": min, "max": max, "abs": abs,
            "sorted": sorted, "print": print,
        },
        "pd": pd,
        "df": df,
    }

    lines = code.strip().split("\n")
    if not lines:
        return None

    try:
        body = "\n".join(lines[:-1])
        last = lines[-1].strip()
        if body:
            exec(body, safe_globals)  # noqa: S102
        result = eval(last, safe_globals)  # noqa: S307
        return result
    except Exception:
        exec(code, safe_globals)  # noqa: S102
        return safe_globals.get("result")


async def ask_notion(
    integration_token: str | None,
    database_id: str,
    database_title: str = "",
    properties: list[dict] | None = None,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Notion Database Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not integration_token:
        raise ValueError("Notion integration token is required")

    loop = asyncio.get_event_loop()

    if not properties:
        properties = await loop.run_in_executor(
            None,
            lambda: _get_database_properties_sync(integration_token, database_id),
        )

    schema_parts = [
        f"Notion Database: {database_title or database_id}",
        f"Properties: {json.dumps(properties, ensure_ascii=False, default=str)}",
    ]
    if preview:
        schema_parts.append(
            f"Sample rows (up to 5): {json.dumps(preview[:5], ensure_ascii=False, default=str)}"
        )
    schema_text = "\n".join(schema_parts)

    system = (
        "You are a data analyst assistant. The user has a Notion database. "
        "You are given the database properties (column names and types) below. "
        "Answer the question by writing a short pandas Python code snippet that analyses the data. "
        "The DataFrame is pre-loaded as variable `df`. "
        "Return ONLY valid JSON with keys: "
        '"answer" (string — a brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"pandasCode" (string — Python/pandas code to compute the answer, or null if not needed). '
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
    trace["source_type"] = "notion"
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
    pandas_code = (parsed.get("pandasCode") or "").strip()

    chart_input = None
    if pandas_code:
        try:
            import pandas as pd

            pages = await loop.run_in_executor(
                None,
                lambda: _query_database_sync(integration_token, database_id),
            )
            rows = _pages_to_rows(pages)
            df = pd.DataFrame(rows) if rows else pd.DataFrame()

            result_value = _run_pandas_code(pandas_code, df)
            result_rows = _result_to_rows(result_value)

            if result_rows is not None:
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
            answer = f"{answer}\n\n*Error executing code on Notion data: {e}*"

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


def _result_to_rows(value: Any) -> list[dict] | None:
    if value is None:
        return None
    try:
        import pandas as pd
        if isinstance(value, pd.DataFrame):
            return value.head(500).to_dict(orient="records")
        if isinstance(value, pd.Series):
            return value.head(500).reset_index().to_dict(orient="records")
        if isinstance(value, (int, float, str, bool)):
            return [{"value": value}]
        if isinstance(value, (list, dict)):
            return value if isinstance(value, list) else [value]
    except Exception:
        pass
    return None


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data: Any, parsed_ok: bool) -> dict[str, Any]:
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        pandas_code = data.get("pandasCode") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(pandas_code, str):
            pandas_code = ""
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "pandasCode": pandas_code,
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
