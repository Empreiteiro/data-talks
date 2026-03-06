"""
Helpers to derive chart specs from QA answers and render them with Matplotlib.
"""
import json
import math
import re
from pathlib import Path
from typing import Any

from app.llm.client import chat_completion

MAX_PROMPT_ROWS = 30
MAX_CATEGORIES = 12

PLATFORM_THEME = {
    "figure_bg": "#14141a",
    "axes_bg": "#1d1d24",
    "grid": "#30303b",
    "text": "#f2f2f2",
    "muted": "#9a9aa6",
    "primary": "#2f80ff",
    "accent": "#8b5cf6",
    "success": "#22c55e",
    "warning": "#f59e0b",
}

PALETTE = [
    PLATFORM_THEME["primary"],
    PLATFORM_THEME["accent"],
    PLATFORM_THEME["success"],
    PLATFORM_THEME["warning"],
    "#ef4444",
    "#06b6d4",
]


def _safe_json_value(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _safe_json_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_safe_json_value(v) for v in value]
    if hasattr(value, "item"):
        try:
            return _safe_json_value(value.item())
        except Exception:
            return None
    return str(value)


def build_chart_input(
    query_results: list[dict] | None,
    schema_text: str = "",
) -> dict[str, Any] | None:
    rows = query_results or []
    if not rows:
        return None
    sanitized = [_safe_json_value(row) for row in rows[:MAX_PROMPT_ROWS]]
    return {
        "rows": sanitized,
        "schemaText": schema_text or "",
        "rowCount": len(rows),
    }


def _extract_json(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(cleaned[start : end + 1])
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                return {}
    return {}


def _coerce_categories(values: list[Any]) -> list[str]:
    return [str(v) for v in values[:MAX_CATEGORIES]]


def _coerce_numeric_series(values: list[Any]) -> list[float]:
    coerced: list[float] = []
    for item in values[:MAX_CATEGORIES]:
        try:
            num = float(item)
        except (TypeError, ValueError):
            continue
        if math.isfinite(num):
            coerced.append(num)
    return coerced


def _normalize_plan(data: dict[str, Any]) -> dict[str, Any] | None:
    if not data:
        return None
    if data.get("suitable") is False:
        return None

    categories = _coerce_categories(data.get("categories") or [])
    raw_series = data.get("series") or []
    if not categories or not isinstance(raw_series, list):
        return None

    series: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_series[:4]):
        if not isinstance(item, dict):
            continue
        values = _coerce_numeric_series(item.get("values") or [])
        if len(values) != len(categories):
            continue
        series.append(
            {
                "name": str(item.get("name") or f"Serie {idx + 1}"),
                "values": values,
            }
        )
    if not series:
        return None

    chart_type = str(data.get("chartType") or "bar").strip().lower()
    if chart_type not in {"bar", "horizontal_bar", "line", "pie"}:
        chart_type = "bar"
    if chart_type == "pie" and len(series) > 1:
        chart_type = "bar"

    return {
        "chartType": chart_type,
        "title": str(data.get("title") or "Grafico gerado pelo agente").strip(),
        "subtitle": str(data.get("subtitle") or "").strip(),
        "xLabel": str(data.get("xLabel") or "").strip(),
        "yLabel": str(data.get("yLabel") or "").strip(),
        "categories": categories,
        "series": series,
        "insight": str(data.get("insight") or "").strip(),
    }


def _heuristic_plan(question: str, answer: str, chart_input: dict[str, Any] | None) -> dict[str, Any] | None:
    rows = (chart_input or {}).get("rows") or []
    if not rows or not isinstance(rows, list):
        return None

    first = rows[0]
    if not isinstance(first, dict):
        return None

    numeric_cols: list[str] = []
    label_cols: list[str] = []
    for key, value in first.items():
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            numeric_cols.append(str(key))
        elif value is not None:
            label_cols.append(str(key))

    if len(rows) == 1 and len(numeric_cols) >= 2:
        return {
            "chartType": "bar",
            "title": question or "Comparativo de metricas",
            "subtitle": "",
            "xLabel": "",
            "yLabel": "",
            "categories": numeric_cols[:MAX_CATEGORIES],
            "series": [{"name": "Valor", "values": [float(first[col]) for col in numeric_cols[:MAX_CATEGORIES]]}],
            "insight": answer[:240],
        }

    if label_cols and numeric_cols:
        label_col = label_cols[0]
        value_col = numeric_cols[0]
        categories = []
        values = []
        for row in rows[:MAX_CATEGORIES]:
            if not isinstance(row, dict):
                continue
            if row.get(label_col) is None or row.get(value_col) is None:
                continue
            try:
                numeric = float(row[value_col])
            except (TypeError, ValueError):
                continue
            if not math.isfinite(numeric):
                continue
            categories.append(str(row[label_col]))
            values.append(numeric)
        if len(categories) >= 2:
            chart_type = "horizontal_bar" if max(len(c) for c in categories) > 18 else "bar"
            return {
                "chartType": chart_type,
                "title": question or "Distribuicao por categoria",
                "subtitle": "",
                "xLabel": label_col if chart_type == "bar" else value_col,
                "yLabel": value_col if chart_type == "bar" else label_col,
                "categories": categories,
                "series": [{"name": value_col, "values": values}],
                "insight": answer[:240],
            }

    return None


