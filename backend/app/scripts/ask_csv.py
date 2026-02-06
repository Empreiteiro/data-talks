"""
Answer questions about CSV/XLSX data using an LLM (OpenAI or Ollama).
Replaces the ask-question-csv edge function and Langflow flow.
"""
from pathlib import Path
from typing import Any
import pandas as pd
from app.llm.client import chat_completion


async def ask_csv(
    file_path: str,
    question: str,
    agent_description: str = "",
    columns: list[str] | None = None,
    preview_rows: list[dict] | None = None,
    data_files_dir: str = "./data_files",
) -> dict[str, Any]:
    """
    file_path: path relative to data_files (e.g. user_id/timestamp.csv).
    question: natural language question.
    Returns: { "answer", "imageUrl" (optional), "followUpQuestions" }.
    """
    full_path = Path(data_files_dir) / file_path
    if not full_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Use provided columns/preview from source metadata if available; otherwise read file
    if columns and preview_rows is not None:
        schema_text = _format_schema(columns, preview_rows)
        sample_json = str(preview_rows[:10])
    else:
        df = pd.read_csv(full_path, nrows=500)
        columns = list(df.columns)
        preview = df.head(10).to_dict(orient="records")
        schema_text = _format_schema(columns, preview)
        sample_json = str(preview)

    system = (
        "You are an assistant that answers questions about tabular data (CSV/spreadsheet). "
        "Answer clearly and concisely. Use only the columns and sample data provided. "
        "If the question requires calculations or aggregations, describe the reasoning and result. "
        "At the end, if appropriate, suggest up to 3 follow-up questions (one per line, each ending with '?')."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"Schema and columns: {schema_text}\n\n"
        f"Sample data (up to 10 rows):\n{sample_json}\n\n"
        f"User question: {question}"
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    answer = await chat_completion(messages, max_tokens=2048)

    # Extract follow-up questions (lines ending with ?)
    follow_up = []
    for line in answer.split("\n"):
        line = line.strip().replace("^[0-9]+\\.\\s*", "").replace("^-\\s*", "").strip()
        if line.endswith("?") and len(line) > 15:
            follow_up.append(line)
    follow_up = list(dict.fromkeys(follow_up))[:3]

    return {
        "answer": answer,
        "imageUrl": None,  # Optional: add chart generation (matplotlib/plotly → base64)
        "followUpQuestions": follow_up,
    }


def _format_schema(columns: list[str], preview_rows: list[dict]) -> str:
    return "Columns: " + ", ".join(columns)
