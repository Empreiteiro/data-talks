import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface BigQuerySourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface BigQuerySourceFormHandle {
  connect: () => Promise<void>;
}

export const BigQuerySourceForm = forwardRef<BigQuerySourceFormHandle, BigQuerySourceFormProps>(
  function BigQuerySourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
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
      tables: '',
    });
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [loadingDatasets, setLoadingDatasets] = useState(false);
    const [loadingTables, setLoadingTables] = useState(false);
    const [availableProjects, setAvailableProjects] = useState<Array<{ id: string; name: string }>>([]);
    const [availableDatasets, setAvailableDatasets] = useState<Array<{ id: string; name: string }>>([]);
    const [availableTables, setAvailableTables] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedTable, setSelectedTable] = useState<string>("");

    const canConnect = !!bigQueryData.projectId && !!bigQueryData.datasetId && !!(bigQueryData.tables?.trim() || selectedTable);

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Fetch existing BigQuery credentials on mount
    useEffect(() => {
      (async () => {
        try {
          const sources = await dataClient.listSources();
          const bigquery = (sources || []).filter((s: { type: string }) => s.type === 'bigquery');
          setExistingCredentials(bigquery.map((s) => ({
            id: s.id,
            sourceName: s.name,
            credentialsContent: s.metaJSON?.credentialsContent,
            projectId: s.metaJSON?.projectId,
            datasetId: s.metaJSON?.datasetId,
            tables: s.metaJSON?.tables,
          })));
        } catch (error) {
          console.error('Error fetching existing credentials:', error);
        }
      })();
    }, []);

    // Load projects when credential is available
    useEffect(() => {
      let cancelled = false;
      async function load() {
        if (useExistingCredential && selectedCredential) {
          setLoadingProjects(true);
          try {
            const res = await dataClient.bigqueryListProjects({ sourceId: selectedCredential });
            if (!cancelled) setAvailableProjects(res.projects || []);
          } catch {
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
          } catch {
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
    }, [useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

    // Load datasets when project is selected
    useEffect(() => {
      if (!bigQueryData.projectId) {
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
        } catch {
          if (!cancelled) setAvailableDatasets([]);
        } finally {
          if (!cancelled) setLoadingDatasets(false);
        }
      })();
      return () => { cancelled = true; };
    }, [bigQueryData.projectId, useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

    // Load tables when dataset is selected
    useEffect(() => {
      if (!bigQueryData.projectId || !bigQueryData.datasetId) {
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
        } catch {
          if (!cancelled) setAvailableTables([]);
        } finally {
          if (!cancelled) setLoadingTables(false);
        }
      })();
      return () => { cancelled = true; };
    }, [bigQueryData.projectId, bigQueryData.datasetId, useExistingCredential, selectedCredential, bigQueryData.credentialsFile]);

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

    const handleConnect = async () => {
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
        try {
          await dataClient.refreshSourceBigQueryMetadata(source.id);
        } catch (_) {
          // non-blocking
        }

        toast.success('BigQuery conectado com sucesso!');
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('BigQuery connection error:', error);
        toast.error('Erro ao conectar BigQuery', { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
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
                    setBigQueryData({ ...bigQueryData, credentialsFile: null });
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
      </div>
    );
  }
);
