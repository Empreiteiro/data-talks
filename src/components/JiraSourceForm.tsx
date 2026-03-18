import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface JiraSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface JiraSourceFormHandle {
  connect: () => Promise<void>;
}

export const JiraSourceForm = forwardRef<JiraSourceFormHandle, JiraSourceFormProps>(
  function JiraSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [domain, setDomain] = useState("");
    const [email, setEmail] = useState("");
    const [apiToken, setApiToken] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [displayName, setDisplayName] = useState("");

    const [projects, setProjects] = useState<Array<{ id: string; key: string; name: string }>>([]);
    const [boards, setBoards] = useState<Array<{ id: number; name: string; type: string }>>([]);
    const [loadingDiscovery, setLoadingDiscovery] = useState(false);

    const canConnect = connectionTested;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setProjects([]);
      setBoards([]);
      setDisplayName("");
    }, [domain, email, apiToken]);

    const handleTestConnection = async () => {
      if (!domain.trim() || !email.trim() || !apiToken.trim()) return;
      setTestingConnection(true);
      try {
        const res = await dataClient.jiraTestConnection({ domain, email, apiToken });
        setConnectionTested(true);
        setDisplayName(res.displayName || "");
        toast.success(t('addSource.jiraConnectionSuccess'));
        // Discover projects and boards
        setLoadingDiscovery(true);
        try {
          const disc = await dataClient.jiraDiscover({ domain, email, apiToken });
          setProjects(disc.projects || []);
          setBoards(disc.boards || []);
        } catch {
          setProjects([]);
          setBoards([]);
        } finally {
          setLoadingDiscovery(false);
        }
      } catch (error: any) {
        setConnectionTested(false);
        toast.error(t('addSource.jiraConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!domain || !email || !apiToken) {
        toast.error(t('addSource.jiraFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = `Jira: ${domain}`;
        const metadata = {
          domain,
          email,
          apiToken,
          projects,
          boards,
          projectCount: projects.length,
          boardCount: boards.length,
        };

        const source = await dataClient.createSource(name, 'jira' as any, metadata, undefined);
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
          await dataClient.jiraRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.jiraConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: any) {
        console.error('Jira connection error:', error);
        toast.error(t('addSource.jiraConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Jira</strong> — {t('addSource.jiraDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.jiraHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="jira-domain">{t('addSource.jiraDomain')}</Label>
          <Input
            id="jira-domain"
            type="text"
            placeholder={t('addSource.jiraDomainPlaceholder')}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={testingConnection}
          />
          <p className="text-xs text-muted-foreground">{t('addSource.jiraDomainHint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="jira-email">{t('addSource.jiraEmail')}</Label>
          <Input
            id="jira-email"
            type="email"
            placeholder={t('addSource.jiraEmailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={testingConnection}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="jira-token">{t('addSource.jiraApiToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="jira-token"
              type="password"
              placeholder={t('addSource.jiraApiTokenPlaceholder')}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!domain.trim() || !email.trim() || !apiToken.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.jiraTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.jiraConnectionSuccess')}</>
              ) : (
                t('addSource.jiraTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
            {displayName && (
              <p className="text-sm">{t('addSource.jiraConnectedAs')}: <strong>{displayName}</strong></p>
            )}
            {loadingDiscovery ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.jiraLoadingDiscovery')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('addSource.jiraDiscoveryResult')
                  .replace('{projects}', String(projects.length))
                  .replace('{boards}', String(boards.length))}
              </p>
            )}
          </div>
        )}
      </>
    );
  }
);
