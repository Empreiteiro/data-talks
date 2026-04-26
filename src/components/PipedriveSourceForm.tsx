import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface PipedriveSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface PipedriveSourceFormHandle {
  connect: () => Promise<void>;
}

export const PipedriveSourceForm = forwardRef<PipedriveSourceFormHandle, PipedriveSourceFormProps>(
  function PipedriveSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [apiToken, setApiToken] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [resourceCounts, setResourceCounts] = useState<Record<string, number> | null>(null);

    const canConnect = connectionTested;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setResourceCounts(null);
    }, [apiToken]);

    const handleTestConnection = async () => {
      if (!apiToken.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.pipedriveTestConnection({ apiToken });
        setConnectionTested(true);
        toast.success(t('addSource.pipedriveConnectionSuccess'));
        try {
          const res = await dataClient.pipedriveDiscover({ apiToken });
          setResourceCounts(res.resourceCounts || {});
        } catch {
          setResourceCounts(null);
        }
      } catch (error: unknown) {
        setConnectionTested(false);
        toast.error(t('addSource.pipedriveConnectionFailed'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!apiToken) {
        toast.error(t('addSource.pipedriveFillFields'));
        return;
      }
      setConnecting(true);
      try {
        const name = "Pipedrive CRM";
        const metadata: Record<string, unknown> = { apiToken, resourceCounts: resourceCounts || {} };
        const source = await dataClient.createSource(name, 'pipedrive', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try { await dataClient.pipedriveRefreshMetadata(source.id); } catch { /* non-blocking */ }
        toast.success(t('addSource.pipedriveConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: unknown) {
        toast.error(t('addSource.pipedriveConnectError'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Pipedrive CRM</strong> — {t('addSource.pipedriveDescription')}
          </p>
          <p className="text-xs text-muted-foreground">{t('addSource.pipedriveHint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pipedrive-token">{t('addSource.pipedriveApiToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="pipedrive-token"
              type="password"
              placeholder={t('addSource.pipedriveApiTokenPlaceholder')}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleTestConnection} disabled={!apiToken.trim() || testingConnection} className="shrink-0">
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.pipedriveTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.pipedriveConnectionSuccess')}</>
              ) : (
                t('addSource.pipedriveTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && resourceCounts && (
          <div className="space-y-2">
            <Label>{t('addSource.pipedriveResourcesFound')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(resourceCounts).map(([key, count]) => (
                <div key={key} className="p-2 bg-muted/50 rounded text-sm">
                  <span className="font-medium capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground ml-1">({count})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
);
