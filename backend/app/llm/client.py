"""
LLM client: OpenAI API or Ollama (local open-source model).
Configure via LLM_PROVIDER, OPENAI_API_KEY, OLLAMA_BASE_URL, etc.
User overrides from settings API take precedence over env vars.

Returns (content, usage, trace). usage = {provider, model, input_tokens, output_tokens}.
trace = optional dict with tool_calls, reasoning, finish_reason, messages_summary, etc.
"""
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings


def _effective_settings(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge env settings with user overrides. overrides can partially override."""
    s = get_settings()
    base = {
        "llm_provider": s.llm_provider,
        "openai_api_key": s.openai_api_key or "",
        "openai_base_url": s.openai_base_url,
        "openai_model": s.openai_model,
        "openai_audio_model": s.openai_audio_model,
        "ollama_base_url": s.ollama_base_url,
        "ollama_model": s.ollama_model,
        "litellm_base_url": s.litellm_base_url,
        "litellm_model": s.litellm_model,
        "litellm_audio_model": s.litellm_audio_model,
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


def get_audio_model(llm_overrides: dict[str, Any] | None = None) -> tuple[str, str]:
    """Return (provider, audio_model) for TTS, or ('', '') if unsupported/not configured."""
    cfg = _effective_settings(llm_overrides)
    provider = cfg.get("llm_provider", "openai")
    if provider == "openai":
        return provider, (cfg.get("openai_audio_model") or "").strip()
    if provider == "litellm":
        return provider, (cfg.get("litellm_audio_model") or "").strip()
    return provider, ""


_MAX_TRACE_CONTENT = 30000  # chars per field to avoid huge DB payloads


def _truncate(s: str, max_len: int = _MAX_TRACE_CONTENT) -> str:
    s = str(s) if s is not None else ""
    return s if len(s) <= max_len else s[:max_len] + "\n...[truncated]"


def _build_trace(
    messages: list[dict[str, Any]],
    message: Any,
    content: str = "",
    finish_reason: str | None = None,
    raw: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build trace dict from LLM response for logging. Includes full input/output for debugging."""
    trace: dict[str, Any] = {
        "messages_count": len(messages),
        "roles": [m.get("role", "?") for m in messages],
        "input_messages": [{"role": m.get("role", "?"), "content": _truncate(m.get("content", ""))} for m in messages],
        "output_content": _truncate(content),
    }
    if messages:
        first_content = messages[0].get("content", "") or ""
        trace["prompt_preview"] = (first_content[:500] + "…") if len(str(first_content)) > 500 else first_content
    if finish_reason:
        trace["finish_reason"] = finish_reason
    if message:
        tc_list = getattr(message, "tool_calls", None)
        if tc_list:
            trace["tool_calls"] = []
            for tc in tc_list:
                fn = getattr(tc, "function", None)
                trace["tool_calls"].append({
                    "id": getattr(tc, "id", ""),
                    "name": getattr(fn, "name", "") if fn else "",
                    "args": getattr(fn, "arguments", "") if fn else "",
                })
        if getattr(message, "reasoning_content", None):
            trace["reasoning"] = message.reasoning_content
    if raw:
        trace["raw"] = raw
    return trace


async def chat_completion(
    messages: list[dict[str, str]],
    max_tokens: int = 4096,
    llm_overrides: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """
    Returns (content, usage, trace). content is the assistant reply text.
    usage = {provider, model, input_tokens, output_tokens}.
    trace = dict with tool_calls, reasoning, messages_summary, etc.
    llm_overrides override env/user settings.
    """
    cfg = _effective_settings(llm_overrides)
    provider = cfg["llm_provider"]
    if provider == "ollama":
        return await _ollama_chat(messages, max_tokens, cfg)
    if provider == "litellm":
        return await _litellm_chat(messages, max_tokens, cfg)
    return await _openai_chat(messages, max_tokens, cfg)


async def _openai_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    from openai import AsyncOpenAI

    api_key = (cfg.get("openai_api_key") or "").strip() or None
    base_url = (cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = cfg.get("openai_model", "gpt-4o-mini")
    if not api_key:
        raise ValueError(
            "OpenAI API key is not configured. "
            "Set it in Account > LLM / AI settings or via the OPENAI_API_KEY environment variable."
        )
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    msg = resp.choices[0].message
    content = (msg.content or "").strip()
    usage_data = resp.usage
    input_t = getattr(usage_data, "prompt_tokens", None) or getattr(usage_data, "input_tokens", 0) if usage_data else 0
    output_t = getattr(usage_data, "completion_tokens", None) or getattr(usage_data, "output_tokens", 0) if usage_data else 0
    finish = getattr(resp.choices[0], "finish_reason", None)
    trace = _build_trace(messages, msg, content=content, finish_reason=finish)
    return content, _usage("openai", model, input_t or 0, output_t or 0), trace


async def _ollama_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Use Ollama's OpenAI-compatible API (/v1/chat/completions)."""
    from openai import AsyncOpenAI

    model = cfg.get("ollama_model", "llama3.2")
    base_url = (cfg.get("ollama_base_url") or "http://localhost:11434").rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    client = AsyncOpenAI(api_key="ollama", base_url=base_url)
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    msg = resp.choices[0].message
    content = (msg.content or "").strip()
    usage_data = resp.usage
    input_t = getattr(usage_data, "prompt_tokens", None) or 0 if usage_data else 0
    output_t = getattr(usage_data, "completion_tokens", None) or 0 if usage_data else 0
    finish = getattr(resp.choices[0], "finish_reason", None)
    trace = _build_trace(messages, msg, content=content, finish_reason=finish)
    return content, _usage("ollama", model, input_t or 0, output_t or 0), trace


async def _litellm_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
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
    msg = resp.choices[0].message
    content = (msg.content or "").strip()
    usage_data = resp.usage
    input_t = getattr(usage_data, "prompt_tokens", None) or getattr(usage_data, "input_tokens", 0) if usage_data else 0
    output_t = getattr(usage_data, "completion_tokens", None) or getattr(usage_data, "output_tokens", 0) if usage_data else 0
    finish = getattr(resp.choices[0], "finish_reason", None)
    trace = _build_trace(messages, msg, content=content, finish_reason=finish)
    return content, _usage("litellm", model, input_t or 0, output_t or 0), trace


async def synthesize_speech(
    text: str,
    llm_overrides: dict[str, Any] | None = None,
) -> tuple[bytes, str, dict[str, Any]]:
    """
    Convert text to speech using the configured provider.
    Supports OpenAI and LiteLLM (OpenAI-compatible /v1/audio/speech).
    Returns (audio_bytes, mime_type, usage).
    """
    cfg = _effective_settings(llm_overrides)
    provider, audio_model = get_audio_model(llm_overrides)
    if provider not in ("openai", "litellm"):
        raise ValueError("Audio overview currently requires an OpenAI or LiteLLM configuration")
    if not audio_model:
        raise ValueError("No audio model configured. Add an audio model in Account > LLM / AI settings")

    if provider == "openai":
        api_key = (cfg.get("openai_api_key") or "").strip()
        if not api_key:
            raise ValueError("OpenAI API key is required for audio generation")
        base_url = (cfg.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
        url = f"{base_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
    else:
        base_url = (cfg.get("litellm_base_url") or "http://localhost:4000").rstrip("/")
        if not base_url.endswith("/v1"):
            base_url = f"{base_url}/v1"
        url = f"{base_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {(cfg.get('litellm_api_key') or 'not-needed').strip() or 'not-needed'}",
            "Content-Type": "application/json",
        }

    payload = {
        "model": audio_model,
        "voice": "alloy",
        "input": text.strip(),
        "response_format": "mp3",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        mime_type = response.headers.get("content-type", "audio/mpeg").split(";")[0].strip() or "audio/mpeg"
        return response.content, mime_type, _usage(provider, audio_model, 0, 0)
