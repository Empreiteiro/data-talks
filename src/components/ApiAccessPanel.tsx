import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Code2, Copy, Key, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { ApiSnippetModal } from "@/components/ApiSnippetModal";

interface ApiKey {
  id: string;
  agent_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface Source {
  id: string;
  name: string;
  type: string;
}

interface ApiAccessPanelProps {
  agentId: string;
}

export function ApiAccessPanel({ agentId }: ApiAccessPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [agentSqlMode, setAgentSqlMode] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [snippetApiKey, setSnippetApiKey] = useState<string>("");

  const loadData = async () => {
    try {
      const [keysData, sourcesData, agentData] = await Promise.all([
        dataClient.listApiKeys(agentId),
        dataClient.listSources(agentId),
        dataClient.getAgent(agentId),
      ]);
      setKeys(keysData);
      setSources((sourcesData || []).map((s: any) => ({ id: s.id, name: s.name, type: s.type })));
      setAgentSqlMode(!!agentData?.sql_mode);
    } catch (error: unknown) {
      toast.error(t("apiAccess.createError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentId) {
      loadData();
    }
  }, [agentId]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await dataClient.createApiKey({ agent_id: agentId, name: newKeyName.trim() });
      setNewlyCreatedKey(result.raw_key);
      setKeys((prev) => [result, ...prev]);
      setNewKeyName("");
      setShowCreateForm(false);
      toast.success(t("apiAccess.createSuccess"));
    } catch (error: unknown) {
      toast.error(t("apiAccess.createError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    try {
      await dataClient.deleteApiKey(keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      toast.success(t("apiAccess.deleteSuccess"));
    } catch (error: unknown) {
      toast.error(t("apiAccess.createError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleToggleActive = async (keyId: string, current: boolean) => {
    try {
      const updated = await dataClient.updateApiKey(keyId, { is_active: !current });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, is_active: updated.is_active } : k)));
    } catch {
      toast.error(t("apiAccess.createError"));
    }
  };

  const copyToClipboard = (text: string, successMsg?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(successMsg || t("apiAccess.keyCopied"));
    });
  };

  const openSnippet = (rawKey: string) => {
    setSnippetApiKey(rawKey);
    setSnippetModalOpen(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t("apiAccess.never");
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      {/* Newly created key banner */}
      {newlyCreatedKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-2">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            ⚠️ {t("apiAccess.keyCreatedWarning")}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-black/30 rounded px-2 py-1 border border-amber-200 dark:border-amber-800 break-all">
              {newlyCreatedKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => copyToClipboard(newlyCreatedKey, t("apiAccess.keyCopied"))}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => openSnippet(newlyCreatedKey)}
            >
              <Code2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreateForm ? (
        <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
          <Label className="text-sm">{t("apiAccess.keyName")}</Label>
          <Input
            placeholder={t("apiAccess.keyNamePlaceholder")}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t("apiAccess.create")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowCreateForm(false);
                setNewKeyName("");
              }}
            >
              {t("apiAccess.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("apiAccess.createKey")}
        </Button>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{t("apiAccess.noKeys")}</p>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div key={key.id} className="rounded-lg border p-3 space-y-2 bg-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{key.name}</span>
                </div>
                <Badge variant={key.is_active ? "default" : "secondary"} className="text-xs shrink-0">
                  {key.is_active ? t("apiAccess.active") : t("apiAccess.inactive")}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">{key.key_prefix}…</span>
                <span>{t("apiAccess.lastUsed")}: {formatDate(key.last_used_at)}</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={key.is_active}
                  onCheckedChange={() => handleToggleActive(key.id, key.is_active)}
                  className="scale-75"
                />

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs ml-auto"
                  onClick={() => openSnippet("")}
                  title={t("apiAccess.viewSnippet")}
                >
                  <Code2 className="h-3 w-3 mr-1" />
                  {t("apiAccess.viewSnippet")}
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("apiAccess.deleteKey")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("apiAccess.deleteConfirm")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("apiAccess.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(key.id)}>
                        {t("apiAccess.deleteKey")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <ApiSnippetModal
        open={snippetModalOpen}
        onOpenChange={setSnippetModalOpen}
        agentId={agentId}
        sources={sources}
        apiKey={snippetApiKey}
        agentSqlMode={agentSqlMode}
      />
    </div>
  );
}
