import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface SalesforceSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface SalesforceSourceFormHandle {
  connect: () => Promise<void>;
}

export const SalesforceSourceForm = forwardRef<SalesforceSourceFormHandle, SalesforceSourceFormProps>(
  function SalesforceSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [accessToken, setAccessToken] = useState("");
    const [instanceUrl, setInstanceUrl] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [objectCounts, setObjectCounts] = useState<Record<string, number> | null>(null);

    const canConnect = connectionTested;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setObjectCounts(null);
    }, [accessToken, instanceUrl]);

    const handleTestConnection = async () => {
      if (!accessToken.trim() || !instanceUrl.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.salesforceTestConnection({ accessToken, instanceUrl });
        setConnectionTested(true);
        toast.success(t('addSource.salesforceConnectionSuccess'));
        // Discover objects
        try {
          const res = await dataClient.salesforceDiscover({ accessToken, instanceUrl });
          setObjectCounts(res.objectCounts || {});
        } catch {
          setObjectCounts(null);
        }
      } catch (error: any) {
        setConnectionTested(false);
        toast.error(t('addSource.salesforceConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!accessToken || !instanceUrl) {
        toast.error(t('addSource.salesforceFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = "Salesforce CRM";
        const metadata: Record<string, unknown> = {
          accessToken,
          instanceUrl: instanceUrl.replace(/\/+$/, ""),
          objectCounts: objectCounts || {},
        };

        const source = await dataClient.createSource(name, 'salesforce' as any, metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources
              .filter((s: any) => s.id !== source.id && s.type !== 'sql_database')
              .map((s: any) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try {
          await dataClient.salesforceRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.salesforceConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: any) {
        console.error('Salesforce connection error:', error);
        toast.error(t('addSource.salesforceConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Salesforce CRM</strong> — {t('addSource.salesforceDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.salesforceHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="salesforce-access-token">{t('addSource.salesforceAccessToken')}</Label>
          <Input
            id="salesforce-access-token"
            type="password"
            placeholder={t('addSource.salesforceAccessTokenPlaceholder')}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={testingConnection}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="salesforce-instance-url">{t('addSource.salesforceInstanceUrl')}</Label>
          <div className="flex gap-2">
            <Input
              id="salesforce-instance-url"
              type="text"
              placeholder={t('addSource.salesforceInstanceUrlPlaceholder')}
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!accessToken.trim() || !instanceUrl.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.salesforceTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.salesforceConnectionSuccess')}</>
              ) : (
                t('addSource.salesforceTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && objectCounts && (
          <div className="space-y-2">
            <Label>{t('addSource.salesforceObjectsFound')}</Label>
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
