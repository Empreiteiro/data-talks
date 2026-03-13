import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Copy, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface TelegramConnection {
  id: string;
  chat_id: string;
  chat_title?: string;
  created_at: string;
  bot_key?: string;
  bot_username?: string;
  bot_name?: string;
}

interface TelegramBotConfigOption {
  id: string;
  key: string;
  name: string;
  bot_username: string;
  masked_token: string;
  is_env: boolean;
  created_at?: string;
}

interface TelegramConnectionPanelProps {
  agentId: string;
}

export function TelegramConnectionPanel({ agentId }: TelegramConnectionPanelProps) {
  const { t } = useLanguage();
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [loadingLink, setLoadingLink] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [manualStartCommand, setManualStartCommand] = useState<string | null>(null);
  const [manualBotUsername, setManualBotUsername] = useState<string | null>(null);
  const [manualExpiresAt, setManualExpiresAt] = useState<string | null>(null);
  const [envBotConfig, setEnvBotConfig] = useState<TelegramBotConfigOption | null>(null);
  const [botConfigs, setBotConfigs] = useState<TelegramBotConfigOption[]>([]);
  const [selectedBotKey, setSelectedBotKey] = useState<string>("");

  const fetchConnections = useCallback(async () => {
    if (!agentId) return;
    setLoadingConnections(true);
    try {
      const data = await dataClient.listTelegramConnections(agentId);
      setConnections(data.connections || []);
    } catch (err) {
      console.error("Erro ao carregar conexões Telegram:", err);
    } finally {
      setLoadingConnections(false);
    }
  }, [agentId]);

  const fetchBotConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    try {
      const data = await dataClient.listTelegramBotConfigs();
      setEnvBotConfig(data.env_config);
      setBotConfigs(data.configs || []);
      setSelectedBotKey((current) => {
        if (current && (current === data.env_config?.key || (data.configs || []).some((cfg) => cfg.key === current))) {
          return current;
        }
        return data.env_config?.key || data.configs?.[0]?.key || "";
      });
    } catch (err) {
      toast.error(`${t("telegram.configLoadError")}: ${err.message}`);
    } finally {
      setLoadingConfigs(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConnections();
    fetchBotConfigs();
  }, [fetchConnections, fetchBotConfigs]);

  const availableBotOptions = [
    ...(envBotConfig ? [envBotConfig] : []),
    ...botConfigs,
  ];
  const hasAvailableBotConfig = availableBotOptions.length > 0;

  const handleConnect = async () => {
    if (!selectedBotKey) {
      toast.error(t("telegram.selectConfigRequired"));
      return;
    }
    setLoadingLink(true);
    try {
      const data = await dataClient.generateTelegramConnectionLink(agentId, { bot_key: selectedBotKey });
      const parsedUrl = new URL(data.url);
      const token = parsedUrl.searchParams.get("startgroup");
      const botUsername = data.bot_username || parsedUrl.pathname.replace(/^\/+/, "") || null;

      setManualBotUsername(botUsername);
      setManualStartCommand(token ? `/start ${token}` : null);
      setManualExpiresAt(data.expires_at);

      toast.success(t("telegram.instructionsReady"), { duration: 6000 });
    } catch (err) {
      if (err.message?.includes("not configured") || err.message?.includes("configuration")) {
        toast.error(t("telegram.notConfigured"));
      } else {
        toast.error(`${t("telegram.connectError")}: ${err.message}`);
      }
    } finally {
      setLoadingLink(false);
    }
  };

  const handleCopy = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(t("telegram.copyError"));
    }
  };

  const handleRemove = async (connectionId: string, chatTitle?: string) => {
    if (!confirm(`${t("telegram.removeConfirm")} "${chatTitle || connectionId}"?`)) return;
    try {
      await dataClient.deleteTelegramConnection(connectionId);
      toast.success(t("telegram.removeSuccess"));
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    } catch (err) {
      toast.error(`${t("telegram.removeError")}: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4">
      {!hasAvailableBotConfig && !loadingConfigs ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("telegram.noBotConfigTitle")}</p>
          <p className="mt-1 max-w-md">
            {t("telegram.noBotConfigDescriptionPrefix")}{" "}
            <Link to="/account?section=connections" className="font-medium text-primary underline underline-offset-4">
              {t("telegram.configureConnectionsLink")}
            </Link>
            {t("telegram.noBotConfigDescriptionSuffix")}
          </p>
        </div>
      ) : null}

      {hasAvailableBotConfig && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-2">
            <Label>{t("telegram.connectionConfigLabel")}</Label>
            <Select value={selectedBotKey} onValueChange={setSelectedBotKey} disabled={loadingConfigs || loadingLink}>
              <SelectTrigger>
                <SelectValue placeholder={t("telegram.connectionConfigPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {envBotConfig && (
                  <SelectItem value={envBotConfig.key}>
                    {envBotConfig.name} (@{envBotConfig.bot_username})
                  </SelectItem>
                )}
                {botConfigs.map((config) => (
                  <SelectItem key={config.id} value={config.key}>
                    {config.name} (@{config.bot_username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchConnections();
                fetchBotConfigs();
              }}
              disabled={loadingConnections || loadingConfigs}
              title={t("telegram.refresh")}
              className="w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${loadingConnections || loadingConfigs ? "animate-spin" : ""}`} />
              <span className="ml-2 sm:hidden">{t("telegram.refresh")}</span>
            </Button>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={loadingLink || !selectedBotKey}
              className="h-auto min-h-9 w-full gap-2 whitespace-normal sm:w-auto sm:whitespace-nowrap"
            >
              {loadingLink ? t("telegram.generatingLink") : t("telegram.connect")}
            </Button>
          </div>
        </div>
      )}

      {manualStartCommand && (
        <div className="space-y-4 rounded-lg border bg-muted/40 p-4 text-foreground">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t("telegram.fallbackTitle")}</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("telegram.fallbackDescription")}
            </p>
            {manualExpiresAt && (
              <p className="text-xs font-medium text-muted-foreground">
                {t("telegram.fallbackExpires")} {new Date(manualExpiresAt).toLocaleString()}
              </p>
            )}
          </div>

          <div className="space-y-2 text-sm leading-6 text-foreground">
            <p>{t("telegram.fallbackStep1")}</p>
            <p>
              {t("telegram.fallbackStep2")}{" "}
              <span className="font-mono font-semibold text-foreground">
                {manualBotUsername ? `@${manualBotUsername}` : "Telegram bot"}
              </span>.
            </p>
            <p>{t("telegram.fallbackStep3")}</p>
          </div>

          <div className="space-y-2">
            <div className="rounded-md border bg-background px-3 py-2 font-mono text-sm font-semibold break-all text-foreground">
              {manualStartCommand}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(manualStartCommand, t("telegram.commandCopied"))}
                className="w-full sm:w-auto"
              >
                <Copy className="h-4 w-4" />
                {t("telegram.copyCommand")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {connections.length === 0 && hasAvailableBotConfig ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("telegram.noConnections")} <strong>{t("telegram.connect")}</strong>{" "}
          {t("telegram.noConnectionsSuffix")}
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex flex-col gap-3 rounded-md border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Send className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{conn.chat_title || conn.chat_id}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="break-all">ID: {conn.chat_id}</span>
                    {conn.bot_name && <span>{conn.bot_name}</span>}
                    {conn.bot_username && <span>@{conn.bot_username}</span>}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 self-end text-destructive hover:text-destructive sm:self-auto"
                onClick={() => handleRemove(conn.id, conn.chat_title)}
                title={t("telegram.remove")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