async def build_chart_plan(
    question: str,
    answer: str,
    chart_input: dict[str, Any] | None,
    llm_overrides: dict | None = None,
) -> dict[str, Any] | None:
    heuristic = _heuristic_plan(question, answer, chart_input)
    prompt_rows = (chart_input or {}).get("rows") or []
    schema_text = (chart_input or {}).get("schemaText") or ""

    system = (
        "You are designing a single data visualization for a data assistant response. "
        "Use the answer text and the structured rows when available. "
        "Return ONLY valid JSON with keys: suitable (boolean), chartType (bar|horizontal_bar|line|pie), "
        "title (string), subtitle (string), xLabel (string), yLabel (string), categories (array of strings), "
        "series (array of objects with name and values), insight (string). "
        "Only choose suitable=true if the answer can be faithfully charted from the provided data. "
        "Keep at most 12 categories and 4 series. Use only numeric values in series.values."
    )
    user = (
        f"Question: {question}\n\n"
        f"Answer: {answer}\n\n"
        f"Schema: {schema_text or 'not provided'}\n\n"
        f"Rows: {json.dumps(prompt_rows, ensure_ascii=True)}\n\n"
        "Create the best chart plan for this response."
    )

    try:
        raw, _, _ = await chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=900,
            llm_overrides=llm_overrides,
        )
        parsed = _normalize_plan(_extract_json(raw))
        if parsed:
            return parsed
    except Exception:
        pass

    return heuristic


def _dump_plan(plan: dict[str, Any]) -> str:
    return json.dumps(plan, ensure_ascii=True, indent=2)


def build_matplotlib_script(plan: dict[str, Any], output_path: str) -> str:
    plan_json = _dump_plan(plan)
    return f'''import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

PLAN = json.loads(r"""{plan_json}""")
OUTPUT_PATH = r"{output_path}"
THEME = {json.dumps(PLATFORM_THEME, ensure_ascii=True, indent=2)}
PALETTE = {json.dumps(PALETTE, ensure_ascii=True, indent=2)}

plt.rcParams.update({{
    "figure.facecolor": THEME["figure_bg"],
    "axes.facecolor": THEME["axes_bg"],
    "axes.edgecolor": THEME["grid"],
    "axes.labelcolor": THEME["text"],
    "axes.titlecolor": THEME["text"],
    "xtick.color": THEME["muted"],
    "ytick.color": THEME["muted"],
    "text.color": THEME["text"],
    "font.size": 11,
}})

categories = PLAN["categories"]
series = PLAN["series"]
chart_type = PLAN["chartType"]

fig, ax = plt.subplots(figsize=(10.5, 6), constrained_layout=True)
ax.grid(axis="y", color=THEME["grid"], alpha=0.35, linewidth=0.8)
ax.set_axisbelow(True)

if chart_type == "pie":
    values = series[0]["values"]
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(values))]
    wedges, texts, autotexts = ax.pie(
        values,
        labels=categories,
        autopct="%1.1f%%",
        startangle=90,
        colors=colors,
        textprops={{"color": THEME["text"]}},
        wedgeprops={{"linewidth": 1, "edgecolor": THEME["figure_bg"]}},
    )
    for auto in autotexts:
        auto.set_color(THEME["figure_bg"])
        auto.set_fontweight("bold")
elif chart_type == "line":
    x = np.arange(len(categories))
    for idx, item in enumerate(series):
        ax.plot(
            x,
            item["values"],
            marker="o",
            linewidth=2.4,
            markersize=6,
            color=PALETTE[idx % len(PALETTE)],
            label=item["name"],
        )
    ax.set_xticks(x, categories, rotation=0)
else:
    x = np.arange(len(categories))
    if len(series) == 1:
        values = series[0]["values"]
        colors = [PALETTE[i % len(PALETTE)] for i in range(len(values))]
        if chart_type == "horizontal_bar":
            ax.barh(categories, values, color=colors, height=0.62)
        else:
            ax.bar(categories, values, color=colors, width=0.62)
    else:
        width = 0.8 / len(series)
        for idx, item in enumerate(series):
            positions = x + (idx - (len(series) - 1) / 2) * width
            ax.bar(positions, item["values"], width=width, label=item["name"], color=PALETTE[idx % len(PALETTE)])
        ax.set_xticks(x, categories, rotation=0)

ax.set_title(PLAN["title"], loc="left", fontsize=16, fontweight="bold", pad=18)
if PLAN.get("subtitle"):
    ax.text(0, 1.02, PLAN["subtitle"], transform=ax.transAxes, color=THEME["muted"], fontsize=10)
if PLAN.get("xLabel"):
    ax.set_xlabel(PLAN["xLabel"], labelpad=10)
if PLAN.get("yLabel"):
    ax.set_ylabel(PLAN["yLabel"], labelpad=10)
if chart_type != "pie" and len(series) > 1:
    ax.legend(frameon=False, loc="upper right")
for spine in ax.spines.values():
    spine.set_color(THEME["grid"])
if PLAN.get("insight"):
    fig.text(0.013, 0.01, PLAN["insight"][:180], color=THEME["muted"], fontsize=9)
fig.savefig(OUTPUT_PATH, dpi=180, facecolor=THEME["figure_bg"], bbox_inches="tight")
plt.close(fig)
'''


