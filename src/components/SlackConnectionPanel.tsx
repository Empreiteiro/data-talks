import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Copy, ExternalLink, Hash, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface SlackConnection {
  id: string;
  channel_id: string;
  channel_name?: string;
  team_id?: string;
  config_name?: string;
  created_at: string;
}

interface SlackBotConfigOption {
  id: string;
  key: string;
  name: string;
  masked_token: string;
  team_id?: string;
  team_name?: string;
  is_env: boolean;
  has_token?: boolean;
  created_at?: string;
}

interface SlackConnectionPanelProps {
  agentId: string;
}

export function SlackConnectionPanel({ agentId }: SlackConnectionPanelProps) {
  const { t } = useLanguage();
  const [connections, setConnections] = useState<SlackConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [envBotConfig, setEnvBotConfig] = useState<SlackBotConfigOption | null>(null);
  const [botConfigs, setBotConfigs] = useState<SlackBotConfigOption[]>([]);
  const [selectedBotKey, setSelectedBotKey] = useState<string>("");
  const [channelId, setChannelId] = useState("");

  const fetchConnections = useCallback(async () => {
    if (!agentId) return;
    setLoadingConnections(true);
    try {
      const data = await dataClient.listSlackConnections(agentId);
      setConnections(data.connections || []);
    } catch (err) {
      console.error("Error loading Slack connections:", err);
    } finally {
      setLoadingConnections(false);
    }
  }, [agentId]);

  const fetchBotConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    try {
      const data = await dataClient.listSlackBotConfigs();
      setEnvBotConfig(data.env_config);
      setBotConfigs(data.configs || []);
      setSelectedBotKey((current) => {
        if (current && (current === data.env_config?.key || (data.configs || []).some((cfg) => cfg.key === current))) {
          return current;
        }
        return data.env_config?.key || data.configs?.[0]?.key || "";
      });
    } catch (err) {
      toast.error(`${t("slack.configLoadError")}: ${err.message}`);
    } finally {
      setLoadingConfigs(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConnections();
    fetchBotConfigs();
  }, [fetchConnections, fetchBotConfigs]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "slack-oauth-success") {
        toast.success(t("slack.oauthSuccess"));
        fetchBotConfigs();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchBotConfigs, t]);

  const availableBotOptions = [
    ...(envBotConfig ? [envBotConfig] : []),
    ...botConfigs,
  ];
  const hasAvailableBotConfig = availableBotOptions.length > 0;

  const handleOAuth = () => {
    if (!selectedBotKey) {
      toast.error(t("slack.selectConfigRequired"));
      return;
    }
    const url = `${window.location.origin}/api/slack/oauth/start?config_key=${encodeURIComponent(selectedBotKey)}`;
    window.open(url, "slack-oauth", "width=600,height=700");
  };

  const handleConnect = async () => {
    if (!selectedBotKey) {
      toast.error(t("slack.selectConfigRequired"));
      return;
    }
    if (!channelId.trim()) {
      toast.error(t("slack.channelIdRequired"));
      return;
    }
    setConnecting(true);
    try {
      await dataClient.createSlackConnection(agentId, {
        config_key: selectedBotKey,
        channel_id: channelId.trim(),
      });
      toast.success(t("slack.connectSuccess"));
      setChannelId("");
      fetchConnections();
    } catch (err) {
      toast.error(`${t("slack.connectError")}: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopy = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(t("slack.copyError"));
    }
  };

  const handleRemove = async (connectionId: string, channelName?: string) => {
    if (!confirm(`${t("slack.removeConfirm")} "${channelName || connectionId}"?`)) return;
    try {
      await dataClient.deleteSlackConnection(connectionId);
      toast.success(t("slack.removeSuccess"));
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    } catch (err) {
      toast.error(`${t("slack.removeError")}: ${err.message}`);
    }
  };

  const eventsUrl = `${window.location.origin}/api/slack/events`;
  const commandsUrl = `${window.location.origin}/api/slack/commands`;

  return (
    <div className="space-y-4">
      {!hasAvailableBotConfig && !loadingConfigs ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("slack.noBotConfigTitle")}</p>
          <p className="mt-1 max-w-md">
            {t("slack.noBotConfigDescriptionPrefix")}{" "}
            <Link to="/account?section=connections" className="font-medium text-primary underline underline-offset-4">
              {t("slack.configureConnectionsLink")}
            </Link>
            {t("slack.noBotConfigDescriptionSuffix")}
          </p>
        </div>
      ) : null}

      {hasAvailableBotConfig && (
        <>
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label>{t("slack.connectionConfigLabel")}</Label>
              <Select value={selectedBotKey} onValueChange={setSelectedBotKey} disabled={loadingConfigs || connecting}>
                <SelectTrigger>
                  <SelectValue placeholder={t("slack.connectionConfigPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {envBotConfig && (
                    <SelectItem value={envBotConfig.key}>
                      {envBotConfig.name} {envBotConfig.team_name ? `(${envBotConfig.team_name})` : ""}
                    </SelectItem>
                  )}
                  {botConfigs.map((config) => (
                    <SelectItem key={config.id} value={config.key}>
                      {config.name} {config.team_name ? `(${config.team_name})` : ""} {!config.has_token ? `- ${t("slack.needsOAuth")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { fetchConnections(); fetchBotConfigs(); }}
                disabled={loadingConnections || loadingConfigs}
                title={t("slack.refresh")}
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 ${loadingConnections || loadingConfigs ? "animate-spin" : ""}`} />
                <span className="ml-2 sm:hidden">{t("slack.refresh")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOAuth}
                disabled={!selectedBotKey}
                className="w-full gap-2 sm:w-auto"
              >
                <ExternalLink className="h-4 w-4" />
                {t("slack.addToSlack")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label>{t("slack.channelId")}</Label>
              <Input
                placeholder={t("slack.channelIdPlaceholder")}
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={connecting}
              />
            </div>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !selectedBotKey || !channelId.trim()}
              className="h-auto min-h-9 w-full gap-2 whitespace-normal sm:w-auto sm:self-end sm:whitespace-nowrap"
            >
              {connecting ? t("slack.connecting") : t("slack.connect")}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm">
            <p className="font-medium text-foreground">{t("slack.webhookUrls")}</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{eventsUrl}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(eventsUrl, t("slack.urlCopied"))}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{commandsUrl}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(commandsUrl, t("slack.urlCopied"))}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("slack.webhookUrlsHint")}</p>
          </div>
        </>
      )}

      {connections.length === 0 && hasAvailableBotConfig ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("slack.noConnections")} <strong>{t("slack.connect")}</strong>{" "}
          {t("slack.noConnectionsSuffix")}
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex flex-col gap-3 rounded-md border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Hash className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{conn.channel_name || conn.channel_id}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="break-all">ID: {conn.channel_id}</span>
                    {conn.config_name && <span>{conn.config_name}</span>}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 self-end text-destructive hover:text-destructive sm:self-auto"
                onClick={() => handleRemove(conn.id, conn.channel_name)}
                title={t("slack.remove")}
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
