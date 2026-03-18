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
import { Bot, Loader2, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
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
const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI-compatible", ollama: "Ollama", litellm: "LiteLLM" };

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
  const [llmProvider, setLlmProvider] = useState<"openai" | "ollama" | "litellm">("openai");
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
    setEditingConfigId(null);
  };

  const loadConfigIntoForm = (cfg: LlmConfig) => {
    setName(cfg.name || "");
    setLlmProvider((cfg.llm_provider as "openai" | "ollama" | "litellm") || "openai");
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

  const isApiKeyMasked = (val: string) => val && val.includes("••••");

  const AddForm = () => (
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
        <Select value={llmProvider} onValueChange={(v) => setLlmProvider(v as "openai" | "ollama" | "litellm")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI-compatible</SelectItem>
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
    </div>
  );

  const effectiveProviderLabel = effectiveSettings
    ? PROVIDER_LABELS[effectiveSettings.llm_provider] || effectiveSettings.llm_provider
    : "—";

  const effectiveTextModel = effectiveSettings
    ? effectiveSettings.openai_model || effectiveSettings.ollama_model || effectiveSettings.litellm_model || "—"
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
              <div className="flex flex-col items-center justify-center text-center p-4 border rounded-lg bg-muted/10">
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
                            {cfg.model || cfg.openai_model || cfg.ollama_model || cfg.litellm_model || "—"}
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
          <AddForm />
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
          <AddForm />
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
