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

interface MongoDbSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface MongoDbSourceFormHandle {
  connect: () => Promise<void>;
}

export const MongoDbSourceForm = forwardRef<MongoDbSourceFormHandle, MongoDbSourceFormProps>(
  function MongoDbSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [connectionString, setConnectionString] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);

    const [databases, setDatabases] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedDatabase, setSelectedDatabase] = useState("");
    const [loadingDatabases, setLoadingDatabases] = useState(false);

    const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedCollection, setSelectedCollection] = useState("");
    const [loadingCollections, setLoadingCollections] = useState(false);

    const canConnect = connectionTested && !!selectedDatabase && !!selectedCollection;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Reset downstream when connection string changes
    useEffect(() => {
      setConnectionTested(false);
      setDatabases([]);
      setSelectedDatabase("");
      setCollections([]);
      setSelectedCollection("");
    }, [connectionString]);

    // Load collections when database is selected
    useEffect(() => {
      if (!connectionTested || !selectedDatabase) {
        setCollections([]);
        setSelectedCollection("");
        return;
      }
      let cancelled = false;
      setLoadingCollections(true);
      (async () => {
        try {
          const res = await dataClient.mongodbListCollections({ connectionString, database: selectedDatabase });
          if (!cancelled) {
            setCollections(res.collections || []);
          }
        } catch {
          if (!cancelled) setCollections([]);
        } finally {
          if (!cancelled) setLoadingCollections(false);
        }
      })();
      return () => { cancelled = true; };
    }, [connectionTested, selectedDatabase]);

    const handleTestConnection = async () => {
      if (!connectionString.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.mongodbTestConnection({ connectionString });
        setConnectionTested(true);
        toast.success(t('addSource.mongodbConnectionSuccess'));
        // Load databases
        setLoadingDatabases(true);
        try {
          const res = await dataClient.mongodbListDatabases({ connectionString });
          setDatabases(res.databases || []);
        } catch {
          setDatabases([]);
        } finally {
          setLoadingDatabases(false);
        }
      } catch (error) {
        setConnectionTested(false);
        toast.error(t('addSource.mongodbConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!connectionString || !selectedDatabase || !selectedCollection) {
        toast.error(t('addSource.mongodbFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = `MongoDB ${selectedDatabase}.${selectedCollection}`;
        const metadata = {
          connectionString,
          database: selectedDatabase,
          collection: selectedCollection,
        };

        const source = await dataClient.createSource(name, 'mongodb' as any, metadata, undefined);
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
          await dataClient.mongodbRefreshMetadata(source.id);
        } catch {
          // non-blocking
        }

        toast.success(t('addSource.mongodbConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('MongoDB connection error:', error);
        toast.error(t('addSource.mongodbConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>MongoDB</strong> — {t('addSource.mongodbDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.mongodbHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mongodb-connection-string">{t('addSource.mongodbConnectionString')}</Label>
          <div className="flex gap-2">
            <Input
              id="mongodb-connection-string"
              type="password"
              placeholder={t('addSource.mongodbConnectionStringPlaceholder')}
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              disabled={testingConnection}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!connectionString.trim() || testingConnection}
              className="shrink-0"
            >
              {testingConnection ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.mongodbTestingConnection')}</>
              ) : connectionTested ? (
                <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.mongodbConnectionSuccess')}</>
              ) : (
                t('addSource.mongodbTestConnection')
              )}
            </Button>
          </div>
        </div>

        {connectionTested && (
          <div className="space-y-2">
            <Label>{t('addSource.mongodbDatabase')}</Label>
            {loadingDatabases ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.mongodbLoadingDatabases')}
              </p>
            ) : (
              <Select value={selectedDatabase} onValueChange={(v) => { setSelectedDatabase(v); setSelectedCollection(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addSource.mongodbSelectDatabase')} />
                </SelectTrigger>
                <SelectContent>
                  {databases.map((db) => (
                    <SelectItem key={db.id} value={db.id}>{db.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {connectionTested && selectedDatabase && (
          <div className="space-y-2">
            <Label>{t('addSource.mongodbCollection')}</Label>
            {loadingCollections ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.mongodbLoadingCollections')}
              </p>
            ) : (
              <Select value={selectedCollection} onValueChange={setSelectedCollection}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addSource.mongodbSelectCollection')} />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((col) => (
                    <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </>
    );
  }
);
