import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/supabaseClient";
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
  const [availableProjects, setAvailableProjects] = useState<Array<{id: string, name: string}>>([]);
  const [availableDatasets, setAvailableDatasets] = useState<Array<{id: string, name: string}>>([]);
  const [availableTables, setAvailableTables] = useState<Array<{id: string, name: string, type: string}>>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");

  // Google Sheets state
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Array<{title: string, sheetId: number}>>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [spreadsheetData, setSpreadsheetData] = useState<{id: string, title: string} | null>(null);

  // SQL Database state
  const [sqlConnectionString, setSqlConnectionString] = useState("");
  const [sqlDatabaseType, setSqlDatabaseType] = useState<'postgresql' | 'mysql' | ''>('');
  const [sqlTableName, setSqlTableName] = useState("");

  // Fetch existing BigQuery credentials when modal opens
  useEffect(() => {
    if (open) {
      fetchExistingCredentials();
    }
  }, [open]);

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
      setBigQueryData(prev => ({
        ...prev,
        projectId: selectedCred.projectId || '',
        datasetId: selectedCred.datasetId || '',
        tables: Array.isArray(selectedCred.tables) ? selectedCred.tables.join(', ') : '',
      }));
    }
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
      toast.error('Por favor, preencha Project ID e Dataset ID');
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
        : [];
      const name = `BigQuery ${bigQueryData.projectId}/${bigQueryData.datasetId}`;
      const metadata = {
        credentialsContent,
        projectId: bigQueryData.projectId,
        datasetId: bigQueryData.datasetId,
        tables: tablesList,
      };

      const source = await dataClient.createSource(name, 'bigquery', metadata, agentId);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources.filter((s: { id: string }) => s.id !== source.id).map((s: { id: string }) =>
            dataClient.updateSource(s.id, { is_active: false })
          )
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
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

  const handleSqlConnect = async () => {
    if (!sqlConnectionString || !sqlDatabaseType || !sqlTableName) {
      toast.error(t('addSource.sqlFillFields'));
      return;
    }

    setConnecting(true);
    try {
      const name = `SQL ${sqlTableName}`;
      const metadata = {
        connectionString: sqlConnectionString,
        table_infos: [{ table: sqlTableName }],
      };
      const source = await dataClient.createSource(name, 'sql_database', metadata, agentId);
      if (agentId && source?.id) {
        const existingSources = await dataClient.listSources(agentId);
        await Promise.all(
          existingSources.filter((s: { id: string }) => s.id !== source.id).map((s: { id: string }) =>
            dataClient.updateSource(s.id, { is_active: false })
          )
        );
        await dataClient.updateSource(source.id, { agent_id: agentId, is_active: true });
      }
      toast.success(t('addSource.sqlConnectSuccess'));
      onSourceAdded?.(source.id);
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
                  <Label htmlFor="project">{t('addSource.project')}</Label>
                  <Input
                    id="project"
                    placeholder={t('addSource.projectPlaceholder')}
                    value={bigQueryData.projectId}
                    onChange={(e) => setBigQueryData(prev => ({ ...prev, projectId: e.target.value.trim() }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dataset">{t('addSource.dataset')}</Label>
                  <Input
                    id="dataset"
                    placeholder={t('addSource.datasetPlaceholder')}
                    value={bigQueryData.datasetId}
                    onChange={(e) => setBigQueryData(prev => ({ ...prev, datasetId: e.target.value.trim() }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tables">{t('addSource.allowedTables')}</Label>
                  <Input
                    id="tables"
                    placeholder={t('addSource.tablesPlaceholder')}
                    value={bigQueryData.tables}
                    onChange={(e) => setBigQueryData(prev => ({ ...prev, tables: e.target.value }))}
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleBigQueryConnect}
                  disabled={connecting}
                >
                  {connecting ? t('addSource.connecting') : t('addSource.connectBigQuery')}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-4 p-6 bg-muted/30 rounded-lg border mb-6 mt-6">
                  <p className="text-sm">
                    <strong>{t('addSource.sheetsImportant')}</strong> {t('addSource.sheetsShareWith')}
                  </p>
                  <code className="block bg-background px-3 py-2 rounded text-xs border">
                    talk-2-data@talk-2-data.iam.gserviceaccount.com
                  </code>
                </div>

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
                  <ul className="text-xs space-y-1 ml-4 list-disc">
                    <li>{t('addSource.sqlIpAgent')}: <code className="bg-background px-2 py-1 rounded text-xs border">34.121.141.105</code></li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sql-type">{t('addSource.sqlDatabaseType')}</Label>
                  <Select 
                    value={sqlDatabaseType} 
                    onValueChange={(value: any) => setSqlDatabaseType(value)}
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

                <div className="space-y-2">
                  <Label htmlFor="sql-connection">{t('addSource.sqlConnectionString')}</Label>
                  <Input 
                    id="sql-connection" 
                    type="password"
                    placeholder={t('addSource.sqlConnectionStringPlaceholder')}
                    value={sqlConnectionString}
                    onChange={(e) => setSqlConnectionString(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('addSource.sqlExample')}: {sqlDatabaseType === 'mysql' ? 'mysql://user:password@host:3306/database' : 'postgresql://user:password@host:5432/database'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sql-table">{t('addSource.sqlTableName')}</Label>
                  <Input 
                    id="sql-table" 
                    type="text"
                    placeholder={t('addSource.sqlTableNamePlaceholder')}
                    value={sqlTableName}
                    onChange={(e) => setSqlTableName(e.target.value)}
                  />
                </div>

                <Button 
                  className="w-full"
                  onClick={handleSqlConnect}
                  disabled={!sqlConnectionString || !sqlDatabaseType || !sqlTableName || connecting}
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