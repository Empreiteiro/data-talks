import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { dataClient } from "@/services/dataClient";
import { getConnectionStringLabel } from "@/lib/utils";
import { Trash2, Plus, Key } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
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

type Credential =
  | { type: "bigquery"; id: string; name: string; createdAt: string; projectId?: string }
  | { type: "sql"; id: string; connectionLabel: string; databaseType: string; tableCount: number };

interface BigQueryCredentialsManagerProps {
  onSourceAdded?: () => void;
}

export const BigQueryCredentialsManager = ({ onSourceAdded }: BigQueryCredentialsManagerProps = {}) => {
  const { t } = useLanguage();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [credentialsFile, setCredentialsFile] = useState<File | null>(null);

  const fetchCredentials = async () => {
    try {
      const sources = await dataClient.listSources();
      const list = Array.isArray(sources) ? sources : [];
      const bigquery = list.filter((s: { type?: string }) => s.type === 'bigquery');
      const sqlSources = list.filter((s) => s.type === 'sql_database' && s.metaJSON?.connectionString);
      const bqCreds: Credential[] = bigquery.map((s) => ({
        type: 'bigquery' as const,
        id: s.id,
        name: s.name ?? '',
        createdAt: s.createdAt ?? '',
        projectId: s.metaJSON?.projectId ?? s.metaJSON?.project_id,
      }));
      const byConn = new Map<string, { id: string; connectionString: string; databaseType: string; tableNames: Set<string> }>();
      for (const s of sqlSources) {
        const conn = String(s.metaJSON?.connectionString || '').trim();
        const tableInfos = Array.isArray(s.metaJSON?.table_infos) ? s.metaJSON.table_infos : [];
        const names = new Set(tableInfos.map((t: { table?: string }) => t?.table).filter(Boolean));
        if (!byConn.has(conn)) {
          byConn.set(conn, { id: s.id, connectionString: conn, databaseType: s.metaJSON?.databaseType || 'sql', tableNames: new Set(names) });
        } else {
          names.forEach((n) => byConn.get(conn)!.tableNames.add(n as string));
        }
      }
      const sqlCreds: Credential[] = Array.from(byConn.values()).map((c) => ({
        type: 'sql' as const,
        id: c.id,
        connectionLabel: getConnectionStringLabel(c.connectionString),
        databaseType: c.databaseType,
        tableCount: c.tableNames.size,
      }));
      setCredentials([...bqCreds, ...sqlCreds]);
    } catch (error) {
      console.error('Error fetching credentials:', error);
      const message = error?.message ?? t('bigquery.errors.loadFailed');
      toast.error(t('bigquery.errors.loadFailed'), { description: message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isJson = file.type === 'application/json' || file.name?.toLowerCase().endsWith('.json');
    if (isJson) {
      setCredentialsFile(file);
    } else {
      toast.error(t('bigquery.errors.invalidFile'));
    }
  };

  const handleUpload = async () => {
    if (!credentialsFile || !credentialName.trim()) {
      toast.error(t('bigquery.errors.missingFields'));
      return;
    }

    setUploading(true);
    try {
      const credentialsJson = await credentialsFile.text();
      let parsedCredentials: { project_id?: string };
      try {
        parsedCredentials = JSON.parse(credentialsJson);
      } catch {
        toast.error(t('bigquery.errors.invalidJson'));
        return;
      }

      await dataClient.createSource(
        credentialName.trim(),
        'bigquery',
        {
          credentialsContent: credentialsJson,
          projectId: parsedCredentials.project_id || '',
          datasetId: '',
          tables: [],
        }
      );

      toast.success(t('bigquery.success.added'));
      setCredentialName('');
      setCredentialsFile(null);
      setAddDialogOpen(false);
      await fetchCredentials();
      onSourceAdded?.();
    } catch (error) {
      console.error('Error uploading credential:', error);
      const message = error?.message ?? (typeof error === 'string' ? error : t('bigquery.errors.uploadFailed'));
      toast.error(t('bigquery.errors.uploadFailed'), { description: message });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dataClient.deleteSource(id);
      toast.success(t('bigquery.success.deleted'));
      fetchCredentials();
    } catch (error) {
      console.error('Error deleting credential:', error);
      toast.error(t('bigquery.errors.deleteFailed'), { description: error.message });
    }
  };

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t('bigquery.configured.title')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('bigquery.addCredential.uploadButton')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('bigquery.configured.loading')}</p>
            </div>
          </div>
        ) : credentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Key className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t('bigquery.configured.empty')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('bigquery.addCredential.description')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {credentials.map((cred) => (
              <div
                key={`${cred.type}-${cred.id}`}
                className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {cred.type === 'bigquery' ? cred.name : cred.connectionLabel}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {cred.type === 'bigquery' ? (
                        <>
                          <Badge variant="outline" className="text-xs">{cred.projectId || 'N/A'}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {cred.createdAt ? new Date(cred.createdAt).toLocaleDateString('pt-BR') : '—'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline" className="text-xs capitalize">{cred.databaseType}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {cred.tableCount} {t('credentials.sql.tables')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {cred.type === 'bigquery' && (
                    <div className="flex items-center gap-1">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                            title={t('bigquery.delete.title')}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('bigquery.delete.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('bigquery.delete.description', { name: cred.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('bigquery.delete.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(cred.id)}
                              className="bg-destructive text-destructive-foreground"
                            >
                              {t('bigquery.delete.confirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bigquery.addCredential.title')}</DialogTitle>
            <DialogDescription>{t('bigquery.addCredential.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="credential-name">{t('bigquery.addCredential.nameLabel')}</Label>
              <Input
                id="credential-name"
                placeholder={t('bigquery.addCredential.namePlaceholder')}
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-file">{t('bigquery.addCredential.fileLabel')}</Label>
              <Input
                id="credential-file"
                type="file"
                accept=".json"
                onChange={handleFileChange}
                disabled={uploading}
              />
              {credentialsFile && (
                <p className="text-sm text-muted-foreground">
                  {t('bigquery.addCredential.fileSelected')} {credentialsFile.name}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={uploading}>
              {t('bigquery.delete.cancel')}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={uploading || !credentialsFile || !credentialName.trim()}
            >
              {uploading ? t('bigquery.addCredential.uploading') : t('bigquery.addCredential.uploadButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
