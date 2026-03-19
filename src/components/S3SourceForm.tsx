import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { CheckCircle, Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface S3SourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface S3SourceFormHandle {
  connect: () => Promise<void>;
}

export const S3SourceForm = forwardRef<S3SourceFormHandle, S3SourceFormProps>(
  function S3SourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [accessKeyId, setAccessKeyId] = useState("");
    const [secretAccessKey, setSecretAccessKey] = useState("");
    const [region, setRegion] = useState("us-east-1");
    const [endpoint, setEndpoint] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);

    const [buckets, setBuckets] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedBucket, setSelectedBucket] = useState("");
    const [loadingBuckets, setLoadingBuckets] = useState(false);

    const [objects, setObjects] = useState<Array<{ key: string; size: number }>>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [loadingObjects, setLoadingObjects] = useState(false);

    const canConnect = connectionTested && !!selectedBucket && !!selectedKey;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    const creds = { accessKeyId, secretAccessKey, region, endpoint: endpoint || undefined };

    useEffect(() => {
      setConnectionTested(false);
      setBuckets([]);
      setSelectedBucket("");
      setObjects([]);
      setSelectedKey("");
    }, [accessKeyId, secretAccessKey, region, endpoint]);

    // Load objects when bucket is selected
    useEffect(() => {
      if (!connectionTested || !selectedBucket) {
        setObjects([]);
        setSelectedKey("");
        return;
      }
      let cancelled = false;
      setLoadingObjects(true);
      (async () => {
        try {
          const res = await dataClient.s3ListObjects({ ...creds, bucket: selectedBucket });
          if (!cancelled) setObjects(res.objects || []);
        } catch { if (!cancelled) setObjects([]); }
        finally { if (!cancelled) setLoadingObjects(false); }
      })();
      return () => { cancelled = true; };
    }, [connectionTested, selectedBucket]);

    const handleTestConnection = async () => {
      if (!accessKeyId.trim() || !secretAccessKey.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.s3TestConnection(creds);
        setConnectionTested(true);
        toast.success(t('addSource.s3ConnectionSuccess'));
        setLoadingBuckets(true);
        try {
          const res = await dataClient.s3ListBuckets(creds);
          setBuckets(res.buckets || []);
        } catch { setBuckets([]); }
        finally { setLoadingBuckets(false); }
      } catch (error) {
        setConnectionTested(false);
        toast.error(t('addSource.s3ConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!canConnect) { toast.error(t('addSource.s3FillFields')); return; }
      setConnecting(true);
      try {
        const fileName = selectedKey.split("/").pop() || selectedKey;
        const name = `S3: ${selectedBucket}/${fileName}`;
        const metadata = {
          accessKeyId, secretAccessKey, region,
          endpoint: endpoint || undefined,
          bucket: selectedBucket, key: selectedKey,
        };
        const source = await dataClient.createSource(name, 's3', metadata, undefined);
        if (agentId && source?.id) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources.filter((s) => s.id !== source.id && s.type !== 'sql_database')
              .map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
        }
        try { await dataClient.s3RefreshMetadata(source.id); } catch { /* non-blocking */ }
        toast.success(t('addSource.s3ConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        toast.error(t('addSource.s3ConnectError'), { description: error.message });
      } finally { setConnecting(false); }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm"><strong>Amazon S3 / MinIO</strong> — {t('addSource.s3Description')}</p>
          <p className="text-xs text-muted-foreground">{t('addSource.s3Hint')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('addSource.s3AccessKeyId')}</Label>
            <Input placeholder="AKIA..." value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={testingConnection} />
          </div>
          <div className="space-y-2">
            <Label>{t('addSource.s3SecretAccessKey')}</Label>
            <Input type="password" placeholder="••••••••" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} disabled={testingConnection} />
          </div>
          <div className="space-y-2">
            <Label>{t('addSource.s3Region')}</Label>
            <Input placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} disabled={testingConnection} />
          </div>
          <div className="space-y-2">
            <Label>{t('addSource.s3Endpoint')}</Label>
            <Input placeholder={t('addSource.s3EndpointPlaceholder')} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={testingConnection} />
          </div>
        </div>

        <Button variant="outline" onClick={handleTestConnection} disabled={!accessKeyId.trim() || !secretAccessKey.trim() || testingConnection} className="w-full">
          {testingConnection ? (<><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.s3TestingConnection')}</>) : connectionTested ? (<><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.s3ConnectionSuccess')}</>) : (t('addSource.s3TestConnection'))}
        </Button>

        {connectionTested && (
          <div className="space-y-2">
            <Label>{t('addSource.s3Bucket')}</Label>
            {loadingBuckets ? (<p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.s3LoadingBuckets')}</p>) : (
              <Select value={selectedBucket} onValueChange={(v) => { setSelectedBucket(v); setSelectedKey(""); }}>
                <SelectTrigger><SelectValue placeholder={t('addSource.s3SelectBucket')} /></SelectTrigger>
                <SelectContent>{buckets.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}</SelectContent>
              </Select>
            )}
          </div>
        )}

        {connectionTested && selectedBucket && (
          <div className="space-y-2">
            <Label>{t('addSource.s3File')}</Label>
            {loadingObjects ? (<p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.s3LoadingFiles')}</p>) : objects.length > 0 ? (
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger><SelectValue placeholder={t('addSource.s3SelectFile')} /></SelectTrigger>
                <SelectContent>{objects.map((o) => (<SelectItem key={o.key} value={o.key}>{o.key} ({(o.size / 1024).toFixed(1)} KB)</SelectItem>))}</SelectContent>
              </Select>
            ) : (<p className="text-sm text-muted-foreground">{t('addSource.s3NoFiles')}</p>)}
          </div>
        )}
      </>
    );
  }
);
