"""
Demo data generator — creates sample CSV files and sources for each workspace type.

Analysis: sales transactions, products catalog, customer feedback
CDP: customers, orders/transactions, website events (pageviews, clicks)
ETL: raw_logs (messy), product_inventory, shipping_records
"""
from __future__ import annotations

import csv
import io
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd


def _uid() -> str:
    return str(uuid.uuid4())


def _write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def _build_metadata(file_path_rel: str, df: pd.DataFrame) -> dict:
    from app.routers.crud import _build_sample_profile, _sanitize_for_json
    profile = _build_sample_profile(df.head(1000))
    return {
        "file_path": file_path_rel,
        "columns": [str(c) for c in df.columns],
        "preview_rows": _sanitize_for_json(df.head(5).to_dict(orient="records")),
        "row_count": len(df),
        "sample_row_count": min(len(df), 1000),
        "sample_profile": profile,
    }


# ---------------------------------------------------------------------------
# Data generators
# ---------------------------------------------------------------------------

_PRODUCTS = ["Laptop Pro", "Wireless Mouse", "USB-C Hub", "Monitor 27\"", "Keyboard MX", "Webcam HD", "Headphones BT", "SSD 1TB", "RAM 16GB", "Charger 65W"]
_REGIONS = ["North", "South", "East", "West", "Central"]
_CATEGORIES = ["Electronics", "Accessories", "Storage", "Peripherals"]
_COUNTRIES = ["Brazil", "USA", "Germany", "Japan", "Mexico", "India", "UK", "France"]
_NAMES = ["Alice Santos", "Bob Silva", "Carlos Oliveira", "Diana Costa", "Eduardo Lima", "Fernanda Souza", "Gabriel Pereira", "Helena Almeida", "Igor Nascimento", "Julia Ribeiro", "Karen Martins", "Lucas Ferreira", "Maria Rodrigues", "Nuno Barbosa", "Olivia Mendes"]
_EMAILS_DOMAINS = ["gmail.com", "outlook.com", "company.co", "mail.com"]
_PAGES = ["/home", "/products", "/pricing", "/about", "/contact", "/blog", "/checkout", "/cart", "/account", "/support"]
_EVENTS = ["pageview", "click", "add_to_cart", "purchase", "signup", "login"]
_RATINGS = [1, 2, 3, 4, 5]
_FEEDBACK = ["Great product!", "Could be better", "Excellent quality", "Not worth the price", "Amazing experience", "Average", "Will buy again", "Disappointed", "Perfect!", "Good value"]


def _random_date(start_days_ago: int = 365) -> str:
    d = datetime.now() - timedelta(days=random.randint(0, start_days_ago))
    return d.strftime("%Y-%m-%d")


def _random_datetime(start_days_ago: int = 365) -> str:
    d = datetime.now() - timedelta(days=random.randint(0, start_days_ago), hours=random.randint(0, 23), minutes=random.randint(0, 59))
    return d.strftime("%Y-%m-%d %H:%M:%S")


def _random_email(name: str) -> str:
    clean = name.lower().replace(" ", ".").replace("\"", "")
    return f"{clean}@{random.choice(_EMAILS_DOMAINS)}"


# ── Analysis demo data ──

def generate_analysis_data(data_dir: Path, user_id: str) -> list[dict]:
    """Returns list of {name, type, file_path_rel, df} for 3 sources."""
    sources = []

    # 1. Sales transactions (500 rows)
    rows = []
    for _ in range(500):
        product = random.choice(_PRODUCTS)
        cat = random.choice(_CATEGORIES)
        rows.append({
            "date": _random_date(365),
            "product": product,
            "category": cat,
            "region": random.choice(_REGIONS),
            "quantity": random.randint(1, 20),
            "unit_price": round(random.uniform(15, 2500), 2),
            "total": 0,
            "country": random.choice(_COUNTRIES),
        })
    for r in rows:
        r["total"] = round(r["quantity"] * r["unit_price"], 2)

    fname = f"{user_id}/{_uid()[:8]}_sales.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "sales_transactions.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 2. Product catalog (10 rows)
    rows = [{"product_id": i + 1, "name": _PRODUCTS[i], "category": _CATEGORIES[i % len(_CATEGORIES)], "base_price": round(random.uniform(20, 3000), 2), "stock": random.randint(0, 500)} for i in range(len(_PRODUCTS))]
    fname = f"{user_id}/{_uid()[:8]}_products.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "product_catalog.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 3. Customer feedback (200 rows)
    rows = []
    for _ in range(200):
        rows.append({
            "date": _random_date(180),
            "customer_name": random.choice(_NAMES),
            "product": random.choice(_PRODUCTS),
            "rating": random.choice(_RATINGS),
            "feedback": random.choice(_FEEDBACK),
            "country": random.choice(_COUNTRIES),
        })
    fname = f"{user_id}/{_uid()[:8]}_feedback.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "customer_feedback.csv", "type": "csv", "file_path_rel": fname, "df": df})

    return sources


# ── CDP demo data ──

