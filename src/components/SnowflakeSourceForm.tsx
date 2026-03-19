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

interface SnowflakeSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface SnowflakeSourceFormHandle {
  connect: () => Promise<void>;
}

export const SnowflakeSourceForm = forwardRef<SnowflakeSourceFormHandle, SnowflakeSourceFormProps>(
  function SnowflakeSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);

    const [account, setAccount] = useState("");
    const [sfUser, setSfUser] = useState("");
    const [password, setPassword] = useState("");
    const [connectionTested, setConnectionTested] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);

    const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedWarehouse, setSelectedWarehouse] = useState("");
    const [loadingWarehouses, setLoadingWarehouses] = useState(false);

    const [databases, setDatabases] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedDatabase, setSelectedDatabase] = useState("");
    const [loadingDatabases, setLoadingDatabases] = useState(false);

    const [schemas, setSchemas] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedSchema, setSelectedSchema] = useState("");
    const [loadingSchemas, setLoadingSchemas] = useState(false);

    const [tables, setTables] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [loadingTables, setLoadingTables] = useState(false);

    const canConnect = connectionTested && !!selectedWarehouse && !!selectedDatabase && !!selectedSchema && selectedTables.length > 0;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    const creds = { account, user: sfUser, password };

    // Reset downstream on credential changes
    useEffect(() => {
      setConnectionTested(false);
      setWarehouses([]);
      setSelectedWarehouse("");
      setDatabases([]);
      setSelectedDatabase("");
      setSchemas([]);
      setSelectedSchema("");
      setTables([]);
      setSelectedTables([]);
    }, [account, sfUser, password]);

    // Load schemas when database changes
    useEffect(() => {
      if (!connectionTested || !selectedDatabase) {
        setSchemas([]);
        setSelectedSchema("");
        setTables([]);
        setSelectedTables([]);
        return;
      }
      let cancelled = false;
      setLoadingSchemas(true);
      (async () => {
        try {
          const res = await dataClient.snowflakeListSchemas({ ...creds, database: selectedDatabase });
          if (!cancelled) setSchemas(res.schemas || []);
        } catch { if (!cancelled) setSchemas([]); }
        finally { if (!cancelled) setLoadingSchemas(false); }
      })();
      return () => { cancelled = true; };
    }, [connectionTested, selectedDatabase]);

    // Load tables when schema changes
    useEffect(() => {
      if (!connectionTested || !selectedDatabase || !selectedSchema) {
        setTables([]);
        setSelectedTables([]);
        return;
      }
      let cancelled = false;
      setLoadingTables(true);
      (async () => {
        try {
          const res = await dataClient.snowflakeListTables({ ...creds, database: selectedDatabase, schema: selectedSchema });
          if (!cancelled) {
            setTables(res.tables || []);
            setSelectedTables((res.tables || []).map((t) => t.id));
          }
        } catch { if (!cancelled) setTables([]); }
        finally { if (!cancelled) setLoadingTables(false); }
      })();
      return () => { cancelled = true; };
    }, [connectionTested, selectedDatabase, selectedSchema]);

    const handleTestConnection = async () => {
      if (!account.trim() || !sfUser.trim() || !password.trim()) return;
      setTestingConnection(true);
      try {
        await dataClient.snowflakeTestConnection(creds);
        setConnectionTested(true);
        toast.success(t('addSource.snowflakeConnectionSuccess'));
        // Load warehouses and databases in parallel
        setLoadingWarehouses(true);
        setLoadingDatabases(true);
        try {
          const [whRes, dbRes] = await Promise.all([
            dataClient.snowflakeListWarehouses(creds),
            dataClient.snowflakeListDatabases(creds),
          ]);
          setWarehouses(whRes.warehouses || []);
          setDatabases(dbRes.databases || []);
        } catch { /* ignore */ }
        finally {
          setLoadingWarehouses(false);
          setLoadingDatabases(false);
        }
      } catch (error) {
        setConnectionTested(false);
        toast.error(t('addSource.snowflakeConnectionFailed'), { description: error.message });
      } finally {
        setTestingConnection(false);
      }
    };

    const handleConnect = async () => {
      if (!canConnect) {
        toast.error(t('addSource.snowflakeFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const name = `Snowflake ${selectedDatabase}.${selectedSchema}`;
        const metadata = {
          account,
          user: sfUser,
          password,
          warehouse: selectedWarehouse,
          database: selectedDatabase,
          schema: selectedSchema,
          tables: selectedTables,
        };

        const source = await dataClient.createSource(name, 'snowflake', metadata, undefined);
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
          await dataClient.snowflakeRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.snowflakeConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('Snowflake connection error:', error);
        toast.error(t('addSource.snowflakeConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Snowflake</strong> — {t('addSource.snowflakeDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.snowflakeHint')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sf-account">{t('addSource.snowflakeAccount')}</Label>
            <Input
              id="sf-account"
              placeholder={t('addSource.snowflakeAccountPlaceholder')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={testingConnection}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sf-user">{t('addSource.snowflakeUser')}</Label>
            <Input
              id="sf-user"
              placeholder={t('addSource.snowflakeUserPlaceholder')}
              value={sfUser}
              onChange={(e) => setSfUser(e.target.value)}
              disabled={testingConnection}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sf-password">{t('addSource.snowflakePassword')}</Label>
            <Input
              id="sf-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={testingConnection}
            />
          </div>
        </div>

        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={!account.trim() || !sfUser.trim() || !password.trim() || testingConnection}
          className="w-full"
        >
          {testingConnection ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.snowflakeTestingConnection')}</>
          ) : connectionTested ? (
            <><CheckCircle className="h-4 w-4 mr-1 text-green-500" /> {t('addSource.snowflakeConnectionSuccess')}</>
          ) : (
            t('addSource.snowflakeTestConnection')
          )}
        </Button>

        {connectionTested && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('addSource.snowflakeWarehouse')}</Label>
              {loadingWarehouses ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.snowflakeLoadingWarehouses')}
                </p>
              ) : (
                <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('addSource.snowflakeSelectWarehouse')} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('addSource.snowflakeDatabase')}</Label>
              {loadingDatabases ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.snowflakeLoadingDatabases')}
                </p>
              ) : (
                <Select value={selectedDatabase} onValueChange={(v) => { setSelectedDatabase(v); setSelectedSchema(""); }}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('addSource.snowflakeSelectDatabase')} />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((db) => (
                      <SelectItem key={db.id} value={db.id}>{db.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}

        {connectionTested && selectedDatabase && (
          <div className="space-y-2">
            <Label>{t('addSource.snowflakeSchema')}</Label>
            {loadingSchemas ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.snowflakeLoadingSchemas')}
              </p>
            ) : (
              <Select value={selectedSchema} onValueChange={setSelectedSchema}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addSource.snowflakeSelectSchema')} />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {connectionTested && selectedDatabase && selectedSchema && !loadingTables && tables.length > 0 && (
          <div className="space-y-2">
            <Label>{t('addSource.snowflakeTables')}</Label>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-2">
              {tables.map((tbl) => {
                const isChecked = selectedTables.includes(tbl.id);
                return (
                  <label key={tbl.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        setSelectedTables((current) =>
                          e.target.checked
                            ? [...current, tbl.id]
                            : current.filter((t) => t !== tbl.id)
                        );
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-sm">{tbl.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('addSource.snowflakeSelectedTables', { count: selectedTables.length })}
            </p>
          </div>
        )}

        {loadingTables && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('addSource.snowflakeLoadingTables')}
          </p>
        )}
      </>
    );
  }
);
