import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Copy, MessageCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface WhatsAppConnection {
  id: string;
  phone_number_id: string;
  config_name?: string;
  created_at: string;
}

interface WhatsAppBotConfigOption {
  id: string;
  key: string;
  name: string;
  phone_number_id: string;
  masked_token: string;
  is_env: boolean;
  created_at?: string;
}

interface WhatsAppConnectionPanelProps {
  agentId: string;
}

function getWebhookUrl(): string {
  const base = window.location.origin;
  return `${base}/api/whatsapp/webhook`;
}

export function WhatsAppConnectionPanel({ agentId }: WhatsAppConnectionPanelProps) {
  const { t } = useLanguage();
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [envBotConfig, setEnvBotConfig] = useState<WhatsAppBotConfigOption | null>(null);
  const [botConfigs, setBotConfigs] = useState<WhatsAppBotConfigOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");

  const fetchConnections = useCallback(async () => {
    if (!agentId) return;
    setLoadingConnections(true);
    try {
      const data = await dataClient.listWhatsAppConnections(agentId);
      setConnections(data.connections || []);
    } catch (err: any) {
      console.error("Error loading WhatsApp connections:", err);
    } finally {
      setLoadingConnections(false);
    }
  }, [agentId]);

  const fetchBotConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    try {
      const data = await dataClient.listWhatsAppBotConfigs();
      setEnvBotConfig(data.env_config);
      setBotConfigs(data.configs || []);
      setSelectedKey((current) => {
        if (
          current &&
          (current === data.env_config?.key ||
            (data.configs || []).some((cfg) => cfg.key === current))
        ) {
          return current;
        }
        return data.env_config?.key || data.configs?.[0]?.key || "";
      });
    } catch (err: any) {
      toast.error(`${t("whatsapp.configLoadError")}: ${err.message}`);
    } finally {
      setLoadingConfigs(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConnections();
    fetchBotConfigs();
  }, [fetchConnections, fetchBotConfigs]);

  const availableOptions = [
    ...(envBotConfig ? [envBotConfig] : []),
    ...botConfigs,
  ];
  const hasAvailableConfig = availableOptions.length > 0;

  const handleConnect = async () => {
    if (!selectedKey) {
      toast.error(t("whatsapp.selectConfigRequired"));
      return;
    }
    setConnecting(true);
    try {
      await dataClient.createWhatsAppConnection(agentId, { config_key: selectedKey });
      toast.success(t("whatsapp.connectSuccess"));
      await fetchConnections();
    } catch (err: any) {
      toast.error(`${t("whatsapp.connectError")}: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(getWebhookUrl());
      toast.success(t("whatsapp.webhookCopied"));
    } catch {
      toast.error(t("telegram.copyError"));
    }
  };

  const handleRemove = async (connectionId: string, phoneNumberId?: string) => {
    if (!confirm(`${t("whatsapp.removeConfirm")} "${phoneNumberId || connectionId}"?`)) return;
    try {
      await dataClient.deleteWhatsAppConnection(connectionId);
      toast.success(t("whatsapp.removeSuccess"));
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    } catch (err: any) {
      toast.error(`${t("whatsapp.removeError")}: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4">
      {!hasAvailableConfig && !loadingConfigs ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("whatsapp.noBotConfigTitle")}</p>
          <p className="mt-1 max-w-md">
            {t("whatsapp.noBotConfigDescriptionPrefix")}{" "}
            <Link to="/account?section=connections" className="font-medium text-primary underline underline-offset-4">
              {t("whatsapp.configureConnectionsLink")}
            </Link>
            {t("whatsapp.noBotConfigDescriptionSuffix")}
          </p>
        </div>
      ) : null}

      {hasAvailableConfig && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-2">
            <Label>{t("whatsapp.connectionConfigLabel")}</Label>
            <Select value={selectedKey} onValueChange={setSelectedKey} disabled={loadingConfigs || connecting}>
              <SelectTrigger>
                <SelectValue placeholder={t("whatsapp.connectionConfigPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {envBotConfig && (
                  <SelectItem value={envBotConfig.key}>
                    {envBotConfig.name} ({envBotConfig.phone_number_id})
                  </SelectItem>
                )}
                {botConfigs.map((config) => (
                  <SelectItem key={config.id} value={config.key}>
                    {config.name} ({config.phone_number_id})
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
              title={t("whatsapp.refresh")}
              className="w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${loadingConnections || loadingConfigs ? "animate-spin" : ""}`} />
              <span className="ml-2 sm:hidden">{t("whatsapp.refresh")}</span>
            </Button>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !selectedKey}
              className="h-auto min-h-9 w-full gap-2 whitespace-normal sm:w-auto sm:whitespace-nowrap"
            >
              {connecting ? t("whatsapp.connecting") : t("whatsapp.connect")}
            </Button>
          </div>
        </div>
      )}

      {/* Webhook URL info */}
      <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
        <p className="text-sm font-semibold">{t("whatsapp.webhookTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("whatsapp.webhookDescription")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs break-all text-foreground">
            {getWebhookUrl()}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyWebhook}
            className="w-full sm:w-auto"
          >
            <Copy className="h-4 w-4" />
            {t("whatsapp.copyWebhook")}
          </Button>
        </div>
      </div>

      {connections.length === 0 && hasAvailableConfig ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("whatsapp.noConnections")} <strong>{t("whatsapp.connect")}</strong>{" "}
          {t("whatsapp.noConnectionsSuffix")}
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex flex-col gap-3 rounded-md border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{conn.config_name || conn.phone_number_id}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="break-all">ID: {conn.phone_number_id}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 self-end text-destructive hover:text-destructive sm:self-auto"
                onClick={() => handleRemove(conn.id, conn.phone_number_id)}
                title={t("whatsapp.remove")}
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
