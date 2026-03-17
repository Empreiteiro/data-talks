"""
Auto ML: simplified ML pipeline using scikit-learn.
Detects task type, trains a RandomForest model, evaluates, and generates an LLM report.
"""
import json
import math
from typing import Any

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.llm.client import chat_completion
from app.llm.logs import record_log


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _detect_task_type(series: pd.Series) -> str:
    """Classify target as 'classification' or 'regression'."""
    if series.dtype.kind in ("i", "u", "f"):
        nunique = series.nunique()
        # If numeric with few unique values, treat as classification
        if nunique <= 20 and nunique / max(len(series), 1) < 0.05:
            return "classification"
        return "regression"
    return "classification"


def _prepare_data(
    df: pd.DataFrame, target_column: str
) -> tuple[pd.DataFrame, pd.Series, str]:
    """Split features and target, detect task type."""
    if target_column not in df.columns:
        raise ValueError(f"Target column '{target_column}' not found in data")

    y = df[target_column].copy()
    X = df.drop(columns=[target_column]).copy()

    # Drop columns that are entirely null or have only one unique value
    X = X.dropna(axis=1, how="all")
    X = X.loc[:, X.nunique() > 1]

    if X.empty:
        raise ValueError("No usable feature columns after removing constant/null columns")

    task_type = _detect_task_type(y)

    # Drop rows where target is null
    mask = y.notna()
    X = X.loc[mask]
    y = y.loc[mask]

    if len(y) < 10:
        raise ValueError("Not enough rows with non-null target values (need at least 10)")

    if task_type == "classification":
        y = y.astype(str)

    return X, y, task_type


def _build_pipeline(X: pd.DataFrame, task_type: str) -> Pipeline:
    """Build a scikit-learn pipeline with preprocessing + RandomForest."""
    numeric_cols = X.select_dtypes(include=["number"]).columns.tolist()
    categorical_cols = X.select_dtypes(exclude=["number"]).columns.tolist()

    transformers = []
    if numeric_cols:
        transformers.append(
            ("num", Pipeline([
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
            ]), numeric_cols)
        )
    if categorical_cols:
        transformers.append(
            ("cat", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False, max_categories=20)),
            ]), categorical_cols)
        )

    preprocessor = ColumnTransformer(transformers=transformers, remainder="drop")

    if task_type == "classification":
        model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    else:
        model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)

    return Pipeline([("preprocessor", preprocessor), ("model", model)])


def _evaluate(pipeline: Pipeline, X_test: pd.DataFrame, y_test: pd.Series, task_type: str) -> dict:
    """Evaluate the trained model and return metrics."""
    y_pred = pipeline.predict(X_test)
    metrics: dict[str, Any] = {}

    if task_type == "classification":
        metrics["accuracy"] = _safe_float(accuracy_score(y_test, y_pred))
        metrics["precision"] = _safe_float(precision_score(y_test, y_pred, average="weighted", zero_division=0))
        metrics["recall"] = _safe_float(recall_score(y_test, y_pred, average="weighted", zero_division=0))
        metrics["f1"] = _safe_float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
        cm = confusion_matrix(y_test, y_pred)
        metrics["confusion_matrix"] = cm.tolist()
        metrics["classes"] = sorted(y_test.unique().tolist())
    else:
        metrics["r2"] = _safe_float(r2_score(y_test, y_pred))
        metrics["mae"] = _safe_float(mean_absolute_error(y_test, y_pred))
        metrics["rmse"] = _safe_float(math.sqrt(mean_squared_error(y_test, y_pred)))

    return metrics


def _extract_feature_importance(
    pipeline: Pipeline, X: pd.DataFrame
) -> list[dict[str, Any]]:
    """Extract feature importance from the trained RandomForest."""
    model = pipeline.named_steps["model"]
    preprocessor = pipeline.named_steps["preprocessor"]
    importances = model.feature_importances_

    feature_names = preprocessor.get_feature_names_out()
    # Clean up prefixed names (e.g., "num__col" -> "col", "cat__col_val" -> "col_val")
    clean_names = []
    for name in feature_names:
        for prefix in ("num__", "cat__"):
            if name.startswith(prefix):
                name = name[len(prefix):]
                break
        clean_names.append(name)

    pairs = sorted(zip(clean_names, importances), key=lambda x: x[1], reverse=True)
    return [
        {"feature": name, "importance": _safe_float(imp)}
        for name, imp in pairs[:15]
    ]


async def _generate_report(
    target_column: str,
    task_type: str,
    metrics: dict,
    feature_importance: list[dict],
    row_count: int,
    feature_count: int,
    llm_overrides: dict | None = None,
    channel: str = "studio",
) -> str:
    """Use LLM to generate a human-readable markdown report explaining the results."""
    system = (
        "You are a data science assistant. Generate a clear, concise markdown report "
        "explaining the Auto ML results to a non-technical audience. "
        "Include: what the model does, how well it performs, which features matter most, "
        "and actionable insights. Use simple language. Keep it under 500 words."
    )

    user_content = (
        f"Target column: {target_column}\n"
        f"Task type: {task_type}\n"
        f"Dataset: {row_count} rows, {feature_count} features\n"
        f"Model: Random Forest (100 trees)\n"
        f"Metrics: {json.dumps(metrics, default=str)}\n"
        f"Top features by importance: {json.dumps(feature_importance[:10], default=str)}\n"
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]

    content, usage, trace = await chat_completion(messages, max_tokens=1024, llm_overrides=llm_overrides)
    trace["stage"] = "automl_report"
    await record_log(
        action="automl",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        channel=channel,
        trace=trace,
    )
    return content


async def run_automl(
    df: pd.DataFrame,
    target_column: str,
    llm_overrides: dict | None = None,
    channel: str = "studio",
) -> dict[str, Any]:
    """
    Run the full Auto ML pipeline on a DataFrame.

    Returns: { task_type, model_type, metrics, feature_importance, report }
    """
    X, y, task_type = _prepare_data(df, target_column)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    pipeline = _build_pipeline(X, task_type)
    pipeline.fit(X_train, y_train)

    metrics = _evaluate(pipeline, X_test, y_test, task_type)
    feature_importance = _extract_feature_importance(pipeline, X)

    report = await _generate_report(
        target_column=target_column,
        task_type=task_type,
        metrics=metrics,
        feature_importance=feature_importance,
        row_count=len(df),
        feature_count=X.shape[1],
        llm_overrides=llm_overrides,
        channel=channel,
    )

    return {
        "task_type": task_type,
        "model_type": "random_forest",
        "metrics": metrics,
        "feature_importance": feature_importance,
        "report": report,
    }
