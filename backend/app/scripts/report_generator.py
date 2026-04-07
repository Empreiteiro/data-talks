"""
Studio Report Generator: multi-step pipeline that produces a rich HTML report
with exploratory charts (base64 PNG) and LLM-generated observations/explanations.

Pipeline:
  1. Data profiling (pure code)
  2. General observations (LLM call #1)
  3. Chart planning (LLM call #2)
  4. Chart rendering (Matplotlib)
  5. Chart explanations (LLM call #3)
  6. HTML assembly
"""
import base64
import io
import json

LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


def _language_instruction(language: str | None) -> str:
    """Return an explicit language instruction for LLM prompts."""
    if language and language in LANGUAGE_NAMES:
        return f"Write ALL text output in {LANGUAGE_NAMES[language]}. "
    return "Write in the same language as the data (e.g., Portuguese if column names are in Portuguese). "
import math
import re
from datetime import datetime
from typing import Any

import pandas as pd

from app.llm.client import chat_completion
from app.llm.logs import record_log
from app.llm.charting import PLATFORM_THEME, PALETTE


MAX_ROWS_FOR_PROFILE = 5000
MAX_CATEGORIES_PER_CHART = 15
MAX_CHARTS = 8


# ---------------------------------------------------------------------------
# Step 1: Data profiling
# ---------------------------------------------------------------------------

