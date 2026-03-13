import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Bot, Loader2, MessageCircle, Plus, Trash2, PlugZap } from "lucide-react";
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

interface WhatsAppBotConfig {
  id: string;
  key: string;
  name: string;
  phone_number_id: string;
  masked_token: string;
  is_env: boolean;
  created_at?: string;
}

export function ConnectionsPanel() {
  const { t } = useLanguage();

  // Telegram state
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [envConfig, setEnvConfig] = useState<TelegramBotConfig | null>(null);
  const [configs, setConfigs] = useState<TelegramBotConfig[]>([]);
  const [tgName, setTgName] = useState("");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotUsername, setTgBotUsername] = useState("");

  // WhatsApp state
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [waEnvConfig, setWaEnvConfig] = useState<WhatsAppBotConfig | null>(null);
  const [waConfigs, setWaConfigs] = useState<WhatsAppBotConfig[]>([]);
  const [waName, setWaName] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");

  // ── Telegram ──────────────────────────────────────────────────────────────

  const loadTelegramConfigs = async () => {
    try {
      const data = await dataClient.listTelegramBotConfigs();
      setEnvConfig(data.env_config);
      setConfigs(data.configs || []);
    } catch (error: unknown) {
      toast.error(t("connections.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTelegramLoading(false);
    }
  };

  const resetTelegramForm = () => {
    setTgName("");
    setTgBotToken("");
    setTgBotUsername("");
  };

  const handleTelegramCreate = async () => {
    if (!tgName.trim() || !tgBotToken.trim() || !tgBotUsername.trim()) {
      toast.error(t("connections.requiredFields"));
      return;
    }
    setTelegramSaving(true);
    try {
      await dataClient.createTelegramBotConfig({
        name: tgName.trim(),
        bot_token: tgBotToken.trim(),
        bot_username: tgBotUsername.trim(),
      });
      toast.success(t("connections.saveSuccess"));
      resetTelegramForm();
      setTelegramDialogOpen(false);
      await loadTelegramConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTelegramSaving(false);
    }
  };

  const handleTelegramDelete = async (configId: string) => {
    try {
      await dataClient.deleteTelegramBotConfig(configId);
      toast.success(t("connections.deleteSuccess"));
      await loadTelegramConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.deleteError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────

  const loadWhatsAppConfigs = async () => {
    try {
      const data = await dataClient.listWhatsAppBotConfigs();
      setWaEnvConfig(data.env_config);
      setWaConfigs(data.configs || []);
    } catch (error: unknown) {
      toast.error(t("connections.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWhatsappLoading(false);
    }
  };

  const resetWhatsAppForm = () => {
    setWaName("");
    setWaPhoneNumberId("");
    setWaAccessToken("");
    setWaVerifyToken("");
  };

  const handleWhatsAppCreate = async () => {
    if (!waName.trim() || !waPhoneNumberId.trim() || !waAccessToken.trim() || !waVerifyToken.trim()) {
      toast.error(t("connections.requiredFields"));
      return;
    }
    setWhatsappSaving(true);
    try {
      await dataClient.createWhatsAppBotConfig({
        name: waName.trim(),
        phone_number_id: waPhoneNumberId.trim(),
        access_token: waAccessToken.trim(),
        verify_token: waVerifyToken.trim(),
      });
      toast.success(t("connections.saveSuccess"));
      resetWhatsAppForm();
      setWhatsappDialogOpen(false);
      await loadWhatsAppConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWhatsappSaving(false);
    }
  };

  const handleWhatsAppDelete = async (configId: string) => {
    try {
      await dataClient.deleteWhatsAppBotConfig(configId);
      toast.success(t("connections.deleteSuccess"));
      await loadWhatsAppConfigs();
    } catch (error: unknown) {
      toast.error(t("connections.deleteError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    loadTelegramConfigs();
    loadWhatsAppConfigs();
  }, []);

  const loading = telegramLoading || whatsappLoading;

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <h2 className="font-semibold">{t("connections.title")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4 min-h-0 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("connections.loading")}</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Telegram section ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  {t("connections.telegramSection")}
                </h3>
                <Button variant="outline" size="sm" onClick={() => { resetTelegramForm(); setTelegramDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("connections.add")}
                </Button>
              </div>

              <div className="space-y-3">
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

                {configs.length === 0 && !envConfig ? (
                  <div className="flex flex-col items-center justify-center text-center p-4 rounded-lg border border-dashed">
                    <Bot className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t("connections.empty")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("connections.emptyDescription")}</p>
                  </div>
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
                                <AlertDialogAction onClick={() => handleTelegramDelete(config.id)} className="bg-destructive text-destructive-foreground">
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
            </div>

            {/* ── WhatsApp section ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  {t("connections.whatsappSection")}
                </h3>
                <Button variant="outline" size="sm" onClick={() => { resetWhatsAppForm(); setWhatsappDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("connections.addWhatsApp")}
                </Button>
              </div>

              <div className="space-y-3">
                {waEnvConfig && (
                  <div className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50">
                    <div className="flex items-start gap-2">
                      <PlugZap className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{waEnvConfig.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">{t("connections.envBadge")}</Badge>
                          <span className="text-xs text-muted-foreground">{waEnvConfig.phone_number_id}</span>
                          <span className="text-xs text-muted-foreground">{waEnvConfig.masked_token}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {waConfigs.length === 0 && !waEnvConfig ? (
                  <div className="flex flex-col items-center justify-center text-center p-4 rounded-lg border border-dashed">
                    <MessageCircle className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t("connections.whatsappEmpty")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("connections.whatsappEmptyDescription")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {waConfigs.map((config) => (
                      <div
                        key={config.id}
                        className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
                      >
                        <div className="flex items-start gap-2">
                          <MessageCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{config.name}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant="outline" className="text-xs">WhatsApp</Badge>
                              <span className="text-xs text-muted-foreground">{config.phone_number_id}</span>
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
                                <AlertDialogAction onClick={() => handleWhatsAppDelete(config.id)} className="bg-destructive text-destructive-foreground">
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
            </div>
          </>
        )}
      </div>

      {/* ── Telegram Add Dialog ── */}
      <Dialog open={telegramDialogOpen} onOpenChange={setTelegramDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connections.addTitle")}</DialogTitle>
            <DialogDescription>{t("connections.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tg-connection-name">{t("connections.nameLabel")}</Label>
              <Input
                id="tg-connection-name"
                placeholder={t("connections.namePlaceholder")}
                value={tgName}
                onChange={(e) => setTgName(e.target.value)}
                disabled={telegramSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-token">{t("connections.telegramTokenLabel")}</Label>
              <Input
                id="telegram-bot-token"
                type="password"
                placeholder="123456:ABC..."
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                disabled={telegramSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-username">{t("connections.telegramUsernameLabel")}</Label>
              <Input
                id="telegram-bot-username"
                placeholder="my_datatalks_bot"
                value={tgBotUsername}
                onChange={(e) => setTgBotUsername(e.target.value)}
                disabled={telegramSaving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTelegramDialogOpen(false)} disabled={telegramSaving}>
              {t("connections.cancel")}
            </Button>
            <Button onClick={handleTelegramCreate} disabled={telegramSaving || !tgName.trim() || !tgBotToken.trim() || !tgBotUsername.trim()}>
              {telegramSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("connections.saving")}</> : t("connections.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── WhatsApp Add Dialog ── */}
      <Dialog open={whatsappDialogOpen} onOpenChange={setWhatsappDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connections.addWhatsAppTitle")}</DialogTitle>
            <DialogDescription>{t("connections.addWhatsAppDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="wa-connection-name">{t("connections.nameLabel")}</Label>
              <Input
                id="wa-connection-name"
                placeholder={t("connections.namePlaceholder")}
                value={waName}
                onChange={(e) => setWaName(e.target.value)}
                disabled={whatsappSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-phone-number-id">{t("connections.whatsappPhoneNumberIdLabel")}</Label>
              <Input
                id="wa-phone-number-id"
                placeholder="1234567890"
                value={waPhoneNumberId}
                onChange={(e) => setWaPhoneNumberId(e.target.value)}
                disabled={whatsappSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-access-token">{t("connections.whatsappAccessTokenLabel")}</Label>
              <Input
                id="wa-access-token"
                type="password"
                placeholder="EAAxxxxx..."
                value={waAccessToken}
                onChange={(e) => setWaAccessToken(e.target.value)}
                disabled={whatsappSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-verify-token">{t("connections.whatsappVerifyTokenLabel")}</Label>
              <Input
                id="wa-verify-token"
                placeholder={t("connections.whatsappVerifyTokenPlaceholder")}
                value={waVerifyToken}
                onChange={(e) => setWaVerifyToken(e.target.value)}
                disabled={whatsappSaving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhatsappDialogOpen(false)} disabled={whatsappSaving}>
              {t("connections.cancel")}
            </Button>
            <Button onClick={handleWhatsAppCreate} disabled={whatsappSaving || !waName.trim() || !waPhoneNumberId.trim() || !waAccessToken.trim() || !waVerifyToken.trim()}>
              {whatsappSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("connections.saving")}</> : t("connections.addWhatsApp")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
