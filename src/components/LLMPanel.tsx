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
import { Bot, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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

const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];
const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI", ollama: "Ollama", litellm: "LiteLLM" };

interface LlmConfig {
  id: string;
  name: string;
  llm_provider: string;
  openai_model?: string;
  ollama_model?: string;
  litellm_model?: string;
  created_at?: string;
}

interface LLMPanelProps {
  onConfigAdded?: () => void;
}

export function LLMPanel({ onConfigAdded }: LLMPanelProps = {}) {
  const { t } = useLanguage();
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [llmProvider, setLlmProvider] = useState<"openai" | "ollama" | "litellm">("openai");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("llama3.2");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [litellmBaseUrl, setLitellmBaseUrl] = useState("http://localhost:4000");
  const [litellmModel, setLitellmModel] = useState("gpt-4o-mini");
  const [litellmApiKey, setLitellmApiKey] = useState("");
  const [litellmModels, setLitellmModels] = useState<string[]>([]);
  const [fetchingOllama, setFetchingOllama] = useState(false);
  const [fetchingLitellm, setFetchingLitellm] = useState(false);

  const fetchConfigs = async () => {
    try {
      const data = await dataClient.listLlmConfigs();
      setConfigs(data || []);
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
    setOpenaiModel("gpt-4o-mini");
    setOllamaBaseUrl("http://localhost:11434");
    setOllamaModel("llama3.2");
    setOllamaModels([]);
    setLitellmBaseUrl("http://localhost:4000");
    setLitellmModel("gpt-4o-mini");
    setLitellmApiKey("");
    setLitellmModels([]);
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
        openai_model: llmProvider === "openai" ? openaiModel : undefined,
        ollama_base_url: llmProvider === "ollama" ? ollamaBaseUrl : undefined,
        ollama_model: llmProvider === "ollama" ? ollamaModel : undefined,
        litellm_base_url: llmProvider === "litellm" ? litellmBaseUrl : undefined,
        litellm_model: llmProvider === "litellm" ? litellmModel : undefined,
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
            <SelectItem value="openai">OpenAI</SelectItem>
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
            <Label>{t("llmSettings.openaiModel")}</Label>
            <Select value={openaiModel} onValueChange={setOpenaiModel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPENAI_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
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
        </>
      )}
    </div>
  );

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

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("llmSettings.loading")}</p>
            </div>
          </div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Bot className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("llmConfig.empty")}</p>
            <p className="text-xs text-muted-foreground mt-2">{t("llmConfig.emptyHelp")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {configs.map((cfg) => (
              <div
                key={cfg.id}
                className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
              >
                <div className="flex items-start gap-2">
                  <Bot className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cfg.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {PROVIDER_LABELS[cfg.llm_provider] || cfg.llm_provider}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {cfg.openai_model || cfg.ollama_model || cfg.litellm_model || "—"}
                      </span>
                      {cfg.created_at && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(cfg.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
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
    </div>
  );
}