def _safe_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _profile_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Build a detailed profile of the DataFrame for LLM and chart rendering."""
    row_count = len(df)
    col_count = len(df.columns)

    numeric_cols: list[str] = []
    categorical_cols: list[str] = []
    datetime_cols: list[str] = []
    columns_info: list[dict[str, Any]] = []

    for col in df.columns:
        series = df[col]
        dtype_str = str(series.dtype)
        missing = int(series.isna().sum())
        missing_pct = round(missing / row_count * 100, 1) if row_count > 0 else 0
        unique_count = int(series.nunique())

        info: dict[str, Any] = {
            "name": str(col),
            "dtype": dtype_str,
            "missing": missing,
            "missing_pct": missing_pct,
            "unique": unique_count,
        }

        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                info["stats"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                    "median": _safe_float(numeric.median()),
                    "std": _safe_float(numeric.std()),
                    "q25": _safe_float(numeric.quantile(0.25)),
                    "q75": _safe_float(numeric.quantile(0.75)),
                }
            numeric_cols.append(str(col))
        elif pd.api.types.is_datetime64_any_dtype(series):
            datetime_cols.append(str(col))
            non_null = series.dropna()
            if not non_null.empty:
                info["date_range"] = {
                    "min": str(non_null.min()),
                    "max": str(non_null.max()),
                }
        else:
            # Try to parse as datetime
            if unique_count > 1 and series.dtype == object:
                sample = series.dropna().head(20)
                try:
                    parsed = pd.to_datetime(sample, infer_datetime_format=True, errors="coerce")
                    if parsed.notna().sum() > len(sample) * 0.8:
                        datetime_cols.append(str(col))
                        info["inferred_datetime"] = True
                except Exception:
                    pass

            if str(col) not in datetime_cols:
                categorical_cols.append(str(col))
                counts = series.dropna().astype(str).value_counts().head(10)
                if not counts.empty:
                    info["top_values"] = {str(k): int(v) for k, v in counts.items()}

        columns_info.append(info)

    # Correlation matrix for numeric columns
    correlations: dict[str, Any] | None = None
    if len(numeric_cols) >= 2:
        try:
            corr_df = df[numeric_cols].corr()
            correlations = {}
            for c1 in corr_df.columns:
                for c2 in corr_df.columns:
                    if c1 < c2:
                        val = _safe_float(corr_df.loc[c1, c2])
                        if val is not None:
                            correlations[f"{c1} x {c2}"] = val
        except Exception:
            pass

    return {
        "row_count": row_count,
        "col_count": col_count,
        "numeric_cols": numeric_cols,
        "categorical_cols": categorical_cols,
        "datetime_cols": datetime_cols,
        "columns": columns_info,
        "correlations": correlations,
        "sample_rows": df.head(5).to_dict(orient="records"),
    }


def _format_profile_for_llm(profile: dict[str, Any]) -> str:
    """Format profile as a concise text for LLM prompts."""
    lines = [
        f"Rows: {profile['row_count']}, Columns: {profile['col_count']}",
        f"Numeric columns: {', '.join(profile['numeric_cols']) or 'none'}",
        f"Categorical columns: {', '.join(profile['categorical_cols']) or 'none'}",
        f"Datetime columns: {', '.join(profile['datetime_cols']) or 'none'}",
        "",
        "Column details:",
    ]
    for col_info in profile["columns"]:
        line = f"  - {col_info['name']} (type={col_info['dtype']}, missing={col_info['missing_pct']}%, unique={col_info['unique']})"
        if "stats" in col_info:
            s = col_info["stats"]
            line += f" [min={s['min']}, max={s['max']}, mean={s['mean']}, median={s['median']}]"
        if "top_values" in col_info:
            top = list(col_info["top_values"].items())[:5]
            line += f" [top: {', '.join(f'{k}={v}' for k, v in top)}]"
        lines.append(line)

    if profile.get("correlations"):
        lines.append("")
        lines.append("Notable correlations:")
        sorted_corr = sorted(profile["correlations"].items(), key=lambda x: abs(x[1]), reverse=True)
        for pair, val in sorted_corr[:10]:
            lines.append(f"  - {pair}: {val:.3f}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Step 2: General observations (LLM)
# ---------------------------------------------------------------------------

async def _generate_observations(
    profile: dict[str, Any],
    source_name: str,
    llm_overrides: dict | None,
    channel: str,
    language: str | None = None,
) -> str:
    profile_text = _format_profile_for_llm(profile)
    sample_json = json.dumps(profile["sample_rows"][:3], ensure_ascii=False, default=str)

    system = (
        "You are a senior data analyst. Given a dataset profile, write a detailed general observations section for a data report. "
        "Cover: data overview, column types and meanings, data quality (missing values, anomalies), "
        "distributions and notable patterns, and recommendations for further analysis. "
        + _language_instruction(language) +
        "Use HTML formatting: <h3> for subsections, <p> for paragraphs, <ul>/<li> for lists, <strong> for emphasis. "
        "Do NOT wrap in a full HTML document. Return only the inner content. "
        "Be thorough and insightful. Maximum 600 words."
    )
    user = (
        f"Source: {source_name}\n\n"
        f"Profile:\n{profile_text}\n\n"
        f"Sample rows:\n{sample_json}\n\n"
        "Write the general observations section."
    )

    content, usage, trace = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    trace["stage"] = "report_observations"
    await record_log(
        action="report",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )
    return (content or "").strip()


# ---------------------------------------------------------------------------
# Step 3: Chart planning (LLM)
# ---------------------------------------------------------------------------

def _extract_json_array(raw: str) -> list[dict[str, Any]]:
    """Extract a JSON array from LLM response."""
    cleaned = (raw or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "charts" in data:
            return data["charts"]
    except json.JSONDecodeError:
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(cleaned[start : end + 1])
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass
    return []


async def _plan_charts(
    profile: dict[str, Any],
    source_name: str,
    llm_overrides: dict | None,
    channel: str,
) -> list[dict[str, Any]]:
    profile_text = _format_profile_for_llm(profile)

    system = (
        "You are a data visualization expert. Given a dataset profile, plan the best exploratory charts. "
        "Return ONLY a JSON array of chart specifications. Each chart object must have:\n"
        '  - "chartType": one of "histogram", "bar", "pie", "line", "scatter", "heatmap", "box", "missing"\n'
        '  - "title": descriptive title for the chart\n'
        '  - "columns": array of column names to use\n'
        '  - "description": brief description of what the chart shows\n'
        f"Plan between 3 and {MAX_CHARTS} charts. Choose charts that reveal the most insight about the data.\n"
        "Guidelines:\n"
        "- Use histogram for numeric distributions\n"
        "- Use bar for categorical value counts (top values)\n"
        "- Use pie only when a categorical column has <= 6 unique values\n"
        "- Use scatter for interesting correlations between numeric columns\n"
        "- Use heatmap only if there are 3+ numeric columns (correlation matrix)\n"
        "- Use box for numeric columns with potential outliers\n"
        "- Use missing only if there are columns with significant missing data (>5%)\n"
        "- Use line if there is a datetime column with a numeric column\n"
        "Return ONLY the JSON array, no other text."
    )
    user = f"Source: {source_name}\n\nProfile:\n{profile_text}\n\nPlan the best exploratory charts."

    content, usage, trace = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=1500,
        llm_overrides=llm_overrides,
    )
    trace["stage"] = "report_chart_plan"
    await record_log(
        action="report",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )

    charts = _extract_json_array(content or "")
    # Validate and cap
    valid = []
    allowed_types = {"histogram", "bar", "pie", "line", "scatter", "heatmap", "box", "missing"}
    for chart in charts[:MAX_CHARTS]:
        if not isinstance(chart, dict):
            continue
        ct = str(chart.get("chartType", "")).strip().lower()
        if ct not in allowed_types:
            continue
        cols = chart.get("columns", [])
        if not isinstance(cols, list):
            continue
        # Verify columns exist
        all_col_names = [c["name"] for c in profile["columns"]]
        valid_cols = [c for c in cols if c in all_col_names]
        if not valid_cols and ct != "missing" and ct != "heatmap":
            continue
        chart["chartType"] = ct
        chart["columns"] = valid_cols
        valid.append(chart)

    # Fallback: if LLM returned nothing, create basic charts
    if not valid:
        valid = _fallback_chart_plan(profile)

    return valid


def _fallback_chart_plan(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Create a basic chart plan when LLM fails."""
    charts: list[dict[str, Any]] = []
    for col in profile["numeric_cols"][:2]:
        charts.append({
            "chartType": "histogram",
            "title": f"Distribution of {col}",
            "columns": [col],
            "description": f"Histogram showing the distribution of {col}",
        })
    for col in profile["categorical_cols"][:2]:
        charts.append({
            "chartType": "bar",
            "title": f"Top values of {col}",
            "columns": [col],
            "description": f"Bar chart showing the most frequent values of {col}",
        })
    if len(profile["numeric_cols"]) >= 3:
        charts.append({
            "chartType": "heatmap",
            "title": "Correlation Matrix",
            "columns": profile["numeric_cols"][:8],
            "description": "Heatmap of correlations between numeric columns",
        })
    # Missing values
    missing_cols = [c["name"] for c in profile["columns"] if c["missing_pct"] > 5]
    if missing_cols:
        charts.append({
            "chartType": "missing",
            "title": "Missing Values",
            "columns": missing_cols[:10],
            "description": "Overview of missing values per column",
        })
    return charts[:MAX_CHARTS]


