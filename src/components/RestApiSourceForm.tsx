import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface RestApiSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface RestApiSourceFormHandle {
  connect: () => Promise<void>;
}

export const RestApiSourceForm = forwardRef<RestApiSourceFormHandle, RestApiSourceFormProps>(
  function RestApiSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [url, setUrl] = useState("");
    const [method, setMethod] = useState("GET");
    const [headerPairs, setHeaderPairs] = useState<Array<{ key: string; value: string }>>([]);
    const [dataPath, setDataPath] = useState("");
    const [testing, setTesting] = useState(false);
    const [tested, setTested] = useState(false);
    const [previewData, setPreviewData] = useState<{ columns: string[]; preview: any[]; rowCount: number } | null>(null);

    const canConnect = tested && !!url.trim();

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    useEffect(() => { setTested(false); setPreviewData(null); }, [url, method, dataPath]);

    const headersObj = () => {
      const h: Record<string, string> = {};
      headerPairs.forEach((p) => { if (p.key.trim()) h[p.key.trim()] = p.value; });
      return Object.keys(h).length > 0 ? h : undefined;
    };

    const handleTest = async () => {
      if (!url.trim()) return;
      setTesting(true);
      try {
        const result = await dataClient.restApiTest({
          url, method, headers: headersObj(), dataPath: dataPath || undefined,
        });
        setPreviewData(result);
        setTested(true);
        toast.success(t('addSource.restApiTestSuccess'));
      } catch (error) {
        setTested(false);
        toast.error(t('addSource.restApiTestFailed'), { description: error.message });
      } finally {
        setTesting(false);
      }
    };

    const handleConnect = async () => {
      if (!url.trim()) { toast.error(t('addSource.restApiFillFields')); return; }
      setConnecting(true);
      try {
        const parsedUrl = new URL(url);
        const name = `API: ${parsedUrl.hostname}${parsedUrl.pathname}`;
        const metadata: Record<string, unknown> = {
          url, method, dataPath: dataPath || undefined,
          headers: headersObj(),
          columns: previewData?.columns,
          preview: previewData?.preview,
          rowCount: previewData?.rowCount,
        };
        const source = await dataClient.createSource(name, 'rest_api' as any, metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources.filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        toast.success(t('addSource.restApiConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        toast.error(t('addSource.restApiConnectError'), { description: error.message });
      } finally { setConnecting(false); }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm"><strong>REST API</strong> — {t('addSource.restApiDescription')}</p>
          <p className="text-xs text-muted-foreground">{t('addSource.restApiHint')}</p>
        </div>

        <div className="flex gap-2">
          <div className="w-28">
            <Label>{t('addSource.restApiMethod')}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-2">
            <Label>{t('addSource.restApiUrl')}</Label>
            <Input placeholder="https://api.example.com/v1/data" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('addSource.restApiHeaders')}</Label>
            <Button variant="ghost" size="sm" onClick={() => setHeaderPairs([...headerPairs, { key: "", value: "" }])}>
              <Plus className="h-3 w-3 mr-1" /> {t('addSource.restApiAddHeader')}
            </Button>
          </div>
          {headerPairs.map((pair, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input placeholder="Header name" value={pair.key} onChange={(e) => { const n = [...headerPairs]; n[i].key = e.target.value; setHeaderPairs(n); }} className="w-1/3" />
              <Input placeholder="Value" value={pair.value} onChange={(e) => { const n = [...headerPairs]; n[i].value = e.target.value; setHeaderPairs(n); }} className="flex-1" />
              <Button variant="ghost" size="icon" onClick={() => setHeaderPairs(headerPairs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>{t('addSource.restApiDataPath')}</Label>
          <Input placeholder={t('addSource.restApiDataPathPlaceholder')} value={dataPath} onChange={(e) => setDataPath(e.target.value)} />
        </div>

        <Button variant="outline" onClick={handleTest} disabled={!url.trim() || testing} className="w-full">
          {testing ? (<><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.restApiTesting')}</>) : (t('addSource.restApiTestRequest'))}
        </Button>

        {previewData && previewData.columns.length > 0 && (
          <div className="space-y-2 p-3 bg-muted/30 rounded border">
            <p className="text-sm font-medium">{t('addSource.restApiPreview')}: {previewData.rowCount} rows, {previewData.columns.length} columns</p>
            <div className="overflow-x-auto max-h-40">
              <table className="text-xs w-full">
                <thead><tr>{previewData.columns.slice(0, 8).map((c) => <th key={c} className="text-left px-2 py-1 border-b font-medium">{c}</th>)}</tr></thead>
                <tbody>{previewData.preview.slice(0, 3).map((row, i) => <tr key={i}>{previewData.columns.slice(0, 8).map((c) => <td key={c} className="px-2 py-1 border-b truncate max-w-[150px]">{String(row[c] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }
);
