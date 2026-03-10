import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { getConnectionStringLabel } from "@/lib/utils";
import { dataClient } from "@/services/dataClient";
import { Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSourceAdded?: (sourceId: string) => void;
  agentId?: string;
}
export function AddSourceModal({
  open,
  onOpenChange,
  onSourceAdded,
  agentId
}: AddSourceModalProps) {
  const {
    t
  } = useLanguage();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [existingCredentials, setExistingCredentials] = useState<Array<{
    id: string;
    sourceName: string;
    credentialsContent?: string;
    projectId?: string;
    datasetId?: string;
    tables?: string[];
  }>>([]);
  const [useExistingCredential, setUseExistingCredential] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<string>("");
  const [bigQueryData, setBigQueryData] = useState({
    credentialsFile: null as File | null,
    projectId: '',
    datasetId: '',
    tables: ''  // comma-separated table names, stored locally
  });
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<Array<{id: string, name: string}>>([]);
  const [availableDatasets, setAvailableDatasets] = useState<Array<{id: string, name: string}>>([]);
  const [availableTables, setAvailableTables] = useState<Array<{id: string, name: string}>>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");

  // Google Sheets state
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Array<{title: string, sheetId: number}>>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [spreadsheetData, setSpreadsheetData] = useState<{id: string, title: string} | null>(null);
  const [sheetsServiceEmail, setSheetsServiceEmail] = useState<string | null | undefined>(undefined);

  // SQL Database state
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
  const [availableSqlTables, setAvailableSqlTables] = useState<Array<{id: string; name: string; columns?: string[]}>>([]);
  const [loadingSqlTables, setLoadingSqlTables] = useState(false);

  // Fetch existing BigQuery credentials and Google Sheets service email when modal opens
  useEffect(() => {
    if (open) {
      fetchExistingCredentials();
      setAvailableProjects([]);
      setAvailableDatasets([]);
      setAvailableTables([]);
      setAvailableSqlTables([]);
      setSelectedSqlTables([]);
      setUseExistingSqlCredential(false);
      setSelectedSqlCredential("");
      setSqlConnectionString("");
      setSqlDatabaseType("");
      setSheetsServiceEmail(undefined);
      dataClient.getGoogleSheetsServiceEmail()
        .then((email) => setSheetsServiceEmail(email ?? null))
        .catch(() => setSheetsServiceEmail(null));
    }
  }, [open]);

  // Load projects when credential is available (existing or from file)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      if (useExistingCredential && selectedCredential) {
        setLoadingProjects(true);
        try {
          const res = await dataClient.bigqueryListProjects({ sourceId: selectedCredential });
          if (!cancelled) setAvailableProjects(res.projects || []);
        } catch (e) {
          if (!cancelled) setAvailableProjects([]);
        } finally {
          if (!cancelled) setLoadingProjects(false);
        }
        return;
      }
      if (!useExistingCredential && bigQueryData.credentialsFile) {
        setLoadingProjects(true);
        try {
          const credentialsContent = await bigQueryData.credentialsFile.text();
          const res = await dataClient.bigqueryListProjects({ credentialsContent });
          if (!cancelled) setAvailableProjects(res.projects || []);
        } catch (e) {
          if (!cancelled) setAvailableProjects([]);
        } finally {
          if (!cancelled) setLoadingProjects(false);
        }
      } else {
        setAvailableProjects([]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

  // Load datasets when project is selected
  useEffect(() => {
    if (!open || !bigQueryData.projectId) {
      setAvailableDatasets([]);
      return;
    }
    let cancelled = false;
    setLoadingDatasets(true);
    (async () => {
      try {
        const body = useExistingCredential && selectedCredential
          ? { sourceId: selectedCredential, projectId: bigQueryData.projectId }
          : { credentialsContent: bigQueryData.credentialsFile ? await bigQueryData.credentialsFile.text() : '', projectId: bigQueryData.projectId };
        const res = await dataClient.bigqueryListDatasets(body);
        if (!cancelled) setAvailableDatasets(res.datasets || []);
      } catch (e) {
        if (!cancelled) setAvailableDatasets([]);
      } finally {
        if (!cancelled) setLoadingDatasets(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, bigQueryData.projectId, useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

  // Load tables when dataset is selected
  useEffect(() => {
    if (!open || !bigQueryData.projectId || !bigQueryData.datasetId) {
      setAvailableTables([]);
      return;
    }
    let cancelled = false;
    setLoadingTables(true);
    (async () => {
      try {
        const body = useExistingCredential && selectedCredential
          ? { sourceId: selectedCredential, projectId: bigQueryData.projectId, datasetId: bigQueryData.datasetId }
          : { credentialsContent: bigQueryData.credentialsFile ? await bigQueryData.credentialsFile.text() : '', projectId: bigQueryData.projectId, datasetId: bigQueryData.datasetId };
        const res = await dataClient.bigqueryListTables(body);
        if (!cancelled) setAvailableTables(res.tables || []);
      } catch (e) {
        if (!cancelled) setAvailableTables([]);
      } finally {
        if (!cancelled) setLoadingTables(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, bigQueryData.projectId, bigQueryData.datasetId, useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

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

  const fetchExistingCredentials = async () => {
    try {
      const sources = await dataClient.listSources();
      const bigquery = (sources || []).filter((s: { type: string }) => s.type === 'bigquery');
      const credentials = bigquery.map((s: { id: string; name: string; metaJSON?: any }) => ({
        id: s.id,
        sourceName: s.name,
        credentialsContent: s.metaJSON?.credentialsContent,
        projectId: s.metaJSON?.projectId,
        datasetId: s.metaJSON?.datasetId,
        tables: s.metaJSON?.tables,
      }));
      setExistingCredentials(credentials);
      const sqlSources = (sources || [])
        .filter((s: { type: string; metaJSON?: any }) => s.type === 'sql_database' && s.metaJSON?.connectionString);
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
          const merged = new Map<string, any>();
          [...existing.tableInfos, ...tableInfos].forEach((t) => merged.set(t.table, t));
          existing.tableInfos = Array.from(merged.values());
        }
      }
      const sqlCredentials = Array.from(byConn.values()).map((c) => ({
        id: c.id,
        connectionLabel: getConnectionStringLabel(c.connectionString),
        connectionString: c.connectionString,
        databaseType: c.databaseType,
        tableInfos: c.tableInfos,
      }));
      setExistingSqlCredentials(sqlCredentials);
    } catch (error) {
      console.error('Error fetching existing credentials:', error);
    }
  };
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFiles(files);
    }
  };
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await handleFiles(files);
    }
  };
  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try {
      const uploadPromises = files.map(file => dataClient.uploadFile(file));
      const results = await Promise.all(uploadPromises);
      
      console.log('Upload results:', results);
      
      // Se estiver dentro de um workspace, associar as fontes ao agent via API
      if (agentId && results.length > 0) {
        try {
          const newIds = results.map((r) => r?.id).filter(Boolean) as string[];
          const existingSources = await dataClient.listSources(agentId);
          // Desativar fontes já existentes do agent
          await Promise.all(
            existingSources.map((s) => dataClient.updateSource(s.id, { is_active: false }))
          );
          // Associar e ativar a primeira nova fonte; demais ficam inativas
          for (let i = 0; i < newIds.length; i++) {
            await dataClient.updateSource(newIds[i], {
              agent_id: agentId,
              is_active: i === 0,
            });
          }
        } catch (err) {
          console.error('Error associating source to agent:', err);
        }
      }

      toast.success(t('addSource.filesUploaded'));

      if (results.length > 0 && results[0]?.id) {
        onSourceAdded?.(results[0].id);
      } else {
        onSourceAdded?.('');
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(t('addSource.uploadError'), {
        description: error.message
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCredentialsUpload = (file: File) => {
    setBigQueryData(prev => ({ ...prev, credentialsFile: file, projectId: '', datasetId: '', tables: '' }));
  };

  const handleExistingCredentialSelect = (credId: string) => {
    setSelectedCredential(credId);
    const selectedCred = existingCredentials.find(c => c.id === credId);
    if (selectedCred) {
      const tablesArr = Array.isArray(selectedCred.tables) ? selectedCred.tables : [];
      const tablesStr = tablesArr.join(', ');
      setSelectedTable(tablesArr[0] || '');
      setBigQueryData(prev => ({
        ...prev,
        projectId: selectedCred.projectId || '',
        datasetId: selectedCred.datasetId || '',
        tables: tablesStr,
      }));
    }
  };

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

  const handleBigQueryConnect = async () => {
    if (!useExistingCredential && !bigQueryData.credentialsFile) {
      toast.error('Por favor, selecione ou envie uma credencial');
      return;
    }
    if (useExistingCredential && !selectedCredential) {
      toast.error('Por favor, selecione uma credencial existente');
      return;
    }
    if (!bigQueryData.projectId || !bigQueryData.datasetId) {
      toast.error('Por favor, selecione o projeto e o dataset');
      return;
    }

    setConnecting(true);
    try {
      let credentialsContent: string | undefined;
      if (useExistingCredential) {
        const selectedCred = existingCredentials.find(c => c.id === selectedCredential);
        credentialsContent = selectedCred?.credentialsContent;
      } else {
        credentialsContent = await bigQueryData.credentialsFile!.text();
      }
      if (!credentialsContent) {
        toast.error('Credenciais não disponíveis');
        return;
      }

      const tablesList = bigQueryData.tables
        ? bigQueryData.tables.split(',').map(s => s.trim()).filter(Boolean)
        : selectedTable ? [selectedTable] : [];
      if (tablesList.length === 0) {
        toast.error('Por favor, selecione pelo menos uma tabela');
        setConnecting(false);
        return;
      }
      const name = `BigQuery ${bigQueryData.projectId}/${bigQueryData.datasetId}`;
      const metadata = {
        credentialsContent,
        projectId: bigQueryData.projectId,
        datasetId: bigQueryData.datasetId,
        tables: tablesList,
      };

      // Create source without agent_id first so it is saved for reuse in credentials list
      const source = await dataClient.createSource(name, 'bigquery', metadata, undefined);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources
            .filter((s: { id: string; type: string }) => s.id !== source.id && s.type !== 'sql_database')
            .map((s: { id: string }) => dataClient.updateSource(s.id, { is_active: false }))
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
      }
      // Refresh metadata (table_infos with columns and preview) so workspace and preview show columns
      try {
        await dataClient.refreshSourceBigQueryMetadata(source.id);
      } catch (_) {
        // non-blocking
      }

      toast.success('BigQuery conectado com sucesso!');
      onSourceAdded?.(source.id);
      onOpenChange(false);
    } catch (error: any) {
      console.error('BigQuery connection error:', error);
      toast.error('Erro ao conectar BigQuery', { description: error.message });
    } finally {
      setConnecting(false);
    }
  };

  const handleSheetsConnect = async () => {
    const spreadsheetId = sheetsUrl.trim() || spreadsheetData?.id;
    if (!spreadsheetId || !selectedSheet) {
      toast.error('Por favor, insira o ID da planilha e o nome da aba');
      return;
    }

    setConnecting(true);
    try {
      const name = `Google Sheets ${spreadsheetId}`;
      const metadata = { spreadsheetId, sheetName: selectedSheet };
      const source = await dataClient.createSource(name, 'google_sheets', metadata, agentId);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources.filter((s: { id: string }) => s.id !== source.id).map((s: { id: string }) =>
            dataClient.updateSource(s.id, { is_active: false })
          )
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
      }
      toast.success('Google Sheets conectado com sucesso!');
      onSourceAdded?.(source.id);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Google Sheets connection error:', error);
      toast.error('Erro ao conectar Google Sheets', { description: error.message });
    } finally {
      setConnecting(false);
    }
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
    } catch (error: any) {
      console.error('SQL table discovery error:', error);
      setAvailableSqlTables([]);
      setSelectedSqlTables([]);
      toast.error(t('addSource.sqlListError'), { description: error.message });
    } finally {
      setLoadingSqlTables(false);
    }
  };

  const handleSqlConnect = async () => {
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
      onOpenChange(false);
    } catch (error: any) {
      console.error('SQL database connection error:', error);
      toast.error(t('addSource.sqlConnectError'), { description: error.message });
    } finally {
      setConnecting(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t('addSource.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 px-1">
          <p className="text-sm text-muted-foreground">
            {t('addSource.description')}
          </p>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="upload">{t('addSource.uploadTab')}</TabsTrigger>
              <TabsTrigger value="bigquery">{t('addSource.bigQueryTab')}</TabsTrigger>
              <TabsTrigger value="sheets">{t('addSource.sheetsTab')}</TabsTrigger>
              <TabsTrigger value="sql">{t('addSource.sqlTab')}</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
                <Upload className="h-12 w-12 mx-auto mb-4 text-primary" />
                <h3 className="text-lg font-medium mb-2">{t('addSource.uploadTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t('addSource.dragDrop')}{" "}
                  <label htmlFor="file-upload" className="text-primary cursor-pointer hover:underline">
                    {t('addSource.chooseFile')}
                  </label>{" "}
                  {t('addSource.uploadText')}
                </p>
                
                <input id="file-upload" type="file" className="hidden" multiple accept=".csv,.xlsx,.xls" onChange={handleFileInput} disabled={uploading} />
              </div>
            </TabsContent>

            <TabsContent value="bigquery" className="space-y-4">
              <div className="space-y-4">
                {existingCredentials.length > 0 && (
                  <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="use-existing"
                        checked={useExistingCredential}
                        onChange={(e) => {
                          setUseExistingCredential(e.target.checked);
                          if (e.target.checked) {
                            setBigQueryData({...bigQueryData, credentialsFile: null});
                          } else {
                            setSelectedCredential("");
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor="use-existing" className="cursor-pointer font-medium">
                        {t('sources.useExistingCredential')}
                      </Label>
                    </div>
                    
                    {useExistingCredential && (
                      <Select value={selectedCredential} onValueChange={handleExistingCredentialSelect}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t('sources.selectCredential')} />
                        </SelectTrigger>
                        <SelectContent>
                          {existingCredentials.map((cred) => (
                            <SelectItem key={cred.id} value={cred.id}>
                              {cred.sourceName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                
                {!useExistingCredential && (
                  <div className="space-y-2">
                    <Label htmlFor="credentials">{t('addSource.credentials')}</Label>
                    <Input 
                      id="credentials" 
                      type="file" 
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCredentialsUpload(file);
                      }}
                      disabled={loadingProjects}
                    />
                    {loadingProjects && (
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('addSource.loadingProjects')}
                      </p>
                    )}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label>{t('addSource.project')}</Label>
                  <Select
                    value={bigQueryData.projectId || undefined}
                    onValueChange={(v) => setBigQueryData(prev => ({ ...prev, projectId: v || '', datasetId: '', tables: '' }))}
                    disabled={loadingProjects || (availableProjects.length === 0 && !bigQueryData.projectId)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingProjects ? t('addSource.loadingProjects') : t('addSource.projectPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('addSource.dataset')}</Label>
                  <Select
                    value={bigQueryData.datasetId || undefined}
                    onValueChange={(v) => {
                      setSelectedTable('');
                      setBigQueryData(prev => ({ ...prev, datasetId: v || '', tables: '' }));
                    }}
                    disabled={loadingDatasets || !bigQueryData.projectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingDatasets ? t('addSource.loadingDatasets') : t('addSource.datasetPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDatasets.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('addSource.allowedTables')}</Label>
                  <Select
                    value={selectedTable || bigQueryData.tables || undefined}
                    onValueChange={(v) => {
                      setSelectedTable(v || '');
                      setBigQueryData(prev => ({ ...prev, tables: v || '' }));
                    }}
                    disabled={loadingTables || !bigQueryData.datasetId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingTables ? t('addSource.loadingTables') : t('addSource.tablesPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTables.map((tbl) => (
                        <SelectItem key={tbl.id} value={tbl.id}>{tbl.name || tbl.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleBigQueryConnect}
                  disabled={connecting || !bigQueryData.projectId || !bigQueryData.datasetId || (!bigQueryData.tables?.trim() && !selectedTable)}
                >
                  {connecting ? t('addSource.connecting') : t('addSource.connectBigQuery')}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <div className="space-y-4">
                {sheetsServiceEmail === undefined ? (
                  <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                    <p className="text-sm text-muted-foreground">{t('addSource.sheetsLoadingEmail')}</p>
                  </div>
                ) : sheetsServiceEmail ? (
                  <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                    <p className="text-sm">
                      <strong>{t('addSource.sheetsImportant')}</strong> {t('addSource.sheetsShareWith')}
                    </p>
                    <code className="block bg-background px-3 py-2 rounded text-xs border break-all">
                      {sheetsServiceEmail}
                    </code>
                  </div>
                ) : (
                  <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                    <p className="text-sm text-amber-600 dark:text-amber-500">
                      {t('addSource.sheetsNotConfigured')}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="sheets-id">{t('addSource.sheetsId')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('addSource.sheetsIdExample')}
                  </p>
                  <Input 
                    id="sheets-id" 
                    placeholder={t('addSource.sheetsIdPlaceholder')}
                    value={sheetsUrl}
                    onChange={(e) => setSheetsUrl(e.target.value.trim())}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sheet-name">{t('addSource.selectSheet')}</Label>
                  <Input
                    id="sheet-name"
                    placeholder="Sheet1"
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('addSource.sheetsDescription')}
                </p>
                <Button 
                  className="w-full"
                  onClick={handleSheetsConnect}
                  disabled={!sheetsUrl.trim() || !selectedSheet || connecting}
                >
                  {connecting ? t('addSource.connecting') : t('addSource.connectSheets')}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sql" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                  <p className="text-sm">
                    <strong>{t('addSource.sqlImportant')}</strong> {t('addSource.sqlSecurityWarning')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('addSource.sqlSelfHostedNote')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sql-type">{t('addSource.sqlDatabaseType')}</Label>
                  <Select 
                    value={sqlDatabaseType} 
                    onValueChange={(value: any) => {
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

                {existingSqlCredentials.length > 0 && (
                  <div className="space-y-4 p-6 bg-muted/30 rounded-lg border">
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
                  <Label htmlFor="sql-connection">{t('addSource.sqlConnectionString')}</Label>
                  <Input 
                    id="sql-connection" 
                    type="password"
                    placeholder={t('addSource.sqlConnectionStringPlaceholder')}
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
                  <p className="text-xs text-muted-foreground">
                    {t('addSource.sqlExample')}: {sqlDatabaseType === 'mysql' ? 'mysql://user:password@host:3306/database' : 'postgresql://user:password@host:5432/database'}
                  </p>
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

                <Button 
                  className="w-full"
                  onClick={handleSqlConnect}
                  disabled={!getCurrentSqlConnectionString() || !sqlDatabaseType || selectedSqlTables.length === 0 || connecting || loadingSqlTables}
                >
                  {connecting ? t('addSource.connecting') : t('addSource.sqlConnect')}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="pt-4 border-t">
            
          </div>
        </div>
      </DialogContent>
    </Dialog>;
}