def generate_cdp_data(data_dir: Path, user_id: str) -> list[dict]:
    """CDP-specific: customers, orders, website events — linked by email."""
    sources = []

    # Shared customer pool
    customers = []
    for i, name in enumerate(_NAMES):
        customers.append({
            "customer_id": f"cust_{i+1:04d}",
            "name": name,
            "email": _random_email(name),
            "phone": f"+55119{random.randint(10000000,99999999)}",
            "signup_date": _random_date(730),
            "country": random.choice(_COUNTRIES),
            "segment": random.choice(["premium", "standard", "basic"]),
        })

    # 1. Customers (CRM export)
    fname = f"{user_id}/{_uid()[:8]}_customers.csv"
    path = data_dir / fname
    _write_csv(customers, path)
    df = pd.read_csv(path)
    sources.append({"name": "crm_customers.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 2. Orders / Transactions (linked by email)
    orders = []
    for _ in range(600):
        cust = random.choice(customers)
        orders.append({
            "order_id": f"ord_{_uid()[:8]}",
            "email": cust["email"],
            "order_date": _random_date(365),
            "product": random.choice(_PRODUCTS),
            "quantity": random.randint(1, 5),
            "amount": round(random.uniform(25, 3000), 2),
            "payment_method": random.choice(["credit_card", "pix", "boleto", "debit"]),
            "status": random.choice(["completed", "completed", "completed", "refunded", "pending"]),
        })
    fname = f"{user_id}/{_uid()[:8]}_orders.csv"
    path = data_dir / fname
    _write_csv(orders, path)
    df = pd.read_csv(path)
    sources.append({"name": "orders_transactions.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 3. Website events (linked by email)
    events = []
    for _ in range(1000):
        cust = random.choice(customers)
        events.append({
            "event_id": _uid()[:12],
            "email": cust["email"],
            "timestamp": _random_datetime(90),
            "event_type": random.choice(_EVENTS),
            "page": random.choice(_PAGES),
            "device": random.choice(["desktop", "mobile", "tablet"]),
            "session_id": _uid()[:8],
        })
    fname = f"{user_id}/{_uid()[:8]}_events.csv"
    path = data_dir / fname
    _write_csv(events, path)
    df = pd.read_csv(path)
    sources.append({"name": "website_events.csv", "type": "csv", "file_path_rel": fname, "df": df})

    return sources


# ── ETL demo data ──

def generate_etl_data(data_dir: Path, user_id: str) -> list[dict]:
    """ETL-specific: messy raw logs, product inventory, shipping records."""
    sources = []

    # 1. Raw access logs (messy data — needs cleaning)
    rows = []
    for _ in range(800):
        ip = f"{random.randint(1,255)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,255)}"
        status = random.choice([200, 200, 200, 200, 301, 404, 500])
        rows.append({
            "timestamp": _random_datetime(60),
            "ip_address": ip,
            "method": random.choice(["GET", "GET", "GET", "POST", "PUT", "DELETE"]),
            "path": random.choice(_PAGES),
            "status_code": status,
            "response_time_ms": random.randint(5, 5000) if status != 500 else random.randint(5000, 30000),
            "user_agent": random.choice(["Mozilla/5.0", "Chrome/120", "Safari/17", "curl/7.68", "", None]),
            "bytes_sent": random.randint(100, 500000),
        })
    # Inject some messy data
    for r in random.sample(rows, 50):
        r["timestamp"] = ""  # missing timestamps
    for r in random.sample(rows, 30):
        r["response_time_ms"] = "N/A"  # bad numeric data

    fname = f"{user_id}/{_uid()[:8]}_raw_logs.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "raw_access_logs.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 2. Product inventory
    rows = []
    for i, product in enumerate(_PRODUCTS):
        for warehouse in ["WH-North", "WH-South", "WH-Central"]:
            rows.append({
                "product_id": f"SKU-{i+1:03d}",
                "product_name": product,
                "warehouse": warehouse,
                "quantity_on_hand": random.randint(0, 500),
                "reorder_point": random.randint(10, 50),
                "last_restocked": _random_date(90),
                "unit_cost": round(random.uniform(5, 1500), 2),
            })
    fname = f"{user_id}/{_uid()[:8]}_inventory.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "product_inventory.csv", "type": "csv", "file_path_rel": fname, "df": df})

    # 3. Shipping records
    rows = []
    for _ in range(400):
        shipped = _random_date(120)
        days = random.randint(1, 15)
        delivered = (datetime.strptime(shipped, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
        rows.append({
            "shipment_id": f"SHP-{_uid()[:6].upper()}",
            "order_id": f"ord_{_uid()[:8]}",
            "origin": random.choice(["WH-North", "WH-South", "WH-Central"]),
            "destination_country": random.choice(_COUNTRIES),
            "carrier": random.choice(["FedEx", "DHL", "UPS", "Correios", "Local"]),
            "shipped_date": shipped,
            "delivered_date": delivered if random.random() > 0.15 else "",
            "status": random.choice(["delivered", "delivered", "delivered", "in_transit", "returned"]),
            "cost": round(random.uniform(5, 150), 2),
        })
    fname = f"{user_id}/{_uid()[:8]}_shipping.csv"
    path = data_dir / fname
    _write_csv(rows, path)
    df = pd.read_csv(path)
    sources.append({"name": "shipping_records.csv", "type": "csv", "file_path_rel": fname, "df": df})

    return sources
