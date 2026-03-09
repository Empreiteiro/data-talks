import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Copy, ExternalLink, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface TelegramConnection {
  id: string;
  chat_id: string;
  chat_title?: string;
  created_at: string;
}

interface TelegramConnectionPanelProps {
  agentId: string;
}

export function TelegramConnectionPanel({ agentId }: TelegramConnectionPanelProps) {
  const { t } = useLanguage();
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [loadingLink, setLoadingLink] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [manualLinkUrl, setManualLinkUrl] = useState<string | null>(null);
  const [manualStartCommand, setManualStartCommand] = useState<string | null>(null);
  const [manualBotUsername, setManualBotUsername] = useState<string | null>(null);
  const [manualExpiresAt, setManualExpiresAt] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!agentId) return;
    setLoadingConnections(true);
    try {
      const data = await dataClient.listTelegramConnections(agentId);
      setConnections(data.connections || []);
      if ((data.connections || []).length > 0) {
        setManualLinkUrl(null);
        setManualStartCommand(null);
        setManualBotUsername(null);
        setManualExpiresAt(null);
      }
    } catch (err: any) {
      console.error("Erro ao carregar conexões Telegram:", err);
    } finally {
      setLoadingConnections(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleConnect = async () => {
    setLoadingLink(true);
    try {
      const data = await dataClient.generateTelegramConnectionLink(agentId);
      const parsedUrl = new URL(data.url);
      const token = parsedUrl.searchParams.get("startgroup");
      const botUsername = parsedUrl.pathname.replace(/^\/+/, "") || null;

      setManualLinkUrl(data.url);
      setManualBotUsername(botUsername);
      setManualStartCommand(token ? `/start ${token}` : null);
      setManualExpiresAt(data.expires_at);

      window.open(data.url, "_blank", "noopener,noreferrer");
      toast.info(t("telegram.linkOpened"), { duration: 6000 });
      setTimeout(fetchConnections, 5000);
    } catch (err: any) {
      if (err.message?.includes("not configured")) {
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
    } catch (err: any) {
      toast.error(`${t("telegram.removeError")}: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 shrink-0 text-blue-500" />
            <h3 className="text-sm font-semibold">{t("telegram.connections")}</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground break-words">
            {t("telegram.description")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConnections}
            disabled={loadingConnections}
            title={t("telegram.refresh")}
            className="w-full sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${loadingConnections ? "animate-spin" : ""}`} />
            <span className="ml-2 sm:hidden">{t("telegram.refresh")}</span>
          </Button>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={loadingLink}
            className="h-auto min-h-9 w-full gap-2 whitespace-normal bg-blue-500 text-white sm:w-auto sm:whitespace-nowrap hover:bg-blue-600"
          >
            <ExternalLink className="h-4 w-4" />
            {loadingLink ? t("telegram.generatingLink") : t("telegram.connect")}
          </Button>
        </div>
      </div>

      {manualStartCommand && manualLinkUrl && (
        <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t("telegram.fallbackTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("telegram.fallbackDescription")}
            </p>
            {manualExpiresAt && (
              <p className="text-xs text-muted-foreground">
                {t("telegram.fallbackExpires")} {new Date(manualExpiresAt).toLocaleString()}
              </p>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <p>{t("telegram.fallbackStep1")}</p>
            <p>
              {t("telegram.fallbackStep2")}{" "}
              <span className="font-mono">{manualBotUsername ? `@${manualBotUsername}` : "Telegram bot"}</span>.
            </p>
            <p>{t("telegram.fallbackStep3")}</p>
          </div>

          <div className="space-y-2">
            <div className="rounded-md border bg-background px-3 py-2 font-mono text-sm break-all">
              {manualStartCommand}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(manualLinkUrl, t("telegram.linkCopied"))}
                className="w-full sm:w-auto"
              >
                <Copy className="h-4 w-4" />
                {t("telegram.copyLink")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {connections.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("telegram.noConnections")} <strong>{t("telegram.connect")}</strong>{" "}
          {t("telegram.noConnectionsSuffix")}
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex flex-col gap-3 rounded-md border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Send className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{conn.chat_title || conn.chat_id}</p>
                  <span className="text-xs text-muted-foreground break-all">
                    ID: {conn.chat_id}
                  </span>
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
      )}
    </div>
  );
}
