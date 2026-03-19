import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface HubspotSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface HubspotSourceFormHandle {
  connect: () => Promise<void>;
}

export const HubspotSourceForm = forwardRef<HubspotSourceFormHandle, HubspotSourceFormProps>(
  function HubspotSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [objectCounts, setObjectCounts] = useState<Record<string, number> | null>(null);

    const canConnect = connectionTested;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setObjectCounts(null);
    }, [apiKey]);

    const handleTestConnection = async () => {
      if (!apiKey.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.hubspotTestConnection({ apiKey });
        setConnectionTested(true);
        toast.success(t('addSource.hubspotConnectionSuccess'));
        // Discover objects
        try {
          const res = await dataClient.hubspotDiscover({ apiKey });
          setObjectCounts(res.objectCounts || {});
        } catch {
          setObjectCounts(null);
        }
      } catch (error) {
        setConnectionTested(false);
        toast.error(t('addSource.hubspotConnectionFailed'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!apiKey) {
        toast.error(t('addSource.hubspotFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = "HubSpot CRM";
        const metadata: Record<string, unknown> = {
          apiKey,
          objectCounts: objectCounts || {},
        };

        const source = await dataClient.createSource(name, 'hubspot', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s: { id: string; type: string }) => s.id !== source.id && s.type !== 'sql_database')
              .map((s: { id: string; type: string }) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try {
          await dataClient.hubspotRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.hubspotConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('HubSpot connection error:', error);
        toast.error(t('addSource.hubspotConnectError'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>HubSpot CRM</strong> — {t('addSource.hubspotDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.hubspotHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hubspot-api-key">{t('addSource.hubspotApiKey')}</Label>
          <div className="flex gap-2">
            <Input
              id="hubspot-api-key"
              type="password"
              placeholder={t('addSource.hubspotApiKeyPlaceholder')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!apiKey.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.hubspotTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.hubspotConnectionSuccess')}</>
              ) : (
                t('addSource.hubspotTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && objectCounts && (
          <div className="space-y-2">
            <Label>{t('addSource.hubspotObjectsFound')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(objectCounts).map(([key, count]) => (
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
