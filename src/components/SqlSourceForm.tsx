import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { getConnectionStringLabel } from "@/lib/utils";
import { dataClient } from "@/services/dataClient";
import { Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface SqlSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface SqlSourceFormHandle {
  connect: () => Promise<void>;
}

export const SqlSourceForm = forwardRef<SqlSourceFormHandle, SqlSourceFormProps>(
  function SqlSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [existingSqlCredentials, setExistingSqlCredentials] = useState<Array<{
      id: string;
      connectionLabel: string;
      connectionString?: string;
      databaseType?: 'postgresql' | 'mysql' | '';
      tableInfos?: Array<{ table: string; columns?: string[] }>;
    }>>([]);
    const [useExistingSqlCredential, setUseExistingSqlCredential] = useState(false);
    const [selectedSqlCredential, setSelectedSqlCredential] = useState<string>("");
    const [sqlConnectionString, setSqlConnectionString] = useState("");
    const [sqlDatabaseType, setSqlDatabaseType] = useState<'postgresql' | 'mysql' | ''>('');
    const [selectedSqlTables, setSelectedSqlTables] = useState<string[]>([]);
    const [availableSqlTables, setAvailableSqlTables] = useState<Array<{ id: string; name: string; columns?: string[] }>>([]);
    const [loadingSqlTables, setLoadingSqlTables] = useState(false);

    const inferSqlDatabaseType = (connectionString?: string): 'postgresql' | 'mysql' | '' => {
      const normalized = (connectionString || '').trim().toLowerCase();
      if (normalized.startsWith('postgresql://') || normalized.startsWith('postgres://')) return 'postgresql';
      if (normalized.startsWith('mysql://')) return 'mysql';
      return '';
    };

    const getCurrentSqlConnectionString = () => {
      if (useExistingSqlCredential && selectedSqlCredential) {
        const existing = existingSqlCredentials.find((credential) => credential.id === selectedSqlCredential);
        return existing?.connectionString?.trim() || '';
      }
      return sqlConnectionString.trim();
    };

    const canConnect = !!getCurrentSqlConnectionString() && !!sqlDatabaseType && selectedSqlTables.length > 0;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect, sqlDatabaseType, selectedSqlTables.length, useExistingSqlCredential, selectedSqlCredential, sqlConnectionString]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Fetch existing SQL credentials on mount
    useEffect(() => {
      (async () => {
        try {
          const sources = await dataClient.listSources();
          const sqlSources = (sources || [])
            .filter((s) => s.type === 'sql_database' && s.metaJSON?.connectionString);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const byConn = new Map<string, { id: string; connectionString: string; databaseType: string; tableInfos: any[] }>();
          for (const s of sqlSources) {
            const conn = String(s.metaJSON?.connectionString || '').trim();
            const existing = byConn.get(conn);
            const tableInfos = Array.isArray(s.metaJSON?.table_infos) ? s.metaJSON.table_infos : [];
            if (!existing) {
              byConn.set(conn, {
                id: s.id,
                connectionString: conn,
                databaseType: s.metaJSON?.databaseType || inferSqlDatabaseType(conn),
                tableInfos: [...tableInfos],
              });
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const merged = new Map<string, any>();
              [...existing.tableInfos, ...tableInfos].forEach((ti) => merged.set(ti.table, ti));
              existing.tableInfos = Array.from(merged.values());
            }
          }
          setExistingSqlCredentials(Array.from(byConn.values()).map((c) => ({
            id: c.id,
            connectionLabel: getConnectionStringLabel(c.connectionString),
            connectionString: c.connectionString,
            databaseType: c.databaseType,
            tableInfos: c.tableInfos,
          })));
        } catch (error) {
          console.error('Error fetching existing SQL credentials:', error);
        }
      })();
    }, []);

    const handleExistingSqlCredentialSelect = (credentialId: string) => {
      setSelectedSqlCredential(credentialId);
      const selectedCredential = existingSqlCredentials.find((credential) => credential.id === credentialId);
      const inferredType = selectedCredential?.databaseType || inferSqlDatabaseType(selectedCredential?.connectionString);
      const credentialTables = (selectedCredential?.tableInfos || []).map((table) => ({
        id: table.table,
        name: table.table,
        columns: table.columns || [],
      }));

      setSqlDatabaseType(inferredType);
      setAvailableSqlTables(credentialTables);
      setSelectedSqlTables(credentialTables.map((table) => table.id));
    };

    const handleSqlDiscoverTables = async () => {
      const connectionString = getCurrentSqlConnectionString();
      if (!connectionString) {
        toast.error(t('addSource.sqlFillFields'));
        return;
      }

      setLoadingSqlTables(true);
      try {
        const res = await dataClient.sqlListTables({ connectionString });
        const tables = res.tables || [];
        setAvailableSqlTables(tables);
        if (tables.length === 0) {
          setSelectedSqlTables([]);
          toast.error(t('addSource.sqlNoTablesFound'));
          return;
        }
        setSelectedSqlTables((current) => current.filter((tableId) => tables.some((table) => table.id === tableId)));
      } catch (error) {
        console.error('SQL table discovery error:', error);
        setAvailableSqlTables([]);
        setSelectedSqlTables([]);
        toast.error(t('addSource.sqlListError'), { description: error.message });
      } finally {
        setLoadingSqlTables(false);
      }
    };

    const handleConnect = async () => {
      const connectionString = getCurrentSqlConnectionString();
      if (!connectionString || !sqlDatabaseType || selectedSqlTables.length === 0) {
        toast.error(t('addSource.sqlFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const selectedTableInfos = selectedSqlTables
          .map((tableId) => availableSqlTables.find((table) => table.id === tableId))
          .filter(Boolean)
          .map((table) => ({
            table: table!.id,
            columns: (table!.columns || []).filter(Boolean),
          }));
        if (selectedTableInfos.length === 0) {
          toast.error(t('addSource.sqlFillFields'));
          return;
        }

        const createdSources = await Promise.all(
          selectedTableInfos.map((tableInfo) => {
            const metadata = {
              connectionString,
              databaseType: sqlDatabaseType,
              availableColumns: tableInfo.columns,
              table_infos: [tableInfo],
            };
            return dataClient.createSource(`SQL ${tableInfo.table}`, 'sql_database', metadata, agentId);
          })
        );

        if (agentId && createdSources.length > 0) {
          const existingSources = await dataClient.listSources(agentId);
          await Promise.all(
            existingSources.filter((s: { id: string; type: string }) => s.type !== 'sql_database').map((s: { id: string }) =>
              dataClient.updateSource(s.id, { is_active: false })
            )
          );
          await Promise.all(
            createdSources.map((source) =>
              dataClient.updateSource(source.id, { agent_id: agentId, is_active: true })
            )
          );
        }
        toast.success(t('addSource.sqlConnectSuccess'));
        onSourceAdded?.(createdSources[0]?.id || '');
        onClose();
      } catch (error) {
        console.error('SQL database connection error:', error);
        toast.error(t('addSource.sqlConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <div className="space-y-4">
        {existingSqlCredentials.length > 0 && (
          <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="use-existing-sql"
                checked={useExistingSqlCredential}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUseExistingSqlCredential(checked);
                  setAvailableSqlTables([]);
                  setSelectedSqlTables([]);
                  if (!checked) {
                    setSelectedSqlCredential("");
                    setSqlConnectionString("");
                    setSqlDatabaseType("");
                  }
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="use-existing-sql" className="cursor-pointer font-medium">
                {t('addSource.sqlUseExistingCredential')}
              </Label>
            </div>

            {useExistingSqlCredential && (
              <Select value={selectedSqlCredential} onValueChange={handleExistingSqlCredentialSelect}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('addSource.sqlSelectCredential')} />
                </SelectTrigger>
                <SelectContent>
                  {existingSqlCredentials.map((credential) => (
                    <SelectItem key={credential.id} value={credential.id}>
                      {credential.connectionLabel || credential.connectionString?.slice(0, 30)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {!useExistingSqlCredential && (
          <div className="space-y-2">
            <Label htmlFor="sql-type">{t('addSource.sqlDatabaseType')}</Label>
            <Select
              value={sqlDatabaseType}
              onValueChange={(value) => {
                setSqlDatabaseType(value);
                setAvailableSqlTables([]);
                setSelectedSqlTables([]);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('addSource.sqlSelectType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {!useExistingSqlCredential && (
          <div className="space-y-2">
            <Label htmlFor="sql-connection">{t('addSource.sqlConnectionString')}</Label>
            <Input
              id="sql-connection"
              type="password"
              placeholder={sqlDatabaseType === 'mysql' ? 'mysql://user:password@host:3306/database' : 'postgresql://user:password@host:5432/database'}
              value={sqlConnectionString}
              onChange={(e) => {
                setSqlConnectionString(e.target.value);
                setAvailableSqlTables([]);
                setSelectedSqlTables([]);
                if (!sqlDatabaseType) {
                  setSqlDatabaseType(inferSqlDatabaseType(e.target.value));
                }
              }}
            />
          </div>
        )}

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleSqlDiscoverTables}
            disabled={!getCurrentSqlConnectionString() || loadingSqlTables || connecting}
          >
            {loadingSqlTables ? <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('addSource.loadingTables')}
            </> : t('addSource.listButton')}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sql-table">{t('addSource.sqlSelectedTables')}</Label>
          <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-2">
            {availableSqlTables.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2 py-1">
                {loadingSqlTables ? t('addSource.loadingTables') : t('addSource.sqlLoadTablesFirst')}
              </p>
            ) : (
              availableSqlTables.map((table) => {
                const isChecked = selectedSqlTables.includes(table.id);
                return (
                  <label key={table.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        setSelectedSqlTables((current) => (
                          e.target.checked
                            ? [...current, table.id]
                            : current.filter((tableId) => tableId !== table.id)
                        ));
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{table.name}</span>
                      {table.columns && table.columns.length > 0 && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {table.columns.join(', ')}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {selectedSqlTables.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('addSource.sqlSelectedTablesCount', { count: selectedSqlTables.length })}
            </p>
          )}
        </div>
      </div>
    );
  }
);
