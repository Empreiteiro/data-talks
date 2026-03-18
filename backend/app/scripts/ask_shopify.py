"""
Shopify Q&A: fetch store data via Shopify Admin API, normalize into tabular data,
then use LLM + SQL-on-SQLite to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import math
import re
import sqlite3

import httpx
import pandas as pd

from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field

MAX_ROWS = 50_000

REPORT_TEMPLATES = [
    {
        "id": "sales-overview",
        "name": "Sales Overview",
        "description": "Analyze your store's sales: order volume, revenue, and trends.",
        "questions": [
            "What is the total revenue from all orders?",
            "How many orders were placed in the last 30 days?",
            "What is the average order value?",
            "What is the month-over-month trend of total sales?",
            "What are the top 5 days by order volume?",
        ],
    },
    {
        "id": "product-performance",
        "name": "Product Performance",
        "description": "Track product metrics: best sellers, inventory, and variants.",
        "questions": [
            "Which are the top 10 products by total revenue?",
            "How many units of each product were sold?",
            "What is the average price per product?",
            "Which product variants have the most sales?",
            "How many products have zero sales?",
        ],
    },
    {
        "id": "customer-analytics",
        "name": "Customer Analytics",
        "description": "Understand your customers: acquisition, spending, and loyalty.",
        "questions": [
            "How many unique customers have placed orders?",
            "What is the average number of orders per customer?",
            "Who are the top 10 customers by total spending?",
            "How many new customers were acquired each month?",
            "What is the distribution of customers by total order count?",
        ],
    },
    {
        "id": "inventory-health",
        "name": "Inventory Health",
        "description": "Monitor inventory levels and stock availability.",
        "questions": [
            "Which products are low in stock (fewer than 10 units)?",
            "What is the total inventory value across all products?",
            "Which variants have the highest inventory quantity?",
            "How many products are out of stock?",
            "What is the average inventory level per product?",
        ],
    },
    {
        "id": "discounts-refunds",
        "name": "Discounts & Refunds",
        "description": "Analyze discounts, refunds, and their impact on revenue.",
        "questions": [
            "What is the total value of refunds?",
            "How many orders have been refunded?",
            "What is the refund rate as a percentage of total orders?",
            "What is the total discount amount applied across all orders?",
            "Which orders had the highest refund amounts?",
        ],
    },
]


def _shopify_api_url(store: str, resource: str) -> str:
    return f"https://{store}.myshopify.com/admin/api/2024-01/{resource}.json"


def _shopify_headers(access_token: str) -> dict:
    return {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}


def _parse_link_header(link_header: str | None) -> str | None:
    """Parse Link header for rel='next' URL (same pattern as GitHub)."""
    if not link_header:
        return None
    for part in link_header.split(","):
        part = part.strip()
        if 'rel="next"' in part:
            match = re.search(r"<([^>]+)>", part)
            if match:
                return match.group(1)
    return None


def _fetch_paginated_sync(
    store: str,
    access_token: str,
    resource: str,
    params: dict | None = None,
    max_records: int = MAX_ROWS,
    resource_key: str | None = None,
) -> list[dict]:
    """Fetch Shopify resources with Link header pagination."""
    headers = _shopify_headers(access_token)
    url = _shopify_api_url(store, resource)
    all_records: list[dict] = []
    key = resource_key or resource.split("/")[-1]

    with httpx.Client(timeout=30) as client:
        while url and len(all_records) < max_records:
            r = client.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()
            records = data.get(key, [])
            all_records.extend(records)
            # After first request, params are included in the next URL
            params = None
            url = _parse_link_header(r.headers.get("link"))

    return all_records[:max_records]


def _test_connection_sync(store: str, access_token: str) -> dict:
    """Test Shopify connection by fetching shop info."""
    headers = _shopify_headers(access_token)
    url = _shopify_api_url(store, "shop")
    with httpx.Client(timeout=15) as client:
        r = client.get(url, headers=headers)
        r.raise_for_status()
        shop = r.json().get("shop", {})
        return {
            "ok": True,
            "shop": {
                "name": shop.get("name", ""),
                "domain": shop.get("domain", ""),
                "email": shop.get("email", ""),
                "plan_name": shop.get("plan_name", ""),
                "country_name": shop.get("country_name", ""),
            },
        }


def _discover_objects_sync(store: str, access_token: str) -> dict:
    """Discover available resource counts."""
    headers = _shopify_headers(access_token)
    counts = {}
    resources = {
        "orders": {"url": "orders/count", "params": {"status": "any"}},
        "customers": {"url": "customers/count", "params": {}},
        "products": {"url": "products/count", "params": {}},
        "custom_collections": {"url": "custom_collections/count", "params": {}},
        "smart_collections": {"url": "smart_collections/count", "params": {}},
    }

    with httpx.Client(timeout=15) as client:
        for name, cfg in resources.items():
            try:
                url = _shopify_api_url(store, cfg["url"])
                r = client.get(url, headers=headers, params=cfg["params"] or None)
                if r.status_code == 200:
                    counts[name] = r.json().get("count", 0)
            except Exception:
                counts[name] = 0

    # Collections = custom + smart
    counts["collections"] = counts.pop("custom_collections", 0) + counts.pop("smart_collections", 0)

    return {"resourceCounts": counts}


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _build_sample_profile(df: pd.DataFrame) -> dict:
    sample_rows = len(df)
    profile: dict = {"sample_rows": sample_rows, "columns": {}}
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile: dict = {"type": str(series.dtype), "missing": int(series.isna().sum())}
        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                col_profile["numeric"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                }
        profile["columns"][str(col)] = col_profile
    return profile


def _load_all_tables_sync(store: str, access_token: str) -> dict[str, pd.DataFrame]:
    """Fetch all Shopify tables and return as DataFrames."""
    tables: dict[str, pd.DataFrame] = {}

    # Orders (with line_items embedded)
    try:
        orders_raw = _fetch_paginated_sync(
            store, access_token, "orders",
            params={"status": "any", "limit": 250},
        )
        if orders_raw:
            # Extract line_items before flattening orders
            line_items_all: list[dict] = []
            for order in orders_raw:
                order_id = order.get("id")
                for li in order.get("line_items", []):
                    li_record = dict(li)
                    li_record["order_id"] = order_id
                    line_items_all.append(li_record)

            # Flatten orders (remove nested arrays for clean tabular data)
            orders_flat = []
            for o in orders_raw:
                flat = {k: v for k, v in o.items() if not isinstance(v, (list, dict))}
                # Extract useful nested fields
                flat["total_price"] = o.get("total_price")
                flat["subtotal_price"] = o.get("subtotal_price")
                flat["total_tax"] = o.get("total_tax")
                flat["total_discounts"] = o.get("total_discounts")
                flat["currency"] = o.get("currency")
                flat["financial_status"] = o.get("financial_status")
                flat["fulfillment_status"] = o.get("fulfillment_status")
                flat["customer_id"] = (o.get("customer") or {}).get("id")
                orders_flat.append(flat)

            tables["orders"] = pd.DataFrame(orders_flat)
            tables["line_items"] = pd.DataFrame(line_items_all) if line_items_all else pd.DataFrame(
                columns=["id", "order_id", "title", "quantity", "price", "variant_id", "product_id"]
            )
        else:
            tables["orders"] = pd.DataFrame(columns=["id", "created_at", "total_price", "currency", "financial_status"])
            tables["line_items"] = pd.DataFrame(columns=["id", "order_id", "title", "quantity", "price", "variant_id", "product_id"])
    except Exception:
        tables["orders"] = pd.DataFrame(columns=["id", "created_at", "total_price", "currency", "financial_status"])
        tables["line_items"] = pd.DataFrame(columns=["id", "order_id", "title", "quantity", "price", "variant_id", "product_id"])

    # Customers
    try:
        customers_raw = _fetch_paginated_sync(
            store, access_token, "customers",
            params={"limit": 250},
        )
        if customers_raw:
            customers_flat = []
            for c in customers_raw:
                flat = {k: v for k, v in c.items() if not isinstance(v, (list, dict))}
                addr = c.get("default_address") or {}
                flat["city"] = addr.get("city")
                flat["province"] = addr.get("province")
                flat["country"] = addr.get("country")
                customers_flat.append(flat)
            tables["customers"] = pd.DataFrame(customers_flat)
        else:
            tables["customers"] = pd.DataFrame(columns=["id", "email", "first_name", "last_name", "orders_count", "total_spent"])
    except Exception:
        tables["customers"] = pd.DataFrame(columns=["id", "email", "first_name", "last_name", "orders_count", "total_spent"])

    # Products + Variants
    try:
        products_raw = _fetch_paginated_sync(
            store, access_token, "products",
            params={"limit": 250},
        )
        if products_raw:
            variants_all: list[dict] = []
            products_flat = []
            for p in products_raw:
                flat = {k: v for k, v in p.items() if not isinstance(v, (list, dict))}
                products_flat.append(flat)
                for v in p.get("variants", []):
                    v_record = dict(v)
                    v_record["product_id"] = p.get("id")
                    variants_all.append(v_record)

            tables["products"] = pd.DataFrame(products_flat)
            tables["variants"] = pd.DataFrame(variants_all) if variants_all else pd.DataFrame(
                columns=["id", "product_id", "title", "price", "sku", "inventory_quantity", "inventory_item_id"]
            )
        else:
            tables["products"] = pd.DataFrame(columns=["id", "title", "vendor", "product_type", "created_at"])
            tables["variants"] = pd.DataFrame(columns=["id", "product_id", "title", "price", "sku", "inventory_quantity", "inventory_item_id"])
    except Exception:
        tables["products"] = pd.DataFrame(columns=["id", "title", "vendor", "product_type", "created_at"])
        tables["variants"] = pd.DataFrame(columns=["id", "product_id", "title", "price", "sku", "inventory_quantity", "inventory_item_id"])

    # Collections (custom + smart)
    try:
        custom_collections = _fetch_paginated_sync(
            store, access_token, "custom_collections",
            params={"limit": 250},
        )
        smart_collections = _fetch_paginated_sync(
            store, access_token, "smart_collections",
            params={"limit": 250},
        )
        all_collections = []
        for c in custom_collections:
            flat = {k: v for k, v in c.items() if not isinstance(v, (list, dict))}
            flat["collection_type"] = "custom"
            all_collections.append(flat)
        for c in smart_collections:
            flat = {k: v for k, v in c.items() if not isinstance(v, (list, dict))}
            flat["collection_type"] = "smart"
            all_collections.append(flat)
        tables["collections"] = pd.DataFrame(all_collections) if all_collections else pd.DataFrame(
            columns=["id", "title", "collection_type", "published_at"]
        )
    except Exception:
        tables["collections"] = pd.DataFrame(columns=["id", "title", "collection_type", "published_at"])

    # Inventory Items (from variant inventory_item_ids)
    try:
        variants_df = tables.get("variants", pd.DataFrame())
        if not variants_df.empty and "inventory_item_id" in variants_df.columns:
            inv_ids = variants_df["inventory_item_id"].dropna().astype(int).tolist()
            inventory_items: list[dict] = []
            # Shopify allows up to 100 IDs per request
            headers = _shopify_headers(access_token)
            with httpx.Client(timeout=30) as client:
                for i in range(0, min(len(inv_ids), 5000), 100):
                    batch = inv_ids[i:i + 100]
                    ids_str = ",".join(str(x) for x in batch)
                    url = _shopify_api_url(store, "inventory_items")
                    r = client.get(url, headers=headers, params={"ids": ids_str, "limit": 100})
                    if r.status_code == 200:
                        items = r.json().get("inventory_items", [])
                        for item in items:
                            flat = {k: v for k, v in item.items() if not isinstance(v, (list, dict))}
                            inventory_items.append(flat)
            tables["inventory_items"] = pd.DataFrame(inventory_items) if inventory_items else pd.DataFrame(
                columns=["id", "sku", "cost", "tracked"]
            )
        else:
            tables["inventory_items"] = pd.DataFrame(columns=["id", "sku", "cost", "tracked"])
    except Exception:
        tables["inventory_items"] = pd.DataFrame(columns=["id", "sku", "cost", "tracked"])

    # Refunds (from first N orders that have refunds)
    try:
        orders_df = tables.get("orders", pd.DataFrame())
        refunds_all: list[dict] = []
        if not orders_df.empty and "id" in orders_df.columns:
            headers = _shopify_headers(access_token)
            order_ids = orders_df["id"].tolist()[:200]  # Limit to first 200 orders
            with httpx.Client(timeout=30) as client:
                for oid in order_ids:
                    try:
                        url = _shopify_api_url(store, f"orders/{oid}/refunds")
                        r = client.get(url, headers=headers)
                        if r.status_code == 200:
                            for ref in r.json().get("refunds", []):
                                flat = {k: v for k, v in ref.items() if not isinstance(v, (list, dict))}
                                flat["order_id"] = oid
                                refunds_all.append(flat)
                    except Exception:
                        continue
                    if len(refunds_all) >= MAX_ROWS:
                        break
        tables["refunds"] = pd.DataFrame(refunds_all) if refunds_all else pd.DataFrame(
            columns=["id", "order_id", "created_at", "note"]
        )
    except Exception:
        tables["refunds"] = pd.DataFrame(columns=["id", "order_id", "created_at", "note"])

    return tables


async def ask_shopify(
    store: str,
    access_token: str,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Shopify Q&A."""
    loop = asyncio.get_event_loop()

    tables = await loop.run_in_executor(None, lambda: _load_all_tables_sync(store, access_token))

    # Load into in-memory SQLite
    conn = sqlite3.connect(":memory:")
    schema_parts = []
    for table_name, df in tables.items():
        if df.empty and len(df.columns) == 0:
            continue
        df.to_sql(table_name, conn, index=False, if_exists="replace")
        cols = ", ".join(df.columns)
        row_count = len(df)
        schema_parts.append(f"Table '{table_name}' ({row_count} rows): {cols}")

    schema_text = "\n".join(schema_parts)

    # Build profile from orders table (most important for analysis)
    main_df = tables.get("orders", pd.DataFrame())
    if main_df.empty:
        main_df = tables.get("products", pd.DataFrame())
    sample_profile = _build_sample_profile(main_df.head(1000))

    profile_lines = []
    for col, info in sample_profile.get("columns", {}).items():
        line = f"- {col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
        profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    # Build sample data
    preview_parts = []
    for tname, tdf in tables.items():
        if not tdf.empty:
            preview_parts.append(f"--- {tname} (sample) ---\n{json.dumps(tdf.head(3).to_dict(orient='records'), default=str, ensure_ascii=False)}")

    system = (
        "You are an assistant that answers questions about Shopify store data. "
        "The data is loaded into multiple SQLite tables. "
        f"Available tables and columns:\n{schema_text}\n\n"
        "For questions requiring filtering, counting, or aggregation, provide a SQL query in sqlQuery. "
        "Use standard SQL with JOINs across tables as needed. "
        "Quote column names with double quotes if they contain special characters. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"Shopify Store Data Schema:\n{schema_text}\n\n"
        f"Sample profile (orders/products):\n{profile_text}\n\n"
        f"Sample data:\n{chr(10).join(preview_parts[:5])}\n\n"
        f"User question: {question}"
    )

    messages: list[dict] = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "shopify"
    await record_log(
        action="pergunta", provider=usage.get("provider", ""), model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0), output_tokens=usage.get("output_tokens", 0),
        source=source_name, channel=channel, trace=trace,
    )

    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_query = extract_sql_from_field(parsed.get("sqlQuery") or "")

    chart_input = None
    try:
        if sql_query and sql_query.upper().strip().startswith("SELECT"):
            try:
                cur = conn.execute(sql_query)
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, row)) for row in cur.fetchall()]
                if rows:
                    chart_input = build_chart_input(rows, schema_text)
                    elaborated = await elaborate_answer_with_results(
                        question=question, query_results=rows, agent_description=agent_description,
                        source_name=source_name, schema_text=schema_text,
                        llm_overrides=llm_overrides, channel=channel,
                    )
                    answer = elaborated["answer"]
                    follow_up = elaborated["followUpQuestions"] or follow_up
            except Exception as e:
                answer = f"{answer}\n\n*Error executing SQL: {e}*"
    finally:
        conn.close()

    if not parsed["parsed_ok"] and not answer:
        answer = raw_answer

    follow_up = await refine_followup_questions(
        question=question, candidate_questions=follow_up, schema_text=schema_text,
        llm_overrides=llm_overrides, channel=channel,
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data, parsed_ok):
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_query = data.get("sqlQuery") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_query, str):
            sql_query = ""
        return {"answer": answer, "followUpQuestions": follow_up[:3], "sqlQuery": sql_query, "parsed_ok": parsed_ok}

    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        return _coerce(json.loads(raw_clean), True)
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return _coerce(json.loads(raw_clean[start:end + 1]), True)
            except json.JSONDecodeError:
                pass
        return _coerce({}, False)
