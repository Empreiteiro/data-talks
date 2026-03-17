import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface GithubFileSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
}

export function GithubFileSourceForm({ agentId, onSourceAdded, onClose }: GithubFileSourceFormProps) {
  const { t } = useLanguage();
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<{ columns: string[]; previewRows: Record<string, unknown>[]; rowCount: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handlePreview = async () => {
    if (!githubRepo.trim() || !filePath.trim()) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }
    setLoadingPreview(true);
    setPreview(null);
    try {
      const res = await dataClient.githubValidateFile({
        githubToken: githubToken || undefined,
        githubRepo: githubRepo.trim(),
        githubBranch: githubBranch.trim() || "main",
        filePath: filePath.trim(),
      });
      setPreview(res);
      toast.success(t('addSource.githubRowsColumns', { rows: res.rowCount, cols: res.columns.length }));
    } catch (e: unknown) {
      toast.error(t('addSource.githubValidateError'), { description: (e as Error).message });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConnect = async () => {
    if (!githubRepo.trim() || !filePath.trim()) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }
    setConnecting(true);
    try {
      const sourceName = `GitHub ${filePath.split("/").pop() || filePath} (${githubRepo})`;
      const metadata: Record<string, unknown> = {
        githubToken: githubToken || null,
        githubRepo: githubRepo.trim(),
        githubBranch: githubBranch.trim() || "main",
        filePath: filePath.trim(),
        columns: preview?.columns ?? null,
        preview_rows: preview?.previewRows ?? null,
        row_count: preview?.rowCount ?? null,
      };

      const source = await dataClient.createSource(sourceName, "github_file", metadata, undefined);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources.map((s: { id: string }) => dataClient.updateSource(s.id, { is_active: false }))
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
      }
      toast.success(t('addSource.githubConnectSuccess'));
      onSourceAdded?.(source.id);
      onClose();
    } catch (e: unknown) {
      toast.error(t('addSource.githubConnectError'), { description: (e as Error).message });
    } finally {
      setConnecting(false);
    }
  };

  const canPreview = githubRepo.trim().length > 0 && filePath.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gh-token">{t('addSource.githubToken')}</Label>
        <Input id="gh-token" type="password" placeholder="ghp_..." value={githubToken} onChange={(e) => setGithubToken(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="gh-repo">{t('addSource.githubRepo')} <span className="text-red-500">*</span></Label>
        <Input id="gh-repo" placeholder="owner/repo" value={githubRepo} onChange={(e) => { setGithubRepo(e.target.value); setPreview(null); }} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="gh-branch">{t('addSource.githubBranch')}</Label>
          <Input id="gh-branch" placeholder="main" value={githubBranch} onChange={(e) => { setGithubBranch(e.target.value); setPreview(null); }} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gh-file-path">{t('addSource.githubFilePath')} <span className="text-red-500">*</span></Label>
          <Input id="gh-file-path" placeholder="data/sales.csv" value={filePath} onChange={(e) => { setFilePath(e.target.value); setPreview(null); }} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('addSource.githubSupportedFormats')}</p>

      {/* Preview button */}
      <Button type="button" variant="outline" className="w-full" onClick={handlePreview} disabled={!canPreview || loadingPreview}>
        {loadingPreview ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('addSource.githubPreviewing')}</> : t('addSource.githubPreview')}
      </Button>

      {/* Preview result */}
      {preview && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <p className="text-sm font-medium">
            {t('addSource.githubRowsColumns', { rows: preview.rowCount, cols: preview.columns.length })}
          </p>
          <p className="text-xs text-muted-foreground break-all">{preview.columns.join(", ")}</p>
          {preview.previewRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    {preview.columns.slice(0, 6).map((col) => (
                      <th key={col} className="text-left px-1 py-0.5 font-medium border-b truncate max-w-[100px]">{col}</th>
                    ))}
                    {preview.columns.length > 6 && <th className="text-left px-1 py-0.5 font-medium border-b">...</th>}
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.slice(0, 3).map((row, i) => (
                    <tr key={i}>
                      {preview.columns.slice(0, 6).map((col) => (
                        <td key={col} className="px-1 py-0.5 border-b text-muted-foreground truncate max-w-[100px]">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                      {preview.columns.length > 6 && <td className="px-1 py-0.5 border-b text-muted-foreground">...</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Connect button */}
      <Button className="w-full" onClick={handleConnect} disabled={connecting || !canPreview}>
        {connecting ? t('addSource.connecting') : t('addSource.githubConnect')}
      </Button>
    </div>
  );
}