# ---------------------------------------------------------------------------
# Step 4: Chart rendering (Matplotlib -> base64 PNG)
# ---------------------------------------------------------------------------

def _setup_matplotlib_theme():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "figure.facecolor": PLATFORM_THEME["figure_bg"],
        "axes.facecolor": PLATFORM_THEME["axes_bg"],
        "axes.edgecolor": PLATFORM_THEME["grid"],
        "axes.labelcolor": PLATFORM_THEME["text"],
        "axes.titlecolor": PLATFORM_THEME["text"],
        "xtick.color": PLATFORM_THEME["muted"],
        "ytick.color": PLATFORM_THEME["muted"],
        "text.color": PLATFORM_THEME["text"],
        "font.size": 11,
    })
    return plt


def _fig_to_base64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, facecolor=PLATFORM_THEME["figure_bg"], bbox_inches="tight")
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    buf.close()
    return b64


def _render_histogram(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    import numpy as np
    col = chart["columns"][0] if chart["columns"] else None
    if not col or col not in df.columns:
        return None
    data = df[col].dropna()
    if data.empty:
        return None

    fig, ax = plt.subplots(figsize=(9, 5), constrained_layout=True)
    ax.grid(axis="y", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    n_bins = min(30, max(10, len(data) // 20))
    ax.hist(data, bins=n_bins, color=PALETTE[0], edgecolor=PLATFORM_THEME["axes_bg"], alpha=0.85)
    ax.set_title(chart.get("title", col), loc="left", fontsize=14, fontweight="bold", pad=14)
    ax.set_xlabel(col, labelpad=8)
    ax.set_ylabel("Frequency", labelpad=8)
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_bar(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    col = chart["columns"][0] if chart["columns"] else None
    if not col or col not in df.columns:
        return None
    counts = df[col].dropna().astype(str).value_counts().head(MAX_CATEGORIES_PER_CHART)
    if counts.empty:
        return None

    fig, ax = plt.subplots(figsize=(9, 5), constrained_layout=True)
    ax.grid(axis="x", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(counts))]
    ax.barh(counts.index[::-1], counts.values[::-1], color=colors[::-1], height=0.6)
    ax.set_title(chart.get("title", col), loc="left", fontsize=14, fontweight="bold", pad=14)
    ax.set_xlabel("Count", labelpad=8)
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_pie(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    col = chart["columns"][0] if chart["columns"] else None
    if not col or col not in df.columns:
        return None
    counts = df[col].dropna().astype(str).value_counts().head(8)
    if counts.empty:
        return None

    fig, ax = plt.subplots(figsize=(8, 6), constrained_layout=True)
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(counts))]
    wedges, texts, autotexts = ax.pie(
        counts.values,
        labels=counts.index,
        autopct="%1.1f%%",
        startangle=90,
        colors=colors,
        textprops={"color": PLATFORM_THEME["text"]},
        wedgeprops={"linewidth": 1, "edgecolor": PLATFORM_THEME["figure_bg"]},
    )
    for auto in autotexts:
        auto.set_color(PLATFORM_THEME["figure_bg"])
        auto.set_fontweight("bold")
    ax.set_title(chart.get("title", col), loc="center", fontsize=14, fontweight="bold", pad=14)
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_line(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    cols = chart.get("columns", [])
    if len(cols) < 2:
        return None
    x_col, y_col = cols[0], cols[1]
    if x_col not in df.columns or y_col not in df.columns:
        return None

    temp = df[[x_col, y_col]].dropna()
    if temp.empty:
        return None

    # Try to parse x as datetime
    try:
        temp[x_col] = pd.to_datetime(temp[x_col])
        temp = temp.sort_values(x_col)
    except Exception:
        temp = temp.sort_values(x_col)

    # Sample if too many points
    if len(temp) > 200:
        temp = temp.iloc[:: len(temp) // 200 + 1]

    fig, ax = plt.subplots(figsize=(10, 5), constrained_layout=True)
    ax.grid(axis="y", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.plot(temp[x_col], temp[y_col], color=PALETTE[0], linewidth=2, marker="o", markersize=3, alpha=0.8)
    ax.set_title(chart.get("title", f"{y_col} over {x_col}"), loc="left", fontsize=14, fontweight="bold", pad=14)
    ax.set_xlabel(x_col, labelpad=8)
    ax.set_ylabel(y_col, labelpad=8)
    fig.autofmt_xdate()
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_scatter(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    cols = chart.get("columns", [])
    if len(cols) < 2:
        return None
    x_col, y_col = cols[0], cols[1]
    if x_col not in df.columns or y_col not in df.columns:
        return None

    temp = df[[x_col, y_col]].dropna()
    if temp.empty:
        return None
    if len(temp) > 500:
        temp = temp.sample(n=500, random_state=42)

    fig, ax = plt.subplots(figsize=(9, 6), constrained_layout=True)
    ax.grid(color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.scatter(temp[x_col], temp[y_col], color=PALETTE[0], alpha=0.6, s=30, edgecolors=PALETTE[1], linewidths=0.5)
    ax.set_title(chart.get("title", f"{x_col} vs {y_col}"), loc="left", fontsize=14, fontweight="bold", pad=14)
    ax.set_xlabel(x_col, labelpad=8)
    ax.set_ylabel(y_col, labelpad=8)
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_heatmap(df: pd.DataFrame, chart: dict[str, Any], profile: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    import numpy as np
    cols = chart.get("columns") or profile.get("numeric_cols", [])
    cols = [c for c in cols if c in df.columns][:10]
    if len(cols) < 2:
        return None

    corr = df[cols].corr()
    fig, ax = plt.subplots(figsize=(max(6, len(cols) * 0.9), max(5, len(cols) * 0.8)), constrained_layout=True)
    im = ax.imshow(corr.values, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    ax.set_xticks(range(len(cols)))
    ax.set_yticks(range(len(cols)))
    ax.set_xticklabels(cols, rotation=45, ha="right", fontsize=9)
    ax.set_yticklabels(cols, fontsize=9)

    # Annotate cells
    for i in range(len(cols)):
        for j in range(len(cols)):
            val = corr.values[i, j]
            if math.isfinite(val):
                color = PLATFORM_THEME["figure_bg"] if abs(val) > 0.5 else PLATFORM_THEME["text"]
                ax.text(j, i, f"{val:.2f}", ha="center", va="center", color=color, fontsize=8)

    fig.colorbar(im, ax=ax, shrink=0.8)
    ax.set_title(chart.get("title", "Correlation Matrix"), loc="left", fontsize=14, fontweight="bold", pad=14)
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_box(df: pd.DataFrame, chart: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    cols = [c for c in chart.get("columns", []) if c in df.columns]
    if not cols:
        return None

    data_to_plot = [df[c].dropna().values for c in cols]
    data_to_plot = [d for d in data_to_plot if len(d) > 0]
    if not data_to_plot:
        return None

    fig, ax = plt.subplots(figsize=(max(6, len(cols) * 1.2), 5), constrained_layout=True)
    ax.grid(axis="y", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    bp = ax.boxplot(
        data_to_plot,
        labels=cols[:len(data_to_plot)],
        patch_artist=True,
        boxprops={"facecolor": PALETTE[0], "alpha": 0.7},
        medianprops={"color": PLATFORM_THEME["warning"], "linewidth": 2},
        whiskerprops={"color": PLATFORM_THEME["muted"]},
        capprops={"color": PLATFORM_THEME["muted"]},
        flierprops={"markerfacecolor": PALETTE[4] if len(PALETTE) > 4 else PALETTE[0], "markersize": 4, "alpha": 0.6},
    )
    ax.set_title(chart.get("title", "Box Plot"), loc="left", fontsize=14, fontweight="bold", pad=14)
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_missing(df: pd.DataFrame, chart: dict[str, Any], profile: dict[str, Any]) -> str | None:
    plt = _setup_matplotlib_theme()
    cols = chart.get("columns") or [c["name"] for c in profile["columns"] if c["missing"] > 0]
    cols = [c for c in cols if c in df.columns][:15]
    if not cols:
        return None

    missing_pcts = [(c, df[c].isna().sum() / len(df) * 100) for c in cols if df[c].isna().sum() > 0]
    if not missing_pcts:
        return None
    missing_pcts.sort(key=lambda x: x[1], reverse=True)
    labels = [m[0] for m in missing_pcts]
    values = [m[1] for m in missing_pcts]

    fig, ax = plt.subplots(figsize=(9, max(4, len(labels) * 0.4)), constrained_layout=True)
    ax.grid(axis="x", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)
    colors = [PALETTE[4] if len(PALETTE) > 4 else PALETTE[0] if v > 30 else PALETTE[3] if v > 10 else PALETTE[0] for v in values]
    ax.barh(labels[::-1], values[::-1], color=colors[::-1], height=0.6)
    ax.set_title(chart.get("title", "Missing Values (%)"), loc="left", fontsize=14, fontweight="bold", pad=14)
    ax.set_xlabel("Missing %", labelpad=8)
    ax.set_xlim(0, 100)
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    b64 = _fig_to_base64(fig)
    plt.close(fig)
    return b64


def _render_chart(df: pd.DataFrame, chart: dict[str, Any], profile: dict[str, Any]) -> str | None:
    """Dispatch chart rendering by type. Returns base64 PNG or None."""
    ct = chart.get("chartType", "")
    try:
        if ct == "histogram":
            return _render_histogram(df, chart)
        elif ct == "bar":
            return _render_bar(df, chart)
        elif ct == "pie":
            return _render_pie(df, chart)
        elif ct == "line":
            return _render_line(df, chart)
        elif ct == "scatter":
            return _render_scatter(df, chart)
        elif ct == "heatmap":
            return _render_heatmap(df, chart, profile)
        elif ct == "box":
            return _render_box(df, chart)
        elif ct == "missing":
            return _render_missing(df, chart, profile)
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
# Step 5: Chart explanations (LLM)
# ---------------------------------------------------------------------------

async def _generate_chart_explanations(
    charts: list[dict[str, Any]],
    profile: dict[str, Any],
    source_name: str,
    llm_overrides: dict | None,
    channel: str,
    language: str | None = None,
) -> list[str]:
    """Generate explanations for all rendered charts in a single LLM call."""
    if not charts:
        return []

    charts_desc = []
    for i, chart in enumerate(charts):
        charts_desc.append(
            f"Chart {i+1}: {chart.get('title', 'Untitled')} "
            f"(type={chart.get('chartType')}, columns={chart.get('columns', [])})"
        )

    profile_text = _format_profile_for_llm(profile)

    system = (
        "You are a data analyst. For each chart listed below, write a concise explanation (2-4 sentences) "
        "describing what the chart reveals about the data, any interesting patterns, and actionable insights. "
        + _language_instruction(language) +
        "Return a JSON array of strings, one explanation per chart, in the same order. "
        "Return ONLY the JSON array."
    )
    user = (
        f"Source: {source_name}\n\n"
        f"Dataset profile:\n{profile_text}\n\n"
        f"Charts:\n" + "\n".join(charts_desc) + "\n\n"
        "Write an explanation for each chart."
    )

    content, usage, trace = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    trace["stage"] = "report_chart_explanations"
    await record_log(
        action="report",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )

    # Parse JSON array of strings
    raw = (content or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
    try:
        explanations = json.loads(raw)
        if isinstance(explanations, list):
            return [str(e) for e in explanations]
    except json.JSONDecodeError:
        pass

    # Fallback: split by numbered items or return chart descriptions
    return [chart.get("description", "") for chart in charts]


# ---------------------------------------------------------------------------
# Step 6: HTML assembly
# ---------------------------------------------------------------------------

def _assemble_html(
    source_name: str,
    observations: str,
    charts: list[dict[str, Any]],
    explanations: list[str],
    profile: dict[str, Any],
) -> str:
    """Assemble the final HTML report with embedded base64 charts."""
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    # Build profile table rows
    profile_rows = ""
    for col_info in profile["columns"]:
        stats_str = ""
        if "stats" in col_info:
            s = col_info["stats"]
            stats_str = f"min={s.get('min')}, max={s.get('max')}, mean={s.get('mean')}"
        elif "top_values" in col_info:
            top = list(col_info["top_values"].items())[:3]
            stats_str = ", ".join(f"{k} ({v})" for k, v in top)

        profile_rows += f"""
            <tr>
                <td>{col_info['name']}</td>
                <td>{col_info['dtype']}</td>
                <td>{col_info['unique']}</td>
                <td>{col_info['missing']} ({col_info['missing_pct']}%)</td>
                <td>{stats_str}</td>
            </tr>"""

    # Build chart sections
    chart_sections = ""
    for i, chart in enumerate(charts):
        b64 = chart.get("_base64")
        if not b64:
            continue
        explanation = explanations[i] if i < len(explanations) else ""
        chart_sections += f"""
        <div class="chart-section">
            <h3>{chart.get('title', f'Chart {i+1}')}</h3>
            <div class="chart-container">
                <img src="data:image/png;base64,{b64}" alt="{chart.get('title', '')}" />
            </div>
            <div class="chart-explanation">
                <p>{explanation}</p>
            </div>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Report - {source_name}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: {PLATFORM_THEME['figure_bg']};
            color: {PLATFORM_THEME['text']};
            line-height: 1.6;
            padding: 0;
        }}
        .report-container {{
            max-width: 1000px;
            margin: 0 auto;
            padding: 32px 24px;
        }}
        .report-header {{
            border-bottom: 2px solid {PLATFORM_THEME['primary']};
            padding-bottom: 20px;
            margin-bottom: 32px;
        }}
        .report-header h1 {{
            font-size: 28px;
            font-weight: 700;
            color: {PLATFORM_THEME['text']};
            margin-bottom: 8px;
        }}
        .report-header .subtitle {{
            color: {PLATFORM_THEME['muted']};
            font-size: 14px;
        }}
        .section {{
            margin-bottom: 40px;
        }}
        .section h2 {{
            font-size: 20px;
            font-weight: 600;
            color: {PLATFORM_THEME['primary']};
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid {PLATFORM_THEME['grid']};
        }}
        .section h3 {{
            font-size: 16px;
            font-weight: 600;
            color: {PLATFORM_THEME['text']};
            margin-bottom: 10px;
            margin-top: 16px;
        }}
        .section p {{
            margin-bottom: 10px;
            color: {PLATFORM_THEME['text']};
        }}
        .section ul, .section ol {{
            padding-left: 24px;
            margin-bottom: 12px;
        }}
        .section li {{
            margin-bottom: 4px;
        }}
        strong {{
            color: {PALETTE[0]};
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 13px;
        }}
        th, td {{
            padding: 10px 12px;
            text-align: left;
            border: 1px solid {PLATFORM_THEME['grid']};
        }}
        th {{
            background-color: {PLATFORM_THEME['axes_bg']};
            font-weight: 600;
            color: {PLATFORM_THEME['text']};
        }}
        td {{
            background-color: {PLATFORM_THEME['figure_bg']};
        }}
        tr:hover td {{
            background-color: {PLATFORM_THEME['axes_bg']};
        }}
        .chart-section {{
            margin-bottom: 36px;
            background: {PLATFORM_THEME['axes_bg']};
            border-radius: 12px;
            padding: 20px;
            border: 1px solid {PLATFORM_THEME['grid']};
        }}
        .chart-section h3 {{
            margin-top: 0;
            margin-bottom: 16px;
            color: {PLATFORM_THEME['text']};
        }}
        .chart-container {{
            text-align: center;
            margin-bottom: 16px;
        }}
        .chart-container img {{
            max-width: 100%;
            height: auto;
            border-radius: 8px;
        }}
        .chart-explanation {{
            background: {PLATFORM_THEME['figure_bg']};
            border-radius: 8px;
            padding: 14px 16px;
            border-left: 3px solid {PLATFORM_THEME['primary']};
        }}
        .chart-explanation p {{
            color: {PLATFORM_THEME['muted']};
            font-size: 14px;
            margin: 0;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin: 16px 0;
        }}
        .stat-card {{
            background: {PLATFORM_THEME['axes_bg']};
            border-radius: 8px;
            padding: 16px;
            border: 1px solid {PLATFORM_THEME['grid']};
            text-align: center;
        }}
        .stat-card .value {{
            font-size: 28px;
            font-weight: 700;
            color: {PLATFORM_THEME['primary']};
        }}
        .stat-card .label {{
            font-size: 12px;
            color: {PLATFORM_THEME['muted']};
            margin-top: 4px;
        }}
        .footer {{
            margin-top: 48px;
            padding-top: 16px;
            border-top: 1px solid {PLATFORM_THEME['grid']};
            text-align: center;
            color: {PLATFORM_THEME['muted']};
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="report-container">
        <div class="report-header">
            <h1>Exploratory Data Report</h1>
            <div class="subtitle">{source_name} &mdash; Generated at {generated_at}</div>
        </div>

        <!-- Quick Stats -->
        <div class="section">
            <h2>Dataset Overview</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="value">{profile['row_count']:,}</div>
                    <div class="label">Rows</div>
                </div>
                <div class="stat-card">
                    <div class="value">{profile['col_count']}</div>
                    <div class="label">Columns</div>
                </div>
                <div class="stat-card">
                    <div class="value">{len(profile['numeric_cols'])}</div>
                    <div class="label">Numeric</div>
                </div>
                <div class="stat-card">
                    <div class="value">{len(profile['categorical_cols'])}</div>
                    <div class="label">Categorical</div>
                </div>
                <div class="stat-card">
                    <div class="value">{len(profile['datetime_cols'])}</div>
                    <div class="label">DateTime</div>
                </div>
            </div>
        </div>

        <!-- General Observations -->
        <div class="section">
            <h2>General Observations</h2>
            {observations}
        </div>

        <!-- Data Profile Table -->
        <div class="section">
            <h2>Column Profile</h2>
            <table>
                <thead>
                    <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Unique</th>
                        <th>Missing</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    {profile_rows}
                </tbody>
            </table>
        </div>

        <!-- Exploratory Charts -->
        <div class="section">
            <h2>Exploratory Charts</h2>
            {chart_sections if chart_sections else '<p style="color: ' + PLATFORM_THEME["muted"] + ';">No charts could be generated for this dataset.</p>'}
        </div>

        <div class="footer">
            Generated by Data Talks &mdash; Exploratory Data Report
        </div>
    </div>
</body>
</html>"""

    return html


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def generate_report(
    df: pd.DataFrame,
    source_name: str,
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Full report generation pipeline.
    Returns: {"html_content": str, "chart_count": int}
    """
    # Cap rows for profiling
    if len(df) > MAX_ROWS_FOR_PROFILE:
        df_profile = df.sample(n=MAX_ROWS_FOR_PROFILE, random_state=42)
    else:
        df_profile = df

    # Step 1: Profile
    profile = _profile_dataframe(df_profile)

    # Step 2: Observations (LLM call #1)
    try:
        observations = await _generate_observations(profile, source_name, llm_overrides, channel, language=language)
    except (ValueError, Exception) as exc:
        if "api_key" in str(exc).lower() or "api key" in str(exc).lower():
            raise ValueError(
                "LLM API key error during report generation. "
                "Please check your API key in Account > LLM / AI settings."
            ) from exc
        raise

    # Step 3: Plan charts (LLM call #2)
    chart_plans = await _plan_charts(profile, source_name, llm_overrides, channel)

    # Step 4: Render charts
    rendered_charts = []
    for chart in chart_plans:
        b64 = _render_chart(df_profile, chart, profile)
        if b64:
            chart["_base64"] = b64
            rendered_charts.append(chart)

    # Step 5: Explanations (LLM call #3)
    explanations = await _generate_chart_explanations(
        rendered_charts, profile, source_name, llm_overrides, channel, language=language
    )

    # Step 6: Assemble HTML
    html_content = _assemble_html(source_name, observations, rendered_charts, explanations, profile)

    return {
        "html_content": html_content,
        "chart_count": len(rendered_charts),
    }
