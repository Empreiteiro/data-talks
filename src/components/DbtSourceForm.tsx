import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        toast.warning("Nenhum modelo encontrado no manifest.");
      } else {
        toast.success(`${res.total} modelos encontrados.`);
      }
    } catch (e: unknown) {
      toast.error("Erro ao buscar manifest", { description: (e as Error).message });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleConnect = async () => {
    if (!connectionString.trim()) {
      toast.error("Connection string é obrigatória para consultar os modelos dbt.");
      return;
    }
    if (projectSource === "github" && !githubRepo.trim()) {
      toast.error("githubRepo é obrigatório.");
      return;
    }
    if (projectSource === "cloud" && (!dbtCloudToken || !dbtCloudAccountId || !dbtCloudJobId)) {
      toast.error("dbtCloudToken, dbtCloudAccountId e dbtCloudJobId são obrigatórios.");
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
      toast.success("Fonte dbt criada com sucesso!");
      onSourceAdded?.(source.id);
      onClose();
    } catch (e: unknown) {
      toast.error("Erro ao criar fonte dbt", { description: (e as Error).message });
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
        <Label>Origem do manifest</Label>
        <Select value={projectSource} onValueChange={(v) => { setProjectSource(v as "github" | "cloud"); setAvailableModels([]); setSelectedModels([]); }}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">GitHub</SelectItem>
            <SelectItem value="cloud">dbt Cloud</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {projectSource === "github" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="dbt-github-token">GitHub Token (opcional para repos públicos)</Label>
            <Input id="dbt-github-token" type="password" placeholder="ghp_..." value={githubToken} onChange={(e) => setGithubToken(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dbt-github-repo">Repositório <span className="text-red-500">*</span></Label>
            <Input id="dbt-github-repo" placeholder="owner/repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dbt-github-branch">Branch</Label>
              <Input id="dbt-github-branch" placeholder="main" value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbt-manifest-path">Caminho do manifest</Label>
              <Input id="dbt-manifest-path" placeholder="target/manifest.json" value={manifestPath} onChange={(e) => setManifestPath(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="dbt-cloud-token">dbt Cloud Service Token <span className="text-red-500">*</span></Label>
            <Input id="dbt-cloud-token" type="password" placeholder="dbtc_..." value={dbtCloudToken} onChange={(e) => setDbtCloudToken(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dbt-account-id">Account ID <span className="text-red-500">*</span></Label>
              <Input id="dbt-account-id" placeholder="12345" value={dbtCloudAccountId} onChange={(e) => setDbtCloudAccountId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dbt-job-id">Job ID <span className="text-red-500">*</span></Label>
              <Input id="dbt-job-id" placeholder="67890" value={dbtCloudJobId} onChange={(e) => setDbtCloudJobId(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {/* Fetch models button */}
      <Button type="button" variant="outline" className="w-full" onClick={handleFetchModels} disabled={!canFetch || loadingModels}>
        {loadingModels ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Buscando modelos...</> : "Buscar modelos do manifest"}
      </Button>

      {/* Model selection */}
      {availableModels.length > 0 && (
        <div className="space-y-2">
          <Label>Modelos ({selectedModels.length}/{availableModels.length} selecionados)</Label>
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
        <Label htmlFor="dbt-conn-string">Connection String do warehouse <span className="text-red-500">*</span></Label>
        <Input id="dbt-conn-string" type="password" placeholder="postgresql://user:password@host:5432/database" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} />
        <p className="text-xs text-muted-foreground">A mesma connection string usada pelo dbt para executar as queries.</p>
      </div>

      {/* Connect button */}
      <Button className="w-full" onClick={handleConnect} disabled={connecting || !connectionString.trim()}>
        {connecting ? "Conectando..." : "Conectar fonte dbt"}
      </Button>
    </div>
  );
}
