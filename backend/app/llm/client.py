"""
LLM client: OpenAI API or Ollama (local open-source model).
Configure via LLM_PROVIDER, OPENAI_API_KEY, OLLAMA_BASE_URL, etc.
"""
from app.config import get_settings


async def chat_completion(
    messages: list[dict[str, str]],
    max_tokens: int = 4096,
) -> str:
    """Returns only the assistant reply text."""
    settings = get_settings()
    if settings.llm_provider == "ollama":
        return await _ollama_chat(messages, max_tokens)
    return await _openai_chat(messages, max_tokens)


async def _openai_chat(messages: list[dict[str, str]], max_tokens: int) -> str:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=get_settings().openai_api_key or None)
    resp = await client.chat.completions.create(
        model=get_settings().openai_model,
        messages=messages,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


async def _ollama_chat(messages: list[dict[str, str]], max_tokens: int) -> str:
    import httpx
    url = f"{get_settings().ollama_base_url.rstrip('/')}/api/chat"
    payload = {
        "model": get_settings().ollama_model,
        "messages": messages,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    return (data.get("message", {}).get("content") or "").strip()
