import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Bot, Loader2, Plus, Trash2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface TelegramBotConfig {
  id: string;
  key: string;
  name: string;
  bot_username: string;
  masked_token: string;
  is_env: boolean;
  created_at?: string;
}

export function ConnectionsPanel() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [envConfig, setEnvConfig] = useState<TelegramBotConfig | null>(null);
  const [configs, setConfigs] = useState<TelegramBotConfig[]>([]);
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");

  const loadConfigs = async () => {
    try {
      const data = await dataClient.listTelegramBotConfigs();
      setEnvConfig(data.env_config);
      setConfigs(data.configs || []);
    } catch (error: unknown) {
      toast.error(t("connections.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const resetForm = () => {
    setName("");
    setBotToken("");
    setBotUsername("");
  };

  const handleCreate = async () => {
    if (!name.trim() || !botToken.trim() || !botUsername.trim()) {
      toast.error(t("connections.requiredFields"));
      return;
    }
    setSaving(true);
    try {
      await dataClient.createTelegramBotConfig({
        name: name.trim(),
        bot_token: botToken.trim(),
        bot_username: botUsername.trim(),
      });
      toast.success(t("connections.saveSuccess"));
      resetForm();
      setDialogOpen(false);
      await loadConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (configId: string) => {
    try {
      await dataClient.deleteTelegramBotConfig(configId);
      toast.success(t("connections.deleteSuccess"));
      await loadConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.deleteError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t("connections.title")}</h2>
          <Button variant="outline" size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t("connections.add")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("connections.loading")}</p>
            </div>
          </div>
        ) : (
          <div className={`min-h-full ${!envConfig && configs.length === 0 ? "flex flex-col" : "space-y-3"}`}>
            {envConfig && (
              <div className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50">
                <div className="flex items-start gap-2">
                  <PlugZap className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{envConfig.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">{t("connections.envBadge")}</Badge>
                      <span className="text-xs text-muted-foreground">@{envConfig.bot_username}</span>
                      <span className="text-xs text-muted-foreground">{envConfig.masked_token}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {configs.length === 0 ? (
              !envConfig ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center p-4">
                  <Bot className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">{t("connections.empty")}</p>
                  <p className="text-xs text-muted-foreground mt-2">{t("connections.emptyDescription")}</p>
                </div>
              ) : null
            ) : (
              <div className="space-y-3">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-2">
                      <Bot className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{config.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">Telegram</Badge>
                          <span className="text-xs text-muted-foreground">@{config.bot_username}</span>
                          <span className="text-xs text-muted-foreground">{config.masked_token}</span>
                          {config.created_at && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(config.created_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" title={t("connections.delete")}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("connections.deleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("connections.deleteDescription", { name: config.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("connections.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(config.id)} className="bg-destructive text-destructive-foreground">
                              {t("connections.deleteConfirm")}
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
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connections.addTitle")}</DialogTitle>
            <DialogDescription>{t("connections.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="connection-name">{t("connections.nameLabel")}</Label>
              <Input
                id="connection-name"
                placeholder={t("connections.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-token">{t("connections.telegramTokenLabel")}</Label>
              <Input
                id="telegram-bot-token"
                type="password"
                placeholder="123456:ABC..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-username">{t("connections.telegramUsernameLabel")}</Label>
              <Input
                id="telegram-bot-username"
                placeholder="my_datatalks_bot"
                value={botUsername}
                onChange={(e) => setBotUsername(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t("connections.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim() || !botToken.trim() || !botUsername.trim()}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("connections.saving")}</> : t("connections.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
