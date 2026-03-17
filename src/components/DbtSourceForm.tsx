import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface DbtModel {
  name: string;
  columns: string[];
  description: string;
}

interface DbtSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
}

export function DbtSourceForm({ agentId, onSourceAdded, onClose }: DbtSourceFormProps) {
  const { t } = useLanguage();
  const [projectSource, setProjectSource] = useState<"github" | "cloud">("github");
  // GitHub fields
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [manifestPath, setManifestPath] = useState("target/manifest.json");
  // dbt Cloud fields
  const [dbtCloudToken, setDbtCloudToken] = useState("");
  const [dbtCloudAccountId, setDbtCloudAccountId] = useState("");
  const [dbtCloudJobId, setDbtCloudJobId] = useState("");
  // Connection
  const [connectionString, setConnectionString] = useState("");
  // Models
  const [availableModels, setAvailableModels] = useState<DbtModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleFetchModels = async () => {
    setLoadingModels(true);
    setAvailableModels([]);
    setSelectedModels([]);
    try {
      const body =
        projectSource === "github"
          ? { projectSource, githubToken: githubToken || undefined, githubRepo, githubBranch, manifestPath }
          : { projectSource, dbtCloudToken, dbtCloudAccountId, dbtCloudJobId };
      const res = await dataClient.dbtValidateManifest(body);
      setAvailableModels(res.models || []);
      setSelectedModels((res.models || []).map((m) => m.name));
      if ((res.models || []).length === 0) {
        toast.warning(t('addSource.dbtNoModels'));
      } else {
        toast.success(t('addSource.dbtModelsFound', { count: res.total }));
      }
    } catch (e: unknown) {
      toast.error(t('addSource.dbtFetchError'), { description: (e as Error).message });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleConnect = async () => {
    if (!connectionString.trim()) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }
    if (projectSource === "github" && !githubRepo.trim()) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }
    if (projectSource === "cloud" && (!dbtCloudToken || !dbtCloudAccountId || !dbtCloudJobId)) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }

    setConnecting(true);
    try {
      const sourceName =
        projectSource === "github" ? `dbt ${githubRepo}` : `dbt Cloud ${dbtCloudAccountId}`;

      const tableInfos = availableModels
        .filter((m) => selectedModels.includes(m.name))
        .map((m) => ({ table: m.name, columns: m.columns, description: m.description }));

      const metadata: Record<string, unknown> = {
        projectSource,
        connectionString: connectionString.trim(),
        selectedModels: selectedModels.length > 0 ? selectedModels : null,
        table_infos: tableInfos.length > 0 ? tableInfos : null,
      };

      if (projectSource === "github") {
        metadata.githubToken = githubToken || null;
        metadata.githubRepo = githubRepo.trim();
        metadata.githubBranch = githubBranch.trim() || "main";
        metadata.manifestPath = manifestPath.trim() || "target/manifest.json";
      } else {
        metadata.dbtCloudToken = dbtCloudToken.trim();
        metadata.dbtCloudAccountId = dbtCloudAccountId.trim();
        metadata.dbtCloudJobId = dbtCloudJobId.trim();
      }

      const source = await dataClient.createSource(sourceName, "dbt", metadata, undefined);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources.map((s: { id: string }) => dataClient.updateSource(s.id, { is_active: false }))
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
      }
      toast.success(t('addSource.dbtConnectSuccess'));
      onSourceAdded?.(source.id);
      onClose();
    } catch (e: unknown) {
      toast.error(t('addSource.dbtConnectError'), { description: (e as Error).message });
    } finally {
      setConnecting(false);
    }
  };

  const canFetch =
    projectSource === "github"
      ? githubRepo.trim().length > 0
      : dbtCloudToken.trim().length > 0 && dbtCloudAccountId.trim().length > 0 && dbtCloudJobId.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Source type toggle */}
      <div className="space-y-2">
        <Label>{t('addSource.dbtManifestOrigin')}</Label>
        <Select value={projectSource} onValueChange={(v) => { setProjectSource(v as "github" | "cloud"); setAvailableModels([]); setSelectedModels([]); }}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">{t('addSource.dbtGithub')}</SelectItem>
            <SelectItem value="cloud">{t('addSource.dbtCloud')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {projectSource === "github" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="dbt-github-token">{t('addSource.dbtGithubToken')}</Label>
            <Input id="dbt-github-token" type="password" placeholder="ghp_..." value={githubToken} onChange={(e) => setGithubToken(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dbt-github-repo">{t('addSource.dbtGithubRepo')} <span className="text-red-500">*</span></Label>
            <Input id="dbt-github-repo" placeholder="owner/repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dbt-github-branch">{t('addSource.dbtGithubBranch')}</Label>
              <Input id="dbt-github-branch" placeholder="main" value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbt-manifest-path">{t('addSource.dbtManifestPath')}</Label>
              <Input id="dbt-manifest-path" placeholder="target/manifest.json" value={manifestPath} onChange={(e) => setManifestPath(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="dbt-cloud-token">{t('addSource.dbtCloudToken')} <span className="text-red-500">*</span></Label>
            <Input id="dbt-cloud-token" type="password" placeholder="dbtc_..." value={dbtCloudToken} onChange={(e) => setDbtCloudToken(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dbt-account-id">{t('addSource.dbtCloudAccountId')} <span className="text-red-500">*</span></Label>
              <Input id="dbt-account-id" placeholder="12345" value={dbtCloudAccountId} onChange={(e) => setDbtCloudAccountId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbt-job-id">{t('addSource.dbtCloudJobId')} <span className="text-red-500">*</span></Label>
              <Input id="dbt-job-id" placeholder="67890" value={dbtCloudJobId} onChange={(e) => setDbtCloudJobId(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {/* Fetch models button */}
      <Button type="button" variant="outline" className="w-full" onClick={handleFetchModels} disabled={!canFetch || loadingModels}>
        {loadingModels ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('addSource.dbtFetchingModels')}</> : t('addSource.dbtFetchModels')}
      </Button>

      {/* Model selection */}
      {availableModels.length > 0 && (
        <div className="space-y-2">
          <Label>{t('addSource.dbtModelsSelected', { selected: selectedModels.length, total: availableModels.length })}</Label>
          <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
            {availableModels.map((model) => {
              const checked = selectedModels.includes(model.name);
              return (
                <label key={model.name} className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedModels((cur) =>
                        e.target.checked ? [...cur, model.name] : cur.filter((n) => n !== model.name)
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{model.name}</span>
                    {model.description && <span className="block text-xs text-muted-foreground truncate">{model.description}</span>}
                    {model.columns.length > 0 && (
                      <span className="block text-xs text-muted-foreground truncate">{model.columns.join(", ")}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Connection string */}
      <div className="space-y-2">
        <Label htmlFor="dbt-conn-string">{t('addSource.dbtConnectionString')} <span className="text-red-500">*</span></Label>
        <Input id="dbt-conn-string" type="password" placeholder="postgresql://user:password@host:5432/database" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} />
        <p className="text-xs text-muted-foreground">{t('addSource.dbtConnectionStringHint')}</p>
      </div>

      {/* Connect button */}
      <Button className="w-full" onClick={handleConnect} disabled={connecting || !connectionString.trim()}>
        {connecting ? t('addSource.connecting') : t('addSource.dbtConnect')}
      </Button>
    </div>
  );
}
