import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { dataClient } from "@/services/dataClient";
import { useLanguage } from "@/contexts/LanguageContext";
import { Bot, Loader2, RefreshCw } from "lucide-react";

export const LLMSettingsManager = () => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [llmProvider, setLlmProvider] = useState<"openai" | "ollama" | "litellm" | "google" | "anthropic">("openai");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("https://api.openai.com/v1");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("llama3.2");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [litellmBaseUrl, setLitellmBaseUrl] = useState("http://localhost:4000");
  const [litellmModel, setLitellmModel] = useState("gpt-4o-mini");
  const [litellmApiKey, setLitellmApiKey] = useState("");
  const [litellmModels, setLitellmModels] = useState<string[]>([]);
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleModel, setGoogleModel] = useState("gemini-2.0-flash");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-20250514");
  const [fetchingLitellmModels, setFetchingLitellmModels] = useState(false);

  const loadSettings = async () => {
    try {
      const data = await dataClient.getLlmSettings();
      setLlmProvider((data.llm_provider as "openai" | "ollama" | "litellm" | "google" | "anthropic") || "openai");
      setOpenaiApiKey(data.openai_api_key || "");
      setOpenaiBaseUrl(data.openai_base_url || "https://api.openai.com/v1");
      setOpenaiModel(data.openai_model || "gpt-4o-mini");
      setOllamaBaseUrl(data.ollama_base_url || "http://localhost:11434");
      setOllamaModel(data.ollama_model || "llama3.2");
      setLitellmBaseUrl(data.litellm_base_url || "http://localhost:4000");
      setLitellmModel(data.litellm_model || "gpt-4o-mini");
      setLitellmApiKey(data.litellm_api_key || "");
      setGoogleApiKey(data.google_api_key || "");
      setGoogleModel(data.google_model || "gemini-2.0-flash");
      setAnthropicApiKey(data.anthropic_api_key || "");
      setAnthropicModel(data.anthropic_model || "claude-sonnet-4-20250514");
    } catch (error) {
      console.error("Error loading LLM settings:", error);
      toast.error(t("llmSettings.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const fetchLitellmModels = async () => {
    setFetchingLitellmModels(true);
    try {
      const data = await dataClient.listLiteLLMModels(litellmBaseUrl || undefined);
      setLitellmModels(data.models || []);
      if (data.models?.length) {
        toast.success(t("llmSettings.modelsFetched"));
      } else if (data.error) {
        toast.error(t("llmSettings.modelsFetchError"), { description: data.error });
      } else {
        toast.info(t("llmSettings.noModelsFound"));
      }
    } catch (error: unknown) {
      toast.error(t("llmSettings.modelsFetchError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFetchingLitellmModels(false);
    }
  };

  const fetchOllamaModels = async () => {
    setFetchingModels(true);
    try {
      const data = await dataClient.listOllamaModels(ollamaBaseUrl || undefined);
      setOllamaModels(data.models || []);
      if (data.models?.length) {
        toast.success(t("llmSettings.modelsFetched"));
      } else if (data.error) {
        toast.error(t("llmSettings.modelsFetchError"), { description: data.error });
      } else {
        toast.info(t("llmSettings.noModelsFound"));
      }
    } catch (error: unknown) {
      toast.error(t("llmSettings.modelsFetchError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await dataClient.updateLlmSettings({
        llm_provider: llmProvider,
        openai_api_key: openaiApiKey || undefined,
        openai_base_url: openaiBaseUrl || undefined,
        openai_model: openaiModel || undefined,
        ollama_base_url: ollamaBaseUrl || undefined,
        ollama_model: ollamaModel || undefined,
        litellm_base_url: litellmBaseUrl || undefined,
        litellm_model: litellmModel || undefined,
        litellm_api_key: litellmApiKey || undefined,
        google_api_key: googleApiKey || undefined,
        google_model: googleModel || undefined,
        anthropic_api_key: anthropicApiKey || undefined,
        anthropic_model: anthropicModel || undefined,
      });
      toast.success(t("llmSettings.saveSuccess"));
    } catch (error: unknown) {
      toast.error(t("llmSettings.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const isApiKeyMasked = (val: string) => val && val.includes("••••");

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("llmSettings.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {t("llmSettings.title")}
          </CardTitle>
          <CardDescription>{t("llmSettings.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t("llmSettings.provider")}</Label>
            <Select
              value={llmProvider}
              onValueChange={(v) => setLlmProvider(v as "openai" | "ollama" | "litellm" | "google" | "anthropic")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI-compatible</SelectItem>
                <SelectItem value="google">Google Gemini</SelectItem>
                <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                <SelectItem value="ollama">Ollama (local/remote)</SelectItem>
                <SelectItem value="litellm">LiteLLM (proxy)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {llmProvider === "openai" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="openai-api-key">{t("llmSettings.openaiApiKey")}</Label>
                <Input
                  id="openai-api-key"
                  type={isApiKeyMasked(openaiApiKey) ? "text" : "password"}
                  placeholder={isApiKeyMasked(openaiApiKey) ? undefined : "sk-..."}
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.openaiApiKeyHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openai-base-url">{t("llmSettings.openaiBaseUrl")}</Label>
                <Input
                  id="openai-base-url"
                  placeholder="https://api.openai.com/v1"
                  value={openaiBaseUrl}
                  onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.openaiBaseUrlHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openai-model">{t("llmSettings.openaiModel")}</Label>
                <Input
                  id="openai-model"
                  placeholder="gpt-4o-mini ou gemini-2.0-flash"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.openaiModelHelp")}
                </p>
              </div>
            </>
          )}

          {llmProvider === "ollama" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ollama-base-url">{t("llmSettings.ollamaBaseUrl")}</Label>
                <Input
                  id="ollama-base-url"
                  placeholder="http://localhost:11434"
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.ollamaBaseUrlHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("llmSettings.ollamaModel")}</Label>
                <div className="flex gap-2">
                  {ollamaModels.length > 0 ? (
                    <Select value={ollamaModel} onValueChange={setOllamaModel}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("llmSettings.ollamaModelPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {ollamaModels.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="flex-1"
                      placeholder="llama3.2"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      disabled={saving}
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={fetchOllamaModels}
                    disabled={fetchingModels}
                    title={t("llmSettings.fetchModels")}
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.ollamaModelHelp")}
                </p>
              </div>
            </>
          )}

          {llmProvider === "litellm" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="litellm-base-url">{t("llmSettings.litellmBaseUrl")}</Label>
                <Input
                  id="litellm-base-url"
                  placeholder="http://localhost:4000"
                  value={litellmBaseUrl}
                  onChange={(e) => setLitellmBaseUrl(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.litellmBaseUrlHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="litellm-api-key">{t("llmSettings.litellmApiKey")}</Label>
                <Input
                  id="litellm-api-key"
                  type={isApiKeyMasked(litellmApiKey) ? "text" : "password"}
                  placeholder={isApiKeyMasked(litellmApiKey) ? undefined : "sk-... (optional)"}
                  value={litellmApiKey}
                  onChange={(e) => setLitellmApiKey(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.litellmApiKeyHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("llmSettings.litellmModel")}</Label>
                <div className="flex gap-2">
                  {litellmModels.length > 0 ? (
                    <Select value={litellmModel} onValueChange={setLitellmModel}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("llmSettings.litellmModelPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {litellmModels.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="flex-1"
                      placeholder="gpt-4o-mini"
                      value={litellmModel}
                      onChange={(e) => setLitellmModel(e.target.value)}
                      disabled={saving}
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={fetchLitellmModels}
                    disabled={fetchingLitellmModels}
                    title={t("llmSettings.fetchModels")}
                  >
                    {fetchingLitellmModels ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.litellmModelHelp")}
                </p>
              </div>
            </>
          )}

          {llmProvider === "google" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="google-api-key">{t("llmSettings.googleApiKey")}</Label>
                <Input
                  id="google-api-key"
                  type={isApiKeyMasked(googleApiKey) ? "text" : "password"}
                  placeholder="AIza..."
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.googleApiKeyHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="google-model">{t("llmSettings.googleModel")}</Label>
                <Input
                  id="google-model"
                  placeholder="gemini-2.0-flash"
                  value={googleModel}
                  onChange={(e) => setGoogleModel(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.googleModelHelp")}
                </p>
              </div>
            </>
          )}

          {llmProvider === "anthropic" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="anthropic-api-key">{t("llmSettings.anthropicApiKey")}</Label>
                <Input
                  id="anthropic-api-key"
                  type={isApiKeyMasked(anthropicApiKey) ? "text" : "password"}
                  placeholder="sk-ant-..."
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.anthropicApiKeyHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="anthropic-model">{t("llmSettings.anthropicModel")}</Label>
                <Input
                  id="anthropic-model"
                  placeholder="claude-sonnet-4-20250514"
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {t("llmSettings.anthropicModelHelp")}
                </p>
              </div>
            </>
          )}

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("llmSettings.saving")}
              </>
            ) : (
              t("llmSettings.save")
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
