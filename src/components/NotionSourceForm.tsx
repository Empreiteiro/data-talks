import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface NotionSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface NotionSourceFormHandle {
  connect: () => Promise<void>;
}

export const NotionSourceForm = forwardRef<NotionSourceFormHandle, NotionSourceFormProps>(
  function NotionSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [integrationToken, setIntegrationToken] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);

    const [databases, setDatabases] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedDatabase, setSelectedDatabase] = useState("");
    const [loadingDatabases, setLoadingDatabases] = useState(false);

    const canConnect = connectionTested && !!selectedDatabase;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setDatabases([]);
      setSelectedDatabase("");
    }, [integrationToken]);

    const handleTestConnection = async () => {
      if (!integrationToken.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.notionTestConnection({ integrationToken });
        setConnectionTested(true);
        toast.success(t('addSource.notionConnectionSuccess'));
        // Load databases
        setLoadingDatabases(true);
        try {
          const res = await dataClient.notionListDatabases({ integrationToken });
          setDatabases(res.databases || []);
        } catch {
          setDatabases([]);
        } finally {
          setLoadingDatabases(false);
        }
      } catch (error) {
        setConnectionTested(false);
        toast.error(t('addSource.notionConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!integrationToken || !selectedDatabase) {
        toast.error(t('addSource.notionFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const selectedDb = databases.find((d) => d.id === selectedDatabase);
        const dbTitle = selectedDb?.name || selectedDatabase;
        const name = `Notion: ${dbTitle}`;
        const metadata = {
          integrationToken,
          databaseId: selectedDatabase,
          databaseTitle: dbTitle,
        };

        const source = await dataClient.createSource(name, 'notion', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try {
          await dataClient.notionRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.notionConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('Notion connection error:', error);
        toast.error(t('addSource.notionConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Notion Database</strong> — {t('addSource.notionDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.notionHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notion-token">{t('addSource.notionToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="notion-token"
              type="password"
              placeholder={t('addSource.notionTokenPlaceholder')}
              value={integrationToken}
              onChange={(e) => setIntegrationToken(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!integrationToken.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.notionTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.notionConnectionSuccess')}</>
              ) : (
                t('addSource.notionTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && (
          <div className="space-y-2">
            <Label>{t('addSource.notionDatabase')}</Label>
            {loadingDatabases ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.notionLoadingDatabases')}
              </p>
            ) : databases.length > 0 ? (
              <Select value={selectedDatabase} onValueChange={setSelectedDatabase}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addSource.notionSelectDatabase')} />
                </SelectTrigger>
                <SelectContent>
                  {databases.map((db) => (
                    <SelectItem key={db.id} value={db.id}>{db.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">{t('addSource.notionNoDatabases')}</p>
            )}
          </div>
        )}
      </>
    );
  }
);
