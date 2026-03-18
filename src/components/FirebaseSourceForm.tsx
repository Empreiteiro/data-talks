import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface FirebaseSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface FirebaseSourceFormHandle {
  connect: () => Promise<void>;
}

export const FirebaseSourceForm = forwardRef<FirebaseSourceFormHandle, FirebaseSourceFormProps>(
  function FirebaseSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [credentialsFile, setCredentialsFile] = useState<File | null>(null);
    const [availableCollections, setAvailableCollections] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
    const [loadingCollections, setLoadingCollections] = useState(false);

    const canConnect = !!credentialsFile && selectedCollections.length > 0;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Load collections when credentials file is selected
    useEffect(() => {
      if (!credentialsFile) {
        setAvailableCollections([]);
        setSelectedCollections([]);
        return;
      }
      let cancelled = false;
      setLoadingCollections(true);
      (async () => {
        try {
          const credentialsContent = await credentialsFile.text();
          const res = await dataClient.firebaseListCollections({ credentialsContent });
          if (!cancelled) {
            setAvailableCollections(res.collections || []);
            setSelectedCollections((res.collections || []).map((c) => c.id));
          }
        } catch {
          if (!cancelled) setAvailableCollections([]);
        } finally {
          if (!cancelled) setLoadingCollections(false);
        }
      })();
      return () => { cancelled = true; };
    }, [credentialsFile]);

    const handleConnect = async () => {
      if (!credentialsFile) {
        toast.error(t('addSource.firebaseSelectCredentials'));
        return;
      }
      if (selectedCollections.length === 0) {
        toast.error(t('addSource.firebaseSelectCollections'));
        return;
      }

      setConnecting(true);
      try {
        const credentialsContent = await credentialsFile.text();
        let projectId = '';
        try {
          const parsed = JSON.parse(credentialsContent);
          projectId = parsed.project_id || '';
        } catch {
          // ignore
        }

        const name = `Firebase ${projectId || credentialsFile.name}`;
        const metadata = {
          credentialsContent,
          projectId,
          collections: selectedCollections,
        };

        const source = await dataClient.createSource(name, 'firebase', metadata, undefined);
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
          await dataClient.refreshSourceFirebaseMetadata(source.id);
        } catch {
          // non-blocking
        }

        toast.success(t('addSource.firebaseConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('Firebase connection error:', error);
        toast.error(t('addSource.firebaseConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Firebase Firestore</strong> — {t('addSource.firebaseDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.firebaseHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="firebase-credentials">{t('addSource.firebaseCredentials')}</Label>
          <Input
            id="firebase-credentials"
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setCredentialsFile(file);
              setAvailableCollections([]);
              setSelectedCollections([]);
            }}
            disabled={loadingCollections}
          />
          {loadingCollections && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('addSource.firebaseLoadingCollections')}
            </p>
          )}
        </div>

        {availableCollections.length > 0 && (
          <div className="space-y-2">
            <Label>{t('addSource.firebaseAvailableCollections')}</Label>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-2">
              {availableCollections.map((col) => {
                const isChecked = selectedCollections.includes(col.id);
                return (
                  <label key={col.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        setSelectedCollections((current) =>
                          e.target.checked
                            ? [...current, col.id]
                            : current.filter((c) => c !== col.id)
                        );
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-sm">{col.name}</span>
                  </label>
                );
              })}
            </div>
            {selectedCollections.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('addSource.firebaseSelectedCount', { count: selectedCollections.length })}
              </p>
            )}
          </div>
        )}
      </>
    );
  }
);
