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
        "google_api_key": s.google_api_key or "",
        "google_model": s.google_model,
        "anthropic_api_key": s.anthropic_api_key or "",
        "anthropic_model": s.anthropic_model,
        "claude_code_model": s.claude_code_model,
        "claude_code_oauth_token": s.claude_code_oauth_token or "",
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
    if provider == "google":
        return await _google_chat(messages, max_tokens, cfg)
    if provider == "anthropic":
        return await _anthropic_chat(messages, max_tokens, cfg)
    if provider == "claude-code":
        return await _claude_code_chat(messages, max_tokens, cfg)
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


async def _google_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Use Google Gemini via its OpenAI-compatible API endpoint."""
    from openai import AsyncOpenAI

    api_key = (cfg.get("google_api_key") or "").strip() or None
    model = cfg.get("google_model", "gemini-2.0-flash")
    if not api_key:
        raise ValueError(
            "Google API key is not configured. "
            "Set it in Account > LLM / AI settings or via the GOOGLE_API_KEY environment variable."
        )
    client = AsyncOpenAI(
        api_key=api_key,
        base_url="https://generativelanguage.googleapis.com/openai/",
    )
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
    return content, _usage("google", model, input_t or 0, output_t or 0), trace


async def _anthropic_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Use Anthropic Claude via the official Anthropic SDK."""
    from anthropic import AsyncAnthropic

    api_key = (cfg.get("anthropic_api_key") or "").strip() or None
    model = cfg.get("anthropic_model", "claude-sonnet-4-20250514")
    if not api_key:
        raise ValueError(
            "Anthropic API key is not configured. "
            "Set it in Account > LLM / AI settings or via the ANTHROPIC_API_KEY environment variable."
        )
    # Anthropic API requires system message as a separate parameter
    system_text = ""
    user_messages = []
    for m in messages:
        if m.get("role") == "system":
            system_text = (system_text + "\n" + m.get("content", "")).strip()
        else:
            user_messages.append({"role": m["role"], "content": m.get("content", "")})

    client = AsyncAnthropic(api_key=api_key)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": user_messages,
        "max_tokens": max_tokens,
    }
    if system_text:
        kwargs["system"] = system_text

    resp = await client.messages.create(**kwargs)
    content = ""
    for block in resp.content:
        if getattr(block, "text", None):
            content += block.text
    content = content.strip()
    input_t = getattr(resp.usage, "input_tokens", 0) if resp.usage else 0
    output_t = getattr(resp.usage, "output_tokens", 0) if resp.usage else 0
    finish = getattr(resp, "stop_reason", None)
    trace = _build_trace(messages, None, content=content, finish_reason=finish)
    return content, _usage("anthropic", model, input_t, output_t), trace


