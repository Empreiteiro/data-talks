"""
LLM client: OpenAI API or Ollama (local open-source model).
Configure via LLM_PROVIDER, OPENAI_API_KEY, OLLAMA_BASE_URL, etc.
User overrides from settings API take precedence over env vars.

Returns (content, usage) where usage = {provider, model, input_tokens, output_tokens}.
"""
from datetime import datetime, timezone
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


def _usage(
    provider: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }


async def chat_completion(
    messages: list[dict[str, str]],
    max_tokens: int = 4096,
    llm_overrides: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """
    Returns (content, usage). content is the assistant reply text.
    usage = {provider, model, input_tokens, output_tokens}.
    llm_overrides override env/user settings.
    """
    cfg = _effective_settings(llm_overrides)
    provider = cfg["llm_provider"]
    if provider == "ollama":
        return await _ollama_chat(messages, max_tokens, cfg)
    if provider == "litellm":
        return await _litellm_chat(messages, max_tokens, cfg)
    return await _openai_chat(messages, max_tokens, cfg)


async def _openai_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    from openai import AsyncOpenAI

    api_key = cfg.get("openai_api_key") or None
    model = cfg.get("openai_model", "gpt-4o-mini")
    client = AsyncOpenAI(api_key=api_key)
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    content = (resp.choices[0].message.content or "").strip()
    usage_data = resp.usage
    input_t = getattr(usage_data, "prompt_tokens", None) or getattr(usage_data, "input_tokens", 0) if usage_data else 0
    output_t = getattr(usage_data, "completion_tokens", None) or getattr(usage_data, "output_tokens", 0) if usage_data else 0
    return content, _usage("openai", model, input_t or 0, output_t or 0)


async def _ollama_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    import httpx

    model = cfg.get("ollama_model", "llama3.2")
    base_url = (cfg.get("ollama_base_url") or "http://localhost:11434").rstrip("/")
    url = f"{base_url}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    content = (data.get("message", {}).get("content") or "").strip()
    input_t = data.get("prompt_eval_count", 0)
    output_t = data.get("eval_count", 0)
    return content, _usage("ollama", model, input_t, output_t)


async def _litellm_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Use LiteLLM proxy (OpenAI-compatible API)."""
    from openai import AsyncOpenAI

    model = cfg.get("litellm_model", "gpt-4o-mini")
    base_url = (cfg.get("litellm_base_url") or "http://localhost:4000").rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    api_key = cfg.get("litellm_api_key") or "not-needed"
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    content = (resp.choices[0].message.content or "").strip()
    usage_data = resp.usage
    input_t = getattr(usage_data, "prompt_tokens", None) or getattr(usage_data, "input_tokens", 0) if usage_data else 0
    output_t = getattr(usage_data, "completion_tokens", None) or getattr(usage_data, "output_tokens", 0) if usage_data else 0
    return content, _usage("litellm", model, input_t or 0, output_t or 0)
