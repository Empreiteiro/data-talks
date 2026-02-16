"""
LLM client: OpenAI API or Ollama (local open-source model).
Configure via LLM_PROVIDER, OPENAI_API_KEY, OLLAMA_BASE_URL, etc.
User overrides from settings API take precedence over env vars.
"""
from typing import Any
from app.config import get_settings


def _effective_settings(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge env settings with user overrides. overrides can partially override."""
    s = get_settings()
    base = {
        "llm_provider": s.llm_provider,
        "openai_api_key": s.openai_api_key or "",
        "openai_model": s.openai_model,
        "ollama_base_url": s.ollama_base_url,
        "ollama_model": s.ollama_model,
        "litellm_base_url": s.litellm_base_url,
        "litellm_model": s.litellm_model,
        "litellm_api_key": s.litellm_api_key or "",
    }
    if overrides:
        for k, v in overrides.items():
            if v is not None and v != "":
                base[k] = v
    return base


async def chat_completion(
    messages: list[dict[str, str]],
    max_tokens: int = 4096,
    llm_overrides: dict[str, Any] | None = None,
) -> str:
    """Returns only the assistant reply text. llm_overrides override env/user settings."""
    cfg = _effective_settings(llm_overrides)
    provider = cfg["llm_provider"]
    if provider == "ollama":
        return await _ollama_chat(messages, max_tokens, cfg)
    if provider == "litellm":
        return await _litellm_chat(messages, max_tokens, cfg)
    return await _openai_chat(messages, max_tokens, cfg)


async def _openai_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> str:
    from openai import AsyncOpenAI
    api_key = cfg.get("openai_api_key") or None
    client = AsyncOpenAI(api_key=api_key)
    resp = await client.chat.completions.create(
        model=cfg.get("openai_model", "gpt-4o-mini"),
        messages=messages,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


async def _ollama_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> str:
    import httpx
    base_url = (cfg.get("ollama_base_url") or "http://localhost:11434").rstrip("/")
    url = f"{base_url}/api/chat"
    payload = {
        "model": cfg.get("ollama_model", "llama3.2"),
        "messages": messages,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    return (data.get("message", {}).get("content") or "").strip()


async def _litellm_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> str:
    """Use LiteLLM proxy (OpenAI-compatible API)."""
    from openai import AsyncOpenAI
    base_url = (cfg.get("litellm_base_url") or "http://localhost:4000").rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"  # LiteLLM proxy expects /v1
    api_key = cfg.get("litellm_api_key") or "not-needed"  # proxy may not require auth
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    resp = await client.chat.completions.create(
        model=cfg.get("litellm_model", "gpt-4o-mini"),
        messages=messages,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()
