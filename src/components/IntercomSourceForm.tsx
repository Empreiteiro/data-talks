import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface IntercomSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface IntercomSourceFormHandle {
  connect: () => Promise<void>;
}

export const IntercomSourceForm = forwardRef<IntercomSourceFormHandle, IntercomSourceFormProps>(
  function IntercomSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [accessToken, setAccessToken] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [appName, setAppName] = useState("");

    const [resources, setResources] = useState<Array<{ id: string; name: string; count: number }>>([]);
    const [loadingResources, setLoadingResources] = useState(false);

    const canConnect = connectionTested && resources.length > 0;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setResources([]);
      setAppName("");
    }, [accessToken]);

    const handleTestConnection = async () => {
      if (!accessToken.trim()) return;
      setTestingConnection(true);
      try {
        const res = await dataClient.intercomTestConnection({ accessToken });
        setConnectionTested(true);
        setAppName(res.app || res.admin || "Intercom");
        toast.success(t('addSource.intercomConnectionSuccess'));
        // Discover resources
        setLoadingResources(true);
        try {
          const disc = await dataClient.intercomDiscover({ accessToken });
          setResources(disc.resources || []);
        } catch {
          setResources([]);
        } finally {
          setLoadingResources(false);
        }
      } catch (error: unknown) {
        setConnectionTested(false);
        toast.error(t('addSource.intercomConnectionFailed'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!accessToken) {
        toast.error(t('addSource.intercomFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = `Intercom: ${appName || "Workspace"}`;
        const metadata = {
          accessToken,
          selectedResources: resources.map((r) => r.id),
        };

        const source = await dataClient.createSource(name, 'intercom', metadata, undefined);
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
          await dataClient.intercomRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.intercomConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: unknown) {
        console.error('Intercom connection error:', error);
        toast.error(t('addSource.intercomConnectError'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Intercom</strong> — {t('addSource.intercomDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.intercomHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="intercom-token">{t('addSource.intercomToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="intercom-token"
              type="password"
              placeholder={t('addSource.intercomTokenPlaceholder')}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!accessToken.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.intercomTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.intercomConnectionSuccess')}</>
              ) : (
                t('addSource.intercomTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && (
          <div className="space-y-2">
            <Label>{t('addSource.intercomResources')}</Label>
            {loadingResources ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.intercomLoadingResources')}
              </p>
            ) : resources.length > 0 ? (
              <div className="grid gap-1">
                {resources.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm py-1 px-2 bg-muted/50 rounded">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.count >= 0 ? `${r.count} records` : "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('addSource.intercomNoResources')}</p>
            )}
          </div>
        )}
      </>
    );
  }
);