async def _claude_code_via_api(
    messages: list[dict[str, str]],
    max_tokens: int,
    cfg: dict[str, Any],
    oauth_token: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Call the Anthropic Messages API directly using a Claude Code OAuth
    bearer token.

    Anthropic's Messages API rejects user-scoped (OAuth) tokens unless
    THREE things hold:

      1. Header `anthropic-beta: oauth-2025-04-20`.
      2. The system block starts with the exact identification string
         the CLI uses: "You are Claude Code, Anthropic's official CLI
         for Claude.". We auto-prepend it.
      3. The request DOES NOT carry an `x-api-key` header, even empty.
         The official `anthropic` Python SDK with `auth_token=...` adds
         BOTH `Authorization: Bearer <token>` AND `x-api-key:` (empty
         string). Anthropic validates `x-api-key` first and returns 401
         on the empty value before the Bearer token is even considered.
         The smaller-prompt /test endpoint sometimes squeezes through
         (probably due to caching / a less-strict path), but anything
         non-trivial 401s.

    To get around #3 we bypass the SDK and use httpx directly so we can
    send only the headers we want.

    Returns the same `(content, usage, trace)` shape as `_anthropic_chat`
    so the dispatch layer is provider-agnostic.
    """
    import httpx

    model = (cfg.get("claude_code_model") or "claude-sonnet-4-20250514").strip()

    system_text = ""
    user_messages = []
    for m in messages:
        if m.get("role") == "system":
            system_text = (system_text + "\n" + m.get("content", "")).strip()
        else:
            user_messages.append({"role": m["role"], "content": m.get("content", "")})

    # Anthropic refuses OAuth requests whose first system block doesn't
    # claim the Claude Code CLI identity. Prepend it once; preserve
    # whatever the caller wanted underneath.
    REQUIRED_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."
    if not system_text.startswith(REQUIRED_PREFIX):
        system_text = REQUIRED_PREFIX + ("\n\n" + system_text if system_text else "")

    payload: dict[str, Any] = {
        "model": model,
        "messages": user_messages,
        "max_tokens": max_tokens,
        "system": system_text,
    }

    # Build headers explicitly. The Authorization Bearer is the OAuth
    # token; we deliberately do NOT include x-api-key (see docstring
    # for why). `anthropic-version` and the OAuth beta are required.
    headers = {
        "Authorization": f"Bearer {oauth_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers=headers,
        )
    if r.status_code >= 400:
        # Surface Anthropic's actual response body — strip noisy HTML
        # to keep the error log short.
        snippet = (r.text or "").strip()[:600]
        raise RuntimeError(
            f"Anthropic Messages API rejected the OAuth token "
            f"(HTTP {r.status_code}): {snippet}"
        )
    data = r.json()

    content = ""
    for block in data.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            content += block["text"]
    content = content.strip()

    usage_block = data.get("usage") or {}
    input_t = usage_block.get("input_tokens", 0)
    output_t = usage_block.get("output_tokens", 0)
    finish = data.get("stop_reason")
    trace = _build_trace(messages, None, content=content, finish_reason=finish)
    return content, _usage("claude-code", model, input_t, output_t), trace


async def _claude_code_chat(messages: list[dict[str, str]], max_tokens: int, cfg: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """
    Use the Claude CLI binary as an LLM provider via async subprocess.

    The CLI is invoked as:
      claude -p "<prompt>" --output-format stream-json --model <model> --verbose

    Authentication: OAuth token passed via CLAUDE_CODE_OAUTH_TOKEN env var
    (loaded from config or ~/.claude/oauth_token).

    Cloud deploys (Railway, Docker, …) usually don't have the `claude`
    binary on the host. When the binary is missing AND the LlmConfig
    carries an OAuth token, we transparently route through
    `_claude_code_via_api` instead of failing — same result, no CLI.
    """
    import asyncio
    import json as _json
    import os
    import shutil
    from pathlib import Path as _Path

    model = cfg.get("claude_code_model", "")

    # ── Discover the claude binary ──
    claude_bin = shutil.which("claude")
    if not claude_bin:
        # macOS Claude Desktop bundle
        support_dir = _Path.home() / "Library" / "Application Support" / "Claude" / "claude-code"
        if support_dir.exists():
            for version_dir in sorted(support_dir.iterdir(), reverse=True):
                candidate = version_dir / "claude.app" / "Contents" / "MacOS" / "claude"
                if candidate.exists():
                    claude_bin = str(candidate)
                    break

    # ── If no binary, try the direct-API fallback ──
    # OAuth token resolution mirrors the env-var lookup later in this
    # function (config > env var > known on-disk locations) so the
    # fallback works for every code path that the CLI path supports.
    def _resolve_oauth_token() -> str | None:
        from pathlib import Path as _P

        t = (cfg.get("claude_code_oauth_token") or "").strip()
        if t:
            return t
        t = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()
        if t:
            return t
        for tp in (
            _P.home() / ".claude" / "oauth_token",
            _P.home() / ".last-intelligence" / "claude_oauth_token",
        ):
            if tp.exists():
                t = tp.read_text().strip()
                if t:
                    return t
        return None

    # Path B: ANY OAuth token we know about → direct Messages API.
    #
    # The CLI binary maintains its OWN credentials (populated by
    # `claude login` into ~/.claude/credentials and checked at CLI start).
    # It does NOT accept the user-scoped OAuth tokens we exchange via
    # `claude_oauth.py` (or any token written to ~/.last-intelligence/...
    # by other Anthropic tooling) — passing one via CLAUDE_CODE_OAUTH_TOKEN
    # makes the CLI exit 1 with "API Error: 401 Invalid authentication
    # credentials".
    #
    # So whenever we have an OAuth token from ANY source — the LlmConfig
    # (user finished the "Login with Claude" flow), the env var (operator
    # set it for a Docker/Railway deploy), or a known on-disk path — we
    # route through `_claude_code_via_api`, which sends the token as a
    # bearer with the required `anthropic-beta: oauth-2025-04-20` header
    # and the "You are Claude Code…" system prefix.
    #
    # The CLI subprocess path is reserved for the case where we have no
    # OAuth token at all — then the CLI uses its own internal credentials
    # and we don't touch CLAUDE_CODE_OAUTH_TOKEN in the spawned env.
    discovered_oauth_token = _resolve_oauth_token()
    if discovered_oauth_token:
        return await _claude_code_via_api(messages, max_tokens, cfg, discovered_oauth_token)

    if not claude_bin:
        raise ValueError(
            "Claude CLI binary not found and no OAuth token is configured. "
            "Either install the CLI (`npm install -g @anthropic-ai/claude-code`) "
            "or log in via Settings → LLM → 'Login with Claude'."
        )

    # ── Build the prompt from messages ──
    # Combine system + user messages into a single prompt for the CLI
    system_parts = []
    user_parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            system_parts.append(content)
        else:
            user_parts.append(content)

    prompt = ""
    if system_parts:
        prompt += "\n".join(system_parts) + "\n\n"
    prompt += "\n".join(user_parts)

    # ── Build subprocess environment ──
    # We deliberately do NOT inject CLAUDE_CODE_OAUTH_TOKEN here. By the
    # time we reach this code path, `_resolve_oauth_token()` returned
    # `None` (no OAuth token anywhere), so the CLI is expected to use its
    # own internal credentials from `claude login`. Inheriting whatever
    # CLAUDE_CODE_OAUTH_TOKEN happened to be in the parent process env
    # would override those credentials with potentially-incompatible
    # OAuth tokens (the very bug that motivated this branch).
    env = {**os.environ, "CLAUDE_CODE_ENTRYPOINT": "cli"}
    env.pop("CLAUDE_CODE_OAUTH_TOKEN", None)

    # ── Build CLI args ──
    # We pipe the prompt via stdin instead of `-p "<prompt>"` because ETL/Q&A
    # prompts can easily exceed the OS argv limit (256 KB on macOS, ~2 MB on
    # Linux). With `-p ""` and stdin the prompt size is bounded only by the
    # CLI's own context window.
    args = [
        claude_bin,
        "-p", "",
        "--output-format", "stream-json",
        "--verbose",
    ]
    if model:
        args.extend(["--model", model])

    # ── Execute subprocess ──
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    stdout_data, stderr_data = await proc.communicate(input=prompt.encode("utf-8"))

    # Helper: pull any error message embedded in the stream-json stdout
    # (the CLI emits auth failures, rate-limit hits, and other API errors
    # there even when the process exits non-zero with empty stderr).
    def _extract_stream_json_error(raw: bytes) -> str:
        text = raw.decode("utf-8", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = _json.loads(line)
            except _json.JSONDecodeError:
                continue
            # Result lines flag explicit failures
            if obj.get("type") == "result" and obj.get("is_error"):
                msg = obj.get("result") or obj.get("text") or ""
                if msg:
                    return str(msg).strip()
            # Assistant lines may carry an `error` slug + message
            if obj.get("type") == "assistant" and obj.get("error"):
                inner = obj.get("message", {}).get("content") or []
                for blk in inner:
                    if blk.get("type") == "text" and blk.get("text"):
                        return str(blk["text"]).strip()
            # System/setup error
            if obj.get("type") == "error":
                return str(obj.get("message") or obj.get("error") or line).strip()
        return ""

    # Even when the CLI exits 0, a stream-json result with `is_error: true`
    # means the call failed (auth, rate limit, etc). Surface those as
    # explicit errors so the caller doesn't see an empty answer.
    embedded = _extract_stream_json_error(stdout_data)

    if proc.returncode != 0 or embedded:
        err_text = stderr_data.decode("utf-8", errors="replace").strip()
        # Prefer the structured stdout message; fall back to stderr; then to
        # a hint about authentication if both are empty (most common cause
        # of exit 1 with no output is a missing/expired OAuth token).
        if embedded:
            err_text = embedded
        elif not err_text:
            err_text = (
                "Claude CLI exited with no output. The most common cause is a "
                "missing or expired OAuth token — run `claude login` from a "
                "terminal, or set CLAUDE_CODE_OAUTH_TOKEN in backend/.env."
            )
        raise RuntimeError(f"Claude CLI exited with code {proc.returncode}: {err_text}")

    # ── Parse stream-json output ──
    # Each line is a JSON object. We look for:
    # - {"type": "assistant", "message": {"content": [{"type": "text", "text": "..."}]}}
    # - {"type": "content_block_delta", "delta": {"text": "..."}}
    # - {"type": "result", "result": "...", "text": "..."}
    content_parts: list[str] = []
    result_text = ""

    for line in stdout_data.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = _json.loads(line)
        except _json.JSONDecodeError:
            continue

        msg_type = obj.get("type", "")

        if msg_type == "assistant":
            # Extract text blocks from message.content
            message = obj.get("message", {})
            for block in message.get("content", []):
                if block.get("type") == "text":
                    content_parts.append(block.get("text", ""))

        elif msg_type == "content_block_delta":
            delta = obj.get("delta", {})
            if delta.get("text"):
                content_parts.append(delta["text"])

        elif msg_type == "result":
            result_text = obj.get("result", "") or obj.get("text", "")

    content = result_text or "".join(content_parts)
    content = content.strip()

    # Usage: CLI doesn't report tokens, estimate from content length
    est_input = len(prompt) // 4
    est_output = len(content) // 4

    display_model = model or "claude-code"
    trace = _build_trace(messages, None, content=content, finish_reason="end_turn")
    return content, _usage("claude-code", display_model, est_input, est_output), trace


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