def render_chart(plan: dict[str, Any], output_path: Path) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    output_path.parent.mkdir(parents=True, exist_ok=True)

    plt.rcParams.update(
        {
            "figure.facecolor": PLATFORM_THEME["figure_bg"],
            "axes.facecolor": PLATFORM_THEME["axes_bg"],
            "axes.edgecolor": PLATFORM_THEME["grid"],
            "axes.labelcolor": PLATFORM_THEME["text"],
            "axes.titlecolor": PLATFORM_THEME["text"],
            "xtick.color": PLATFORM_THEME["muted"],
            "ytick.color": PLATFORM_THEME["muted"],
            "text.color": PLATFORM_THEME["text"],
            "font.size": 11,
        }
    )

    categories = plan["categories"]
    series = plan["series"]
    chart_type = plan["chartType"]

    fig, ax = plt.subplots(figsize=(10.5, 6), constrained_layout=True)
    ax.grid(axis="y", color=PLATFORM_THEME["grid"], alpha=0.35, linewidth=0.8)
    ax.set_axisbelow(True)

    if chart_type == "pie":
        values = series[0]["values"]
        colors = [PALETTE[i % len(PALETTE)] for i in range(len(values))]
        _, _, autotexts = ax.pie(
            values,
            labels=categories,
            autopct="%1.1f%%",
            startangle=90,
            colors=colors,
            textprops={"color": PLATFORM_THEME["text"]},
            wedgeprops={"linewidth": 1, "edgecolor": PLATFORM_THEME["figure_bg"]},
        )
        for auto in autotexts:
            auto.set_color(PLATFORM_THEME["figure_bg"])
            auto.set_fontweight("bold")
    elif chart_type == "line":
        x = np.arange(len(categories))
        for idx, item in enumerate(series):
            ax.plot(
                x,
                item["values"],
                marker="o",
                linewidth=2.4,
                markersize=6,
                color=PALETTE[idx % len(PALETTE)],
                label=item["name"],
            )
        ax.set_xticks(x, categories, rotation=0)
    else:
        x = np.arange(len(categories))
        if len(series) == 1:
            values = series[0]["values"]
            colors = [PALETTE[i % len(PALETTE)] for i in range(len(values))]
            if chart_type == "horizontal_bar":
                ax.barh(categories, values, color=colors, height=0.62)
            else:
                ax.bar(categories, values, color=colors, width=0.62)
        else:
            width = 0.8 / len(series)
            for idx, item in enumerate(series):
                positions = x + (idx - (len(series) - 1) / 2) * width
                ax.bar(positions, item["values"], width=width, label=item["name"], color=PALETTE[idx % len(PALETTE)])
            ax.set_xticks(x, categories, rotation=0)

    ax.set_title(plan["title"], loc="left", fontsize=16, fontweight="bold", pad=18)
    if plan.get("subtitle"):
        ax.text(0, 1.02, plan["subtitle"], transform=ax.transAxes, color=PLATFORM_THEME["muted"], fontsize=10)
    if plan.get("xLabel"):
        ax.set_xlabel(plan["xLabel"], labelpad=10)
    if plan.get("yLabel"):
        ax.set_ylabel(plan["yLabel"], labelpad=10)
    if chart_type != "pie" and len(series) > 1:
        ax.legend(frameon=False, loc="upper right")
    for spine in ax.spines.values():
        spine.set_color(PLATFORM_THEME["grid"])
    if plan.get("insight"):
        fig.text(0.013, 0.01, plan["insight"][:180], color=PLATFORM_THEME["muted"], fontsize=9)
    fig.savefig(output_path, dpi=180, facecolor=PLATFORM_THEME["figure_bg"], bbox_inches="tight")
    plt.close(fig)
    return build_matplotlib_script(plan, str(output_path))
