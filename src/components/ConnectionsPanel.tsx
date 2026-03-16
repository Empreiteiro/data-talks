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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type: 'telegram';
}

interface WhatsAppBotConfig {
  id: string;
  key: string;
  name: string;
  phone_number_id: string;
  masked_token: string;
  is_env: boolean;
  created_at?: string;
  type: 'whatsapp';
}

type ConnectionConfig = (TelegramBotConfig | WhatsAppBotConfig);

export function ConnectionsPanel() {
  const { t } = useLanguage();

  // Unified state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [connectionType, setConnectionType] = useState<"telegram" | "whatsapp">("telegram");
  const [allConnections, setAllConnections] = useState<ConnectionConfig[]>([]);
  
  // Telegram form state
  const [tgName, setTgName] = useState("");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotUsername, setTgBotUsername] = useState("");

  // WhatsApp form state
  const [waName, setWaName] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");

  const loadAllConnections = async () => {
    try {
      const [tgData, waData] = await Promise.all([
        dataClient.listTelegramBotConfigs(),
        dataClient.listWhatsAppBotConfigs(),
      ]);
      
      const connections: ConnectionConfig[] = [];
      
      // Add Telegram env config if exists
      if (tgData.env_config) {
        connections.push({ ...tgData.env_config, type: 'telegram' });
      }
      
      // Add Telegram configs
      if (tgData.configs) {
        connections.push(...tgData.configs.map(c => ({ ...c, type: 'telegram' as const })));
      }
      
      // Add WhatsApp env config if exists
      if (waData.env_config) {
        connections.push({ ...waData.env_config, type: 'whatsapp' });
      }
      
      // Add WhatsApp configs
      if (waData.configs) {
        connections.push(...waData.configs.map(c => ({ ...c, type: 'whatsapp' as const })));
      }
      
      // Sort by created_at (newest first), then by type, then by name
      connections.sort((a, b) => {
        // Env configs first
        if (a.is_env && !b.is_env) return -1;
        if (!a.is_env && b.is_env) return 1;
        
        // Then by created_at (newest first)
        if (a.created_at && b.created_at) {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          if (dateA !== dateB) return dateB - dateA;
        }
        if (a.created_at && !b.created_at) return -1;
        if (!a.created_at && b.created_at) return 1;
        
        // Then by type (telegram first)
        if (a.type !== b.type) {
          return a.type === 'telegram' ? -1 : 1;
        }
        
        // Finally by name
        return a.name.localeCompare(b.name);
      });
      
      setAllConnections(connections);
    } catch (error: unknown) {
      toast.error(t("connections.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTgName("");
    setTgBotToken("");
    setTgBotUsername("");
    setWaName("");
    setWaPhoneNumberId("");
    setWaAccessToken("");
    setWaVerifyToken("");
    setConnectionType("telegram");
  };

  const handleCreate = async () => {
    if (connectionType === "telegram") {
      if (!tgName.trim() || !tgBotToken.trim() || !tgBotUsername.trim()) {
        toast.error(t("connections.requiredFields"));
        return;
      }
      setSaving(true);
      try {
        await dataClient.createTelegramBotConfig({
          name: tgName.trim(),
          bot_token: tgBotToken.trim(),
          bot_username: tgBotUsername.trim(),
        });
        toast.success(t("connections.saveSuccess"));
        resetForm();
        setAddDialogOpen(false);
        await loadAllConnections();
      } catch (error: unknown) {
        toast.error(t("connections.saveError"), {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSaving(false);
      }
    } else {
      if (!waName.trim() || !waPhoneNumberId.trim() || !waAccessToken.trim() || !waVerifyToken.trim()) {
        toast.error(t("connections.requiredFields"));
        return;
      }
      setSaving(true);
      try {
        await dataClient.createWhatsAppBotConfig({
          name: waName.trim(),
          phone_number_id: waPhoneNumberId.trim(),
          access_token: waAccessToken.trim(),
          verify_token: waVerifyToken.trim(),
        });
        toast.success(t("connections.saveSuccess"));
        resetForm();
        setAddDialogOpen(false);
        await loadAllConnections();
      } catch (error: unknown) {
        toast.error(t("connections.saveError"), {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = async (config: ConnectionConfig) => {
    try {
      if (config.type === "telegram") {
        await dataClient.deleteTelegramBotConfig(config.id);
      } else {
        await dataClient.deleteWhatsAppBotConfig(config.id);
      }
      toast.success(t("connections.deleteSuccess"));
      await loadAllConnections();
    } catch (error: unknown) {
      toast.error(t("connections.deleteError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    loadAllConnections();
  }, []);

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t("connections.title")}</h2>
          <Button variant="outline" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
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
        ) : allConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <PlugZap className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("connections.empty")}</p>
            <p className="text-xs text-muted-foreground mt-2">{t("connections.emptyDescription")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allConnections.map((config) => (
              <div
                key={`${config.type}-${config.id}`}
                className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  {config.type === "telegram" ? (
                    <Bot className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <MessageCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{config.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {config.is_env && (
                        <Badge variant="outline" className="text-xs">{t("connections.envBadge")}</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {config.type === "telegram" ? "Telegram" : "WhatsApp"}
                      </Badge>
                      {config.type === "telegram" ? (
                        <>
                          <span className="text-xs text-muted-foreground">@{config.bot_username}</span>
                          <span className="text-xs text-muted-foreground">{config.masked_token}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">{config.phone_number_id}</span>
                          <span className="text-xs text-muted-foreground">{config.masked_token}</span>
                        </>
                      )}
                      {config.created_at && (
                        <>
                          <span className="text-xs text-muted-foreground/60 flex-shrink-0" aria-hidden>·</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(config.created_at).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {!config.is_env && (
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
                          <AlertDialogAction onClick={() => handleDelete(config)} className="bg-destructive text-destructive-foreground">
                            {t("connections.deleteConfirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Unified Add Dialog ── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connections.addTitle")}</DialogTitle>
            <DialogDescription>{t("connections.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("connections.typeLabel") || "Tipo"}</Label>
              <Select value={connectionType} onValueChange={(v) => setConnectionType(v as "telegram" | "whatsapp")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="connection-name">{t("connections.nameLabel")}</Label>
              <Input
                id="connection-name"
                placeholder={t("connections.namePlaceholder")}
                value={connectionType === "telegram" ? tgName : waName}
                onChange={(e) => connectionType === "telegram" ? setTgName(e.target.value) : setWaName(e.target.value)}
                disabled={saving}
              />
            </div>

            {connectionType === "telegram" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="telegram-bot-token">{t("connections.telegramTokenLabel")}</Label>
                  <Input
                    id="telegram-bot-token"
                    type="password"
                    placeholder="123456:ABC..."
                    value={tgBotToken}
                    onChange={(e) => setTgBotToken(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram-bot-username">{t("connections.telegramUsernameLabel")}</Label>
                  <Input
                    id="telegram-bot-username"
                    placeholder="my_datatalks_bot"
                    value={tgBotUsername}
                    onChange={(e) => setTgBotUsername(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="wa-phone-number-id">{t("connections.whatsappPhoneNumberIdLabel")}</Label>
                  <Input
                    id="wa-phone-number-id"
                    placeholder="1234567890"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    disabled={saving}
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
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wa-verify-token">{t("connections.whatsappVerifyTokenLabel")}</Label>
                  <Input
                    id="wa-verify-token"
                    placeholder={t("connections.whatsappVerifyTokenPlaceholder")}
                    value={waVerifyToken}
                    onChange={(e) => setWaVerifyToken(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={saving}>
              {t("connections.cancel")}
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={
                saving || 
                (connectionType === "telegram" 
                  ? (!tgName.trim() || !tgBotToken.trim() || !tgBotUsername.trim())
                  : (!waName.trim() || !waPhoneNumberId.trim() || !waAccessToken.trim() || !waVerifyToken.trim()))
              }
            >
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("connections.saving")}</> : t("connections.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
