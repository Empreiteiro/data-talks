"""Tests for the Auto ML training script."""
import pytest
import pandas as pd
from unittest.mock import AsyncMock, patch


@pytest.fixture
def classification_df():
    """Simple classification dataset."""
    return pd.DataFrame({
        "feature_a": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        "feature_b": [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101],
        "category": ["A", "B"] * 10,
        "target": ["yes", "no", "yes", "no", "yes", "no", "yes", "no", "yes", "no",
                    "yes", "no", "yes", "no", "yes", "no", "yes", "no", "yes", "no"],
    })


@pytest.fixture
def regression_df():
    """Simple regression dataset."""
    return pd.DataFrame({
        "x1": list(range(1, 51)),
        "x2": [i * 2.5 for i in range(1, 51)],
        "label": ["A", "B"] * 25,
        "price": [i * 10.0 + 5 for i in range(1, 51)],
    })


@pytest.mark.asyncio
async def test_classification_pipeline(classification_df):
    """Auto ML correctly detects classification and returns expected structure."""
    mock_report = "## Auto ML Report\nClassification model trained."

    with patch("app.scripts.automl.chat_completion", new_callable=AsyncMock) as mock_llm, \
         patch("app.scripts.automl.record_log", new_callable=AsyncMock):
        mock_llm.return_value = (mock_report, {"provider": "test", "model": "test", "input_tokens": 0, "output_tokens": 0}, {})

        from app.scripts.automl import run_automl
        result = await run_automl(classification_df, target_column="target")

    assert result["task_type"] == "classification"
    assert result["model_type"] == "random_forest"
    assert "accuracy" in result["metrics"]
    assert "f1" in result["metrics"]
    assert "precision" in result["metrics"]
    assert "recall" in result["metrics"]
    assert isinstance(result["feature_importance"], list)
    assert len(result["feature_importance"]) > 0
    assert result["report"] == mock_report
    # Metrics should be valid numbers
    assert 0 <= result["metrics"]["accuracy"] <= 1
    assert 0 <= result["metrics"]["f1"] <= 1


@pytest.mark.asyncio
async def test_regression_pipeline(regression_df):
    """Auto ML correctly detects regression and returns expected structure."""
    mock_report = "## Auto ML Report\nRegression model trained."

    with patch("app.scripts.automl.chat_completion", new_callable=AsyncMock) as mock_llm, \
         patch("app.scripts.automl.record_log", new_callable=AsyncMock):
        mock_llm.return_value = (mock_report, {"provider": "test", "model": "test", "input_tokens": 0, "output_tokens": 0}, {})

        from app.scripts.automl import run_automl
        result = await run_automl(regression_df, target_column="price")

    assert result["task_type"] == "regression"
    assert result["model_type"] == "random_forest"
    assert "r2" in result["metrics"]
    assert "mae" in result["metrics"]
    assert "rmse" in result["metrics"]
    assert isinstance(result["feature_importance"], list)
    assert len(result["feature_importance"]) > 0
    assert result["report"] == mock_report


@pytest.mark.asyncio
async def test_missing_target_column(classification_df):
    """Auto ML raises error for non-existent target column."""
    with patch("app.scripts.automl.chat_completion", new_callable=AsyncMock), \
         patch("app.scripts.automl.record_log", new_callable=AsyncMock):

        from app.scripts.automl import run_automl
        with pytest.raises(ValueError, match="not found"):
            await run_automl(classification_df, target_column="nonexistent")


@pytest.mark.asyncio
async def test_insufficient_rows():
    """Auto ML raises error for too few rows."""
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6], "target": ["x", "y", "z"]})

    with patch("app.scripts.automl.chat_completion", new_callable=AsyncMock), \
         patch("app.scripts.automl.record_log", new_callable=AsyncMock):

        from app.scripts.automl import run_automl
        with pytest.raises(ValueError, match="Not enough rows"):
            await run_automl(df, target_column="target")


def test_detect_task_type():
    """Task type detection works correctly."""
    from app.scripts.automl import _detect_task_type

    # Numeric with many unique values → regression
    assert _detect_task_type(pd.Series(range(100))) == "regression"

    # Categorical → classification
    assert _detect_task_type(pd.Series(["a", "b", "c"] * 20)) == "classification"

    # Numeric with few unique values → classification
    assert _detect_task_type(pd.Series([0, 1] * 100)) == "classification"


@pytest.mark.asyncio
async def test_automl_columns_endpoint(client):
    """GET /api/automl/columns returns 404 for non-existent source."""
    resp = await client.get("/api/automl/columns?agent_id=fake&source_id=fake")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_automl_list_endpoint(client):
    """GET /api/automl returns empty list."""
    resp = await client.get("/api/automl")
    assert resp.status_code == 200
    assert resp.json() == []
