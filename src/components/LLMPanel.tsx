import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { dataClient } from "@/services/dataClient";
import { useLanguage } from "@/contexts/LanguageContext";
import { Bot, CheckCircle2, Loader2, Pencil, Plus, Plug, RefreshCw, Star, Trash2, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPENAI_AUDIO_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"];
const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI-compatible", ollama: "Ollama", litellm: "LiteLLM", google: "Google Gemini", anthropic: "Anthropic Claude" };

/** Models the Claude Code OAuth flow's `user:inference` scope is allowed
 *  to drive, mirrored from the official `claude --model` choices. Order
 *  is "tier first, recency next" so the most useful options surface near
 *  the top of the dropdown. The escape-hatch "Other" option in the UI
 *  preserves free-text entry for anything we forget to list here. */
const CLAUDE_CODE_MODELS: Array<{ id: string; label: string }> = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (May 2025)" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4 (May 2025)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
];

interface LlmConfig {
  id: string;
  name: string;
  llm_provider: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openai_model?: string;
  openai_audio_model?: string;
  ollama_base_url?: string;
  ollama_model?: string;
  litellm_base_url?: string;
  litellm_model?: string;
  litellm_audio_model?: string;
  litellm_api_key?: string;
  google_api_key?: string;
  google_model?: string;
  anthropic_api_key?: string;
  anthropic_model?: string;
  model?: string;
  is_default?: boolean;
  created_at?: string;
}

interface EffectiveLlmSettings {
  llm_provider: string;
  openai_model?: string;
  openai_base_url?: string;
  openai_audio_model?: string;
  ollama_model?: string;
  litellm_model?: string;
  litellm_audio_model?: string;
  google_model?: string;
  anthropic_model?: string;
  claude_code_model?: string;
  claude_code_oauth_token?: string;
}

interface LLMPanelProps {
  hasEnvLlm?: boolean;
  onConfigAdded?: () => void;
}

