"""Unit tests for generated-query normalization used by the SQL transparency panel."""
from app.routers.ask import _extract_generated_query


class TestExtractGeneratedQuery:
    def test_sql_query_field(self):
        query, lang = _extract_generated_query({"sqlQuery": "SELECT 1"})
        assert query == "SELECT 1"
        assert lang == "sql"

    def test_sql_field_fallback(self):
        query, lang = _extract_generated_query({"sql": "SELECT 2"})
        assert query == "SELECT 2"
        assert lang == "sql"

    def test_sql_query_takes_precedence_over_sql(self):
        query, lang = _extract_generated_query({"sqlQuery": "SELECT a", "sql": "SELECT b"})
        assert query == "SELECT a"
        assert lang == "sql"

    def test_pandas_code_is_python(self):
        query, lang = _extract_generated_query({"pandasCode": "df.head()"})
        assert query == "df.head()"
        assert lang == "python"

    def test_sql_takes_precedence_over_pandas(self):
        query, lang = _extract_generated_query({"sqlQuery": "SELECT 1", "pandasCode": "df.head()"})
        assert query == "SELECT 1"
        assert lang == "sql"

    def test_query_is_stripped(self):
        query, _ = _extract_generated_query({"sqlQuery": "  SELECT 1  \n"})
        assert query == "SELECT 1"

    def test_empty_string_is_ignored(self):
        assert _extract_generated_query({"sqlQuery": "   "}) == (None, None)

    def test_missing_field_returns_none(self):
        assert _extract_generated_query({"answer": "hi"}) == (None, None)

    def test_non_string_value_is_ignored(self):
        assert _extract_generated_query({"sqlQuery": None, "sql": 123}) == (None, None)
