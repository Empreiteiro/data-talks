import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2, GitBranch, Star, AlertCircle } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface GithubAnalyticsSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface GithubAnalyticsSourceFormHandle {
  connect: () => Promise<void>;
}

interface RepoInfo {
  full_name: string;
  description: string;
  stars: number;
  forks: number;
  open_issues: number;
  language: string;
  default_branch: string;
  visibility: string;
  tables: string[];
}

export const GithubAnalyticsSourceForm = forwardRef<GithubAnalyticsSourceFormHandle, GithubAnalyticsSourceFormProps>(
  function GithubAnalyticsSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [token, setToken] = useState("");
    const [owner, setOwner] = useState("");
    const [repo, setRepo] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
    const [discovering, setDiscovering] = useState(false);

    const canConnect = connectionTested && !!repoInfo;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => {
      setConnectionTested(false);
      setRepoInfo(null);
    }, [token, owner, repo]);

    const handleTestConnection = async () => {
      if (!token.trim() || !owner.trim() || !repo.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.githubAnalyticsTestConnection({ token, owner, repo });
        setConnectionTested(true);
        toast.success(t('addSource.githubAnalyticsConnectionSuccess'));
        // Discover resources
        setDiscovering(true);
        try {
          const res = await dataClient.githubAnalyticsDiscover({ token, owner, repo });
          setRepoInfo(res as RepoInfo);
        } catch {
          setRepoInfo(null);
        } finally {
          setDiscovering(false);
        }
      } catch (error: unknown) {
        setConnectionTested(false);
        toast.error(t('addSource.githubAnalyticsConnectionFailed'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!token || !owner || !repo) {
        toast.error(t('addSource.githubAnalyticsFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = `GitHub: ${owner}/${repo}`;
        const metadata = {
          token,
          owner,
          repo,
          repoFullName: repoInfo?.full_name || `${owner}/${repo}`,
        };

        const source = await dataClient.createSource(name, 'github_analytics', metadata, undefined);
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
          await dataClient.githubAnalyticsRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.githubAnalyticsConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error: unknown) {
        console.error('GitHub Analytics connection error:', error);
        toast.error(t('addSource.githubAnalyticsConnectError'), { description: error instanceof Error ? error.message : String(error) });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>GitHub Analytics</strong> — {t('addSource.githubAnalyticsDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.githubAnalyticsHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gh-analytics-token">{t('addSource.githubAnalyticsToken')}</Label>
          <Input
            id="gh-analytics-token"
            type="password"
            placeholder={t('addSource.githubAnalyticsTokenPlaceholder')}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={testingConnection}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gh-analytics-owner">{t('addSource.githubAnalyticsOwner')}</Label>
            <Input
              id="gh-analytics-owner"
              placeholder={t('addSource.githubAnalyticsOwnerPlaceholder')}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={testingConnection}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gh-analytics-repo">{t('addSource.githubAnalyticsRepo')}</Label>
            <Input
              id="gh-analytics-repo"
              placeholder={t('addSource.githubAnalyticsRepoPlaceholder')}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={testingConnection}
            />
          </div>
        </div>

        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={!token.trim() || !owner.trim() || !repo.trim() || testingConnection}
          className="w-full"
        >
          {testingConnection ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.githubAnalyticsTestingConnection')}</>
          ) : connectionTested ? (
            <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.githubAnalyticsConnectionSuccess')}</>
          ) : (
            t('addSource.githubAnalyticsTestConnection')
          )}
        </Button>

        {discovering && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('addSource.githubAnalyticsDiscovering')}
          </p>
        )}

        {repoInfo && (
          <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="font-medium text-sm">{repoInfo.full_name}</span>
              {repoInfo.visibility && (
                <span className="text-xs bg-muted px-2 py-0.5 rounded">{repoInfo.visibility}</span>
              )}
            </div>
            {repoInfo.description && (
              <p className="text-xs text-muted-foreground">{repoInfo.description}</p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Star className="h-3 w-3" /> {repoInfo.stars}</span>
              <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> {repoInfo.forks} forks</span>
              <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {repoInfo.open_issues} issues</span>
              {repoInfo.language && <span>{repoInfo.language}</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              <strong>{t('addSource.githubAnalyticsTables')}:</strong>{" "}
              {repoInfo.tables.join(", ")}
            </div>
          </div>
        )}
      </>
    );
  }
);