export function LLMPanel({ hasEnvLlm, onConfigAdded }: LLMPanelProps = {}) {
  const { t } = useLanguage();
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [effectiveSettings, setEffectiveSettings] = useState<EffectiveLlmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [llmProvider, setLlmProvider] = useState<"openai" | "ollama" | "litellm" | "google" | "anthropic" | "claude-code">("openai");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("https://api.openai.com/v1");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiAudioModel, setOpenaiAudioModel] = useState("gpt-4o-mini-tts");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("llama3.2");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [litellmBaseUrl, setLitellmBaseUrl] = useState("http://localhost:4000");
  const [litellmModel, setLitellmModel] = useState("gpt-4o-mini");
  const [litellmAudioModel, setLitellmAudioModel] = useState("");
  const [litellmApiKey, setLitellmApiKey] = useState("");
  const [litellmModels, setLitellmModels] = useState<string[]>([]);
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleModel, setGoogleModel] = useState("gemini-2.0-flash");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-20250514");
  const [claudeCodeModel, setClaudeCodeModel] = useState("claude-sonnet-4-20250514");
  const [claudeCodeOauthToken, setClaudeCodeOauthToken] = useState("");
  // OAuth flow state — popup window + waiting state for the paste-code modal.
  const [claudeOauthState, setClaudeOauthState] = useState<string | null>(null);
  const [claudeOauthCode, setClaudeOauthCode] = useState("");
  const [claudeOauthRunning, setClaudeOauthRunning] = useState(false);
  const [fetchingOllama, setFetchingOllama] = useState(false);
  const [fetchingLitellm, setFetchingLitellm] = useState(false);

  const fetchConfigs = async () => {
    try {
      const [configData, settingsData] = await Promise.all([
        dataClient.listLlmConfigs(),
        dataClient.getLlmSettings(),
      ]);
      setConfigs(configData || []);
      setEffectiveSettings(settingsData || null);
    } catch (error: unknown) {
      toast.error(t("llmSettings.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchOllamaModels = async () => {
    setFetchingOllama(true);
    try {
      const data = await dataClient.listOllamaModels(ollamaBaseUrl || undefined);
      setOllamaModels(data.models || []);
      if (data.models?.length) toast.success(t("llmSettings.modelsFetched"));
      else if (data.error) toast.error(t("llmSettings.modelsFetchError"), { description: data.error });
    } catch (e: unknown) {
      toast.error(t("llmSettings.modelsFetchError"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setFetchingOllama(false);
    }
  };

  const fetchLitellmModels = async () => {
    setFetchingLitellm(true);
    try {
      const data = await dataClient.listLiteLLMModels(litellmBaseUrl || undefined);
      setLitellmModels(data.models || []);
      if (data.models?.length) toast.success(t("llmSettings.modelsFetched"));
      else if (data.error) toast.error(t("llmSettings.modelsFetchError"), { description: data.error });
    } catch (e: unknown) {
      toast.error(t("llmSettings.modelsFetchError"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setFetchingLitellm(false);
    }
  };

  const resetForm = () => {
    setName("");
    setLlmProvider("openai");
    setOpenaiApiKey("");
    setOpenaiBaseUrl("https://api.openai.com/v1");
    setOpenaiModel("gpt-4o-mini");
    setOpenaiAudioModel("gpt-4o-mini-tts");
    setOllamaBaseUrl("http://localhost:11434");
    setOllamaModel("llama3.2");
    setOllamaModels([]);
    setLitellmBaseUrl("http://localhost:4000");
    setLitellmModel("gpt-4o-mini");
    setLitellmAudioModel("");
    setLitellmApiKey("");
    setLitellmModels([]);
    setGoogleApiKey("");
    setGoogleModel("gemini-2.0-flash");
    setAnthropicApiKey("");
    setAnthropicModel("claude-sonnet-4-20250514");
    setClaudeCodeModel("claude-sonnet-4-20250514");
    setClaudeCodeOauthToken("");
    setClaudeOauthState(null);
    setClaudeOauthCode("");
    setClaudeOauthRunning(false);
    setEditingConfigId(null);
  };

  const loadConfigIntoForm = (cfg: LlmConfig) => {
    setName(cfg.name || "");
    setLlmProvider((cfg.llm_provider as "openai" | "ollama" | "litellm" | "google" | "anthropic") || "openai");
    setOpenaiApiKey(cfg.openai_api_key || "");
    setOpenaiBaseUrl(cfg.openai_base_url || "https://api.openai.com/v1");
    setOpenaiModel(cfg.openai_model || "gpt-4o-mini");
    setOpenaiAudioModel(cfg.openai_audio_model || "gpt-4o-mini-tts");
    setOllamaBaseUrl(cfg.ollama_base_url || "http://localhost:11434");
    setOllamaModel(cfg.ollama_model || "llama3.2");
    setLitellmBaseUrl(cfg.litellm_base_url || "http://localhost:4000");
    setLitellmModel(cfg.litellm_model || "gpt-4o-mini");
    setLitellmAudioModel(cfg.litellm_audio_model || "");
    setLitellmApiKey(cfg.litellm_api_key || "");
    setGoogleApiKey(cfg.google_api_key || "");
    setGoogleModel(cfg.google_model || "gemini-2.0-flash");
    setAnthropicApiKey(cfg.anthropic_api_key || "");
    setAnthropicModel(cfg.anthropic_model || "claude-sonnet-4-20250514");
    setClaudeCodeModel(cfg.claude_code_model || "claude-sonnet-4-20250514");
    setClaudeCodeOauthToken(cfg.claude_code_oauth_token || "");
  };

  const openEdit = (cfg: LlmConfig) => {
    loadConfigIntoForm(cfg);
    setEditingConfigId(cfg.id);
    setEditDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingConfigId || !name.trim()) {
      if (!name.trim()) toast.error(t("llmConfig.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await dataClient.updateLlmConfig(editingConfigId, {
        name: name.trim(),
        llm_provider: llmProvider,
        openai_api_key: llmProvider === "openai" ? (openaiApiKey || undefined) : undefined,
        openai_base_url: llmProvider === "openai" ? (openaiBaseUrl || undefined) : undefined,
        openai_model: llmProvider === "openai" ? openaiModel : undefined,
        openai_audio_model: llmProvider === "openai" ? (openaiAudioModel || undefined) : undefined,
        ollama_base_url: llmProvider === "ollama" ? ollamaBaseUrl : undefined,
        ollama_model: llmProvider === "ollama" ? ollamaModel : undefined,
        litellm_base_url: llmProvider === "litellm" ? litellmBaseUrl : undefined,
        litellm_model: llmProvider === "litellm" ? litellmModel : undefined,
        litellm_audio_model: llmProvider === "litellm" ? (litellmAudioModel || undefined) : undefined,
        litellm_api_key: llmProvider === "litellm" ? (litellmApiKey || undefined) : undefined,
        google_api_key: llmProvider === "google" ? (googleApiKey || undefined) : undefined,
        google_model: llmProvider === "google" ? googleModel : undefined,
        anthropic_api_key: llmProvider === "anthropic" ? (anthropicApiKey || undefined) : undefined,
        anthropic_model: llmProvider === "anthropic" ? anthropicModel : undefined,
        claude_code_model: llmProvider === "claude-code" ? claudeCodeModel : undefined,
        // Send the token unless it's the masked placeholder coming back from
        // the API (••••). When unchanged, omit it to avoid wiping the saved
        // ciphertext on edit.
        claude_code_oauth_token:
          llmProvider === "claude-code" && claudeCodeOauthToken && !claudeCodeOauthToken.includes("•")
            ? claudeCodeOauthToken
            : undefined,
      });
      toast.success(t("llmSettings.saveSuccess"));
      resetForm();
      setEditDialogOpen(false);
      await fetchConfigs();
      onConfigAdded?.();
    } catch (error: unknown) {
      toast.error(t("llmSettings.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!name.trim()) {
      toast.error(t("llmConfig.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await dataClient.createLlmConfig({
        name: name.trim(),
        llm_provider: llmProvider,
        openai_api_key: llmProvider === "openai" ? (openaiApiKey || undefined) : undefined,
        openai_base_url: llmProvider === "openai" ? (openaiBaseUrl || undefined) : undefined,
        openai_model: llmProvider === "openai" ? openaiModel : undefined,
        openai_audio_model: llmProvider === "openai" ? (openaiAudioModel || undefined) : undefined,
        ollama_base_url: llmProvider === "ollama" ? ollamaBaseUrl : undefined,
        ollama_model: llmProvider === "ollama" ? ollamaModel : undefined,
        litellm_base_url: llmProvider === "litellm" ? litellmBaseUrl : undefined,
        litellm_model: llmProvider === "litellm" ? litellmModel : undefined,
        litellm_audio_model: llmProvider === "litellm" ? (litellmAudioModel || undefined) : undefined,
        litellm_api_key: llmProvider === "litellm" ? (litellmApiKey || undefined) : undefined,
        google_api_key: llmProvider === "google" ? (googleApiKey || undefined) : undefined,
        google_model: llmProvider === "google" ? googleModel : undefined,
        anthropic_api_key: llmProvider === "anthropic" ? (anthropicApiKey || undefined) : undefined,
        anthropic_model: llmProvider === "anthropic" ? anthropicModel : undefined,
        claude_code_model: llmProvider === "claude-code" ? claudeCodeModel : undefined,
        claude_code_oauth_token:
          llmProvider === "claude-code" && claudeCodeOauthToken
            ? claudeCodeOauthToken
            : undefined,
      });
      toast.success(t("llmSettings.saveSuccess"));
      resetForm();
      setAddDialogOpen(false);
      await fetchConfigs();
      onConfigAdded?.();
    } catch (error: unknown) {
      toast.error(t("llmSettings.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await dataClient.setLlmConfigDefault(id);
      toast.success(t("llmConfig.setAsDefault"));
      fetchConfigs();
      onConfigAdded?.();
    } catch (error: unknown) {
      toast.error(t("llmSettings.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dataClient.deleteLlmConfig(id);
      toast.success(t("llmConfig.deleted"));
      fetchConfigs();
      onConfigAdded?.();
    } catch (error: unknown) {
      toast.error(t("llmSettings.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Per-config test state: id → ok + latency/error, so each row renders its
  // own badge without blocking the others. `running` set controls spinners.
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latency_ms: number; model?: string | null; error?: string; reply?: string }>
  >({});
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

  const handleTest = async (id: string) => {
    setTestingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      const result = await dataClient.testLlmConfig(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.ok) {
        toast.success(
          t("llmConfig.testSucceeded") ?? "Connection successful",
          { description: `${result.latency_ms} ms · ${result.model ?? result.provider}` },
        );
      } else {
        toast.error(
          t("llmConfig.testFailed") ?? "Connection failed",
          { description: result.error ?? "Unknown error" },
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, latency_ms: 0, error: msg },
      }));
      toast.error(t("llmConfig.testFailed") ?? "Connection failed", { description: msg });
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ── Claude Code OAuth flow ──────────────────────────────────────────────
  // Two-step UX: click "Login with Claude" → backend returns auth_url +
  // state, we open the URL in a new tab. User authorizes on claude.ai,
  // sees the OOB code page, copies the code, pastes it into a small
  // input that becomes visible while the flow is running, clicks
  // "Connect" → backend exchanges the code and returns the access token,
  // which we drop into the form's claude_code_oauth_token input.
  const handleClaudeOAuthStart = async () => {
    setClaudeOauthRunning(true);
    setClaudeOauthCode("");
    try {
      const { auth_url, state } = await dataClient.startClaudeOAuth();
      setClaudeOauthState(state);
      window.open(auth_url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      setClaudeOauthRunning(false);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(
        t("llmConfig.claudeOauthStartFailed") ?? "Failed to start Claude login",
        { description: msg },
      );
    }
  };

  const handleClaudeOAuthExchange = async () => {
    if (!claudeOauthState || !claudeOauthCode.trim()) return;
    try {
      const { access_token } = await dataClient.exchangeClaudeOAuth(
        claudeOauthCode.trim(),
        claudeOauthState,
        // We don't pass config_id: the form may be a draft (Add dialog)
        // or an edit of an existing row whose `id` lives in
        // editingConfigId. Either way, we drop the token into the
        // controlled input below and let the regular Save handler
        // persist it. This way the same code path serves both create
        // and update.
      );
      setClaudeCodeOauthToken(access_token);
      setClaudeOauthState(null);
      setClaudeOauthCode("");
      setClaudeOauthRunning(false);
      toast.success(
        t("llmConfig.claudeOauthSuccess") ?? "Connected to Claude. Click Save to persist.",
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(
        t("llmConfig.claudeOauthExchangeFailed") ?? "Failed to exchange Claude code",
        { description: msg },
      );
    }
  };

  const handleClaudeOAuthCancel = () => {
    setClaudeOauthState(null);
    setClaudeOauthCode("");
    setClaudeOauthRunning(false);
  };

  const isApiKeyMasked = (val: string) => val && val.includes("••••");

  const formFields = (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>{t("llmConfig.nameLabel")}</Label>
        <Input
          placeholder={t("llmConfig.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("llmSettings.provider")}</Label>
        <Select value={llmProvider} onValueChange={(v) => setLlmProvider(v as "openai" | "ollama" | "litellm" | "google" | "anthropic")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI-compatible</SelectItem>
            <SelectItem value="google">Google Gemini</SelectItem>
            <SelectItem value="anthropic">Anthropic Claude</SelectItem>
            <SelectItem value="claude-code">Claude CLI</SelectItem>
            <SelectItem value="ollama">Ollama</SelectItem>
            <SelectItem value="litellm">LiteLLM</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {llmProvider === "openai" && (
        <>
          <div className="space-y-2">
            <Label>{t("llmSettings.openaiApiKey")}</Label>
            <Input
              type={isApiKeyMasked(openaiApiKey) ? "text" : "password"}
              placeholder="sk-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.openaiBaseUrl")}</Label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={openaiBaseUrl}
              onChange={(e) => setOpenaiBaseUrl(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.openaiModel")}</Label>
            <Input
              placeholder="gpt-4o-mini ou gemini-2.0-flash"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.openaiAudioModel")}</Label>
            <Select value={openaiAudioModel} onValueChange={setOpenaiAudioModel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPENAI_AUDIO_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {llmProvider === "ollama" && (
        <>
          <div className="space-y-2">
            <Label>{t("llmSettings.ollamaBaseUrl")}</Label>
            <Input value={ollamaBaseUrl} onChange={(e) => setOllamaBaseUrl(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.ollamaModel")}</Label>
            <div className="flex gap-2">
              {ollamaModels.length > 0 ? (
                <Select value={ollamaModel} onValueChange={setOllamaModel}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ollamaModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="flex-1" placeholder="llama3.2" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} disabled={saving} />
              )}
              <Button type="button" variant="outline" size="icon" onClick={fetchOllamaModels} disabled={fetchingOllama}>
                {fetchingOllama ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </>
      )}
      {llmProvider === "litellm" && (
        <>
          <div className="space-y-2">
            <Label>{t("llmSettings.litellmBaseUrl")}</Label>
            <Input value={litellmBaseUrl} onChange={(e) => setLitellmBaseUrl(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.litellmApiKey")}</Label>
            <Input type="password" placeholder="(optional)" value={litellmApiKey} onChange={(e) => setLitellmApiKey(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.litellmModel")}</Label>
            <div className="flex gap-2">
              {litellmModels.length > 0 ? (
                <Select value={litellmModel} onValueChange={setLitellmModel}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {litellmModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="flex-1" placeholder="gpt-4o-mini" value={litellmModel} onChange={(e) => setLitellmModel(e.target.value)} disabled={saving} />
              )}
              <Button type="button" variant="outline" size="icon" onClick={fetchLitellmModels} disabled={fetchingLitellm}>
                {fetchingLitellm ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.litellmAudioModel")}</Label>
            <Input
              placeholder="gpt-4o-mini-tts"
              value={litellmAudioModel}
              onChange={(e) => setLitellmAudioModel(e.target.value)}
              disabled={saving}
            />
          </div>
        </>
      )}
      {llmProvider === "google" && (
        <>
          <div className="space-y-2">
            <Label>{t("llmSettings.googleApiKey")}</Label>
            <Input
              type={isApiKeyMasked(googleApiKey) ? "text" : "password"}
              placeholder="AIza..."
              value={googleApiKey}
              onChange={(e) => setGoogleApiKey(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.googleModel")}</Label>
            <Input
              placeholder="gemini-2.0-flash"
              value={googleModel}
              onChange={(e) => setGoogleModel(e.target.value)}
              disabled={saving}
            />
          </div>
        </>
      )}
      {llmProvider === "anthropic" && (
        <>
          <div className="space-y-2">
            <Label>{t("llmSettings.anthropicApiKey")}</Label>
            <Input
              type={isApiKeyMasked(anthropicApiKey) ? "text" : "password"}
              placeholder="sk-ant-..."
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("llmSettings.anthropicModel")}</Label>
            <Input
              placeholder="claude-sonnet-4-20250514"
              value={anthropicModel}
              onChange={(e) => setAnthropicModel(e.target.value)}
              disabled={saving}
            />
          </div>
        </>
      )}
      {llmProvider === "claude-code" && (
        <>
          <div className="space-y-2">
            <Label>Model</Label>
            {/* Valid Claude models the OAuth flow's `user:inference` scope
                can drive. The list mirrors what the official Claude CLI
                exposes via `--model`. We keep an "other" escape hatch for
                forward compatibility — Anthropic ships new model IDs
                periodically and we don't want users blocked by a stale
                dropdown. The custom-input branch behaves like the legacy
                free-text field. */}
            <Select
              value={CLAUDE_CODE_MODELS.some((m) => m.id === claudeCodeModel) ? claudeCodeModel : "__custom__"}
              onValueChange={(v) => {
                if (v === "__custom__") {
                  // keep whatever the user already typed
                  setClaudeCodeModel(claudeCodeModel || "");
                } else {
                  setClaudeCodeModel(v);
                }
              }}
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_CODE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="font-medium">{m.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{m.id}</span>
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">Other (type model ID below)</SelectItem>
              </SelectContent>
            </Select>
            {!CLAUDE_CODE_MODELS.some((m) => m.id === claudeCodeModel) && (
              <Input
                className="mt-2"
                placeholder="claude-sonnet-4-20250514"
                value={claudeCodeModel}
                onChange={(e) => setClaudeCodeModel(e.target.value)}
                disabled={saving}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>OAuth token</Label>
            <Input
              type={isApiKeyMasked(claudeCodeOauthToken) ? "text" : "password"}
              placeholder="sk-ant-oat01-..."
              value={claudeCodeOauthToken}
              onChange={(e) => setClaudeCodeOauthToken(e.target.value)}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Paste a token from <code>claude login</code>, or use the
              button below to generate one in-browser via the standard
              Claude OAuth flow. Stored Fernet-encrypted at rest.
            </p>
          </div>

          {/* OAuth login flow */}
          {!claudeOauthRunning ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleClaudeOAuthStart}
              disabled={saving}
            >
              <Bot className="h-4 w-4 mr-2" />
              Login with Claude
            </Button>
          ) : (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-sm">
                A new tab opened at <code>claude.ai</code>. Approve the
                request, then paste the code shown on the callback page
                here:
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste the code (with or without #state)…"
                  value={claudeOauthCode}
                  onChange={(e) => setClaudeOauthCode(e.target.value)}
                  autoFocus
                  disabled={saving}
                />
                <Button
                  type="button"
                  onClick={handleClaudeOAuthExchange}
                  disabled={saving || !claudeOauthCode.trim()}
                >
                  Connect
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClaudeOAuthCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const effectiveProviderLabel = effectiveSettings
    ? PROVIDER_LABELS[effectiveSettings.llm_provider] || effectiveSettings.llm_provider
    : "—";

  const effectiveTextModel = effectiveSettings
    ? effectiveSettings.openai_model || effectiveSettings.ollama_model || effectiveSettings.litellm_model || effectiveSettings.google_model || effectiveSettings.anthropic_model || "—"
    : "—";

  const effectiveAudioModel = effectiveSettings
    ? effectiveSettings.openai_audio_model || effectiveSettings.litellm_audio_model || ""
    : "";

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t("llmSettings.title")}</h2>
          <Button variant="outline" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t("llmConfig.add")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("llmSettings.loading")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {hasEnvLlm && effectiveSettings && (
              <div className="p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t("llmSettings.accountDefaultTitle")}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {effectiveProviderLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {effectiveTextModel}
                      </span>
                      {effectiveAudioModel && (
                        <span className="text-xs text-muted-foreground">
                          Audio: {effectiveAudioModel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {configs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Bot className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">{t("llmConfig.empty")}</p>
                <p className="text-xs text-muted-foreground mt-2">{t("llmConfig.emptyHelp")}</p>
              </div>
            ) : (
              <>
                {configs.map((cfg) => (
                  <div
                    key={cfg.id}
                    className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{cfg.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {PROVIDER_LABELS[cfg.llm_provider] || cfg.llm_provider}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {cfg.model || cfg.openai_model || cfg.ollama_model || cfg.litellm_model || cfg.google_model || cfg.anthropic_model || "—"}
                          </span>
                          {(cfg.openai_audio_model || cfg.litellm_audio_model) && (
                            <>
                              <span className="text-xs text-muted-foreground/60 flex-shrink-0" aria-hidden>·</span>
                              <span className="text-xs text-muted-foreground">
                                Audio: {cfg.openai_audio_model || cfg.litellm_audio_model}
                              </span>
                            </>
                          )}
                          {cfg.created_at && (
                            <>
                              <span className="text-xs text-muted-foreground/60 flex-shrink-0" aria-hidden>·</span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(cfg.created_at).toLocaleDateString()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {(() => {
                        const result = testResults[cfg.id];
                        const isRunning = testingIds.has(cfg.id);
                        const titleBase = t("llmConfig.test") ?? "Test connection";
                        const title = result
                          ? result.ok
                            ? `${titleBase} — ${result.latency_ms} ms`
                            : `${titleBase} — ${result.error ?? "failed"}`
                          : titleBase;
                        const Icon = isRunning
                          ? Loader2
                          : result?.ok
                            ? CheckCircle2
                            : result
                              ? XCircle
                              : Plug;
                        const colorClass = result?.ok
                          ? "text-emerald-500"
                          : result
                            ? "text-destructive"
                            : "";
                        return (
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 transition-opacity ${result ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${colorClass}`}
                            title={title}
                            disabled={isRunning}
                            onClick={() => handleTest(cfg.id)}
                          >
                            <Icon className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
                          </Button>
                        );
                      })()}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("llmConfig.edit")}
                        onClick={() => openEdit(cfg)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ${cfg.is_default ? "opacity-100 text-amber-500" : ""}`}
                        title={cfg.is_default ? t("llmConfig.default") : t("llmConfig.setAsDefault")}
                        onClick={() => !cfg.is_default && handleSetDefault(cfg.id)}
                      >
                        <Star className={`h-4 w-4 ${cfg.is_default ? "fill-current" : ""}`} />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" title={t("llmConfig.delete")}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("llmConfig.deleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("llmConfig.deleteDescription", { name: cfg.name })}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("llmConfig.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(cfg.id)} className="bg-destructive text-destructive-foreground">
                              {t("llmConfig.deleteConfirm")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("llmConfig.addTitle")}</DialogTitle>
            <DialogDescription>{t("llmConfig.addDescription")}</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={saving}>
              {t("llmConfig.cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={saving || !name.trim()}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("llmSettings.saving")}</> : t("llmConfig.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) { resetForm(); setEditDialogOpen(false); } else setEditDialogOpen(open); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("llmConfig.editTitle")}</DialogTitle>
            <DialogDescription>{t("llmConfig.editDescription")}</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setEditDialogOpen(false); }} disabled={saving}>
              {t("llmConfig.cancel")}
            </Button>
            <Button onClick={handleUpdate} disabled={saving || !name.trim()}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("llmSettings.saving")}</> : t("llmConfig.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
