"""Shared utilities for SQL-based ask scripts."""
import re


def extract_sql_from_field(s: str) -> str:
    """Extract SQL from sqlQuery field, stripping ```sql ... ``` if present."""
    s = (s or "").strip()
    if not s:
        return ""
    m = re.search(r"```(?:sql)?\s*([\s\S]*?)```", s, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return s
