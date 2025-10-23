import { useState, useEffect } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabaseClient } from "@/services/supabaseClient";
import { supabase } from "@/integrations/supabase/client";
interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSourceAdded?: (sourceId: string) => void;
}
export function AddSourceModal({
  open,
  onOpenChange,
  onSourceAdded
}: AddSourceModalProps) {
  const {
    t
  } = useLanguage();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [existingCredentials, setExistingCredentials] = useState<Array<{
    langflowPath: string;
    langflowName: string;
    sourceName: string;
    metadata?: any;
    supabaseStoragePath?: string;
    credentialsContent?: string;
  }>>([]);
  const [useExistingCredential, setUseExistingCredential] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<string>("");
  const [bigQueryData, setBigQueryData] = useState({
    credentialsFile: null as File | null,
    projectId: '',
    datasetId: '',
    tables: ''
  });

  // New state for progressive selection
  const [availableProjects, setAvailableProjects] = useState<Array<{id: string, name: string}>>([]);
  const [availableDatasets, setAvailableDatasets] = useState<Array<{id: string, name: string}>>([]);
  const [availableTables, setAvailableTables] = useState<Array<{id: string, name: string, type: string}>>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);

  // Fetch existing BigQuery credentials when modal opens
  useEffect(() => {
    if (open) {
      fetchExistingCredentials();
    }
  }, [open]);

  const fetchExistingCredentials = async () => {
    try {
      const { data: sources, error } = await supabase
        .from('sources')
        .select('name, langflow_path, langflow_name, metadata')
        .eq('type', 'bigquery')
        .not('langflow_path', 'is', null);

      if (error) throw error;

      const credentials = sources?.map(source => ({
        langflowPath: source.langflow_path!,
        langflowName: source.langflow_name || source.langflow_path!.split('/').pop()!,
        sourceName: source.langflow_name || source.langflow_path!.split('/').pop()!.replace('.json', ''),
        metadata: source.metadata,
        supabaseStoragePath: (source.metadata as any)?.supabase_storage_path,
        credentialsContent: (source.metadata as any)?.credentials_content
      })) || [];

      // Remove duplicates based on langflowPath
      const uniqueCredentials = credentials.filter((cred, index, self) =>
        index === self.findIndex((c) => c.langflowPath === cred.langflowPath)
      );

      setExistingCredentials(uniqueCredentials);
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
      const uploadPromises = files.map(file => supabaseClient.uploadFile(file));
      const results = await Promise.all(uploadPromises);
      
      console.log('Upload results:', results);
      
      toast.success(t('addSource.filesUploaded'));
      
      // Passar o ID da primeira fonte criada (workspace suporta apenas 1 fonte por vez)
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

  const listBigQueryResources = async (
    action: 'projects' | 'datasets' | 'tables',
    options: {
      credentials?: string;
      supabaseStoragePath?: string;
      credentialsContent?: string;
      projectId?: string;
      datasetId?: string;
    } = {}
  ) => {
    try {
      const { data, error } = await supabase.functions.invoke('list-bigquery-resources', {
        body: {
          action,
          ...options,
        }
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error(`Error listing ${action}:`, error);
      toast.error(`Erro ao buscar ${action}`, {
        description: error.message
      });
      throw error;
    }
  };

  const handleCredentialsUpload = async (file: File) => {
    setLoadingProjects(true);
    setAvailableProjects([]);
    setAvailableDatasets([]);
    setAvailableTables([]);
    setBigQueryData({ ...bigQueryData, credentialsFile: file, projectId: '', datasetId: '' });
    setSelectedTable("");

    try {
      const credentialsText = await file.text();
      const data = await listBigQueryResources('projects', { credentials: credentialsText });
      setAvailableProjects(data.projects || []);
      
      if (data.projects?.length === 1) {
        // Auto-select if only one project
        setBigQueryData(prev => ({ ...prev, projectId: data.projects[0].id }));
        handleProjectSelect(data.projects[0].id, credentialsText);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleExistingCredentialSelect = async (langflowPath: string) => {
    setSelectedCredential(langflowPath);
    setLoadingProjects(true);
    setAvailableProjects([]);
    setAvailableDatasets([]);
    setAvailableTables([]);
    setBigQueryData({ ...bigQueryData, projectId: '', datasetId: '' });
    setSelectedTable("");

    try {
      const selectedCred = existingCredentials.find(c => c.langflowPath === langflowPath);
      if (!selectedCred) return;

      const data = await listBigQueryResources('projects', {
        supabaseStoragePath: selectedCred.supabaseStoragePath,
        credentialsContent: selectedCred.credentialsContent,
      });
      
      setAvailableProjects(data.projects || []);
      
      if (data.projects?.length === 1) {
        setBigQueryData(prev => ({ ...prev, projectId: data.projects[0].id }));
        handleProjectSelect(data.projects[0].id, undefined, selectedCred);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleProjectSelect = async (
    projectId: string, 
    credentials?: string,
    selectedCred?: any
  ) => {
    setBigQueryData(prev => ({ ...prev, projectId, datasetId: '' }));
    setAvailableDatasets([]);
    setAvailableTables([]);
    setSelectedTable("");
    setLoadingDatasets(true);

    try {
      const options: any = { projectId };
      
      if (credentials) {
        options.credentials = credentials;
      } else if (selectedCred) {
        options.supabaseStoragePath = selectedCred.supabaseStoragePath;
        options.credentialsContent = selectedCred.credentialsContent;
      } else if (bigQueryData.credentialsFile) {
        options.credentials = await bigQueryData.credentialsFile.text();
      }

      const data = await listBigQueryResources('datasets', options);
      setAvailableDatasets(data.datasets || []);
    } catch (error) {
      console.error('Error loading datasets:', error);
    } finally {
      setLoadingDatasets(false);
    }
  };

  const handleDatasetSelect = async (datasetId: string) => {
    setBigQueryData(prev => ({ ...prev, datasetId }));
    setAvailableTables([]);
    setSelectedTable("");
    setLoadingTables(true);

    try {
      const options: any = { 
        projectId: bigQueryData.projectId, 
        datasetId 
      };

      if (useExistingCredential) {
        const selectedCred = existingCredentials.find(c => c.langflowPath === selectedCredential);
        if (selectedCred) {
          options.supabaseStoragePath = selectedCred.supabaseStoragePath;
          options.credentialsContent = selectedCred.credentialsContent;
        }
      } else if (bigQueryData.credentialsFile) {
        options.credentials = await bigQueryData.credentialsFile.text();
      }

      const data = await listBigQueryResources('tables', options);
      setAvailableTables(data.tables || []);
    } catch (error) {
      console.error('Error loading tables:', error);
    } finally {
      setLoadingTables(false);
    }
  };

  const handleTableSelect = (tableId: string) => {
    setSelectedTable(tableId);
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
      toast.error('Por favor, preencha todos os campos obrigatórios');
      return;
    }

    if (!selectedTable) {
      toast.error('Por favor, selecione uma tabela');
      return;
    }

    setConnecting(true);
    try {
      let langflowPath = null;
      let langflowName = null;
      let supabaseStoragePath = null;
      let credentialsContent = null;
      let credentialsJson = '';

      if (useExistingCredential) {
        // Use existing credential
        const selectedCred = existingCredentials.find(c => c.langflowPath === selectedCredential);
        if (selectedCred) {
          langflowPath = selectedCred.langflowPath;
          langflowName = selectedCred.langflowName;
          supabaseStoragePath = selectedCred.supabaseStoragePath;
          credentialsContent = selectedCred.credentialsContent;
          // We don't need the actual credentials JSON when reusing
          credentialsJson = '';
        }
      } else {
        // Upload new credential
        credentialsJson = await bigQueryData.credentialsFile!.text();

        try {
          const formData = new FormData();
          formData.append('file', bigQueryData.credentialsFile!);
          
          const { data: langflowData, error: langflowError } = await supabase.functions.invoke(
            'upload-to-langflow',
            {
              body: formData,
            }
          );

          if (langflowError) {
            console.error('Langflow upload error:', langflowError);
          } else if (langflowData) {
            langflowPath = langflowData.path;
            langflowName = langflowData.name;
            supabaseStoragePath = langflowData.supabaseStoragePath;
            credentialsContent = langflowData.credentialsContent;
            console.log('Credentials uploaded to Langflow:', { 
              path: langflowPath, 
              name: langflowName,
              supabaseStoragePath,
              hasCredentialsContent: !!credentialsContent
            });
          }
        } catch (error) {
          console.error('Error uploading to Langflow:', error);
          // Continue with connection even if Langflow upload fails
        }
      }

      // Call BigQuery connect edge function with Langflow info
      const { data, error } = await supabase.functions.invoke('bigquery-connect', {
        body: {
          credentials: credentialsJson,
          projectId: bigQueryData.projectId,
          datasetId: bigQueryData.datasetId,
          tables: [selectedTable],
          langflowPath: langflowPath,
          langflowName: langflowName,
          supabaseStoragePath: supabaseStoragePath,
          credentialsContent: credentialsContent
        }
      });

      if (error) throw error;

      toast.success('BigQuery conectado com sucesso!');
      
      if (data?.sourceId) {
        onSourceAdded?.(data.sourceId);
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('BigQuery connection error:', error);
      toast.error('Erro ao conectar BigQuery', {
        description: error.message
      });
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
            {t('addSource.description')} {t('addSource.examples')}
          </p>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">{t('addSource.uploadTab')}</TabsTrigger>
              <TabsTrigger value="bigquery">{t('addSource.bigQueryTab')}</TabsTrigger>
              <TabsTrigger value="sheets" disabled className="cursor-not-allowed opacity-50">{t('addSource.sheetsTab')}</TabsTrigger>
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
                            <SelectItem key={cred.langflowPath} value={cred.langflowPath}>
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
                        Buscando projetos disponíveis...
                      </p>
                    )}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="project">{t('addSource.project')}</Label>
                  <Select 
                    value={bigQueryData.projectId} 
                    onValueChange={(value) => handleProjectSelect(value)}
                    disabled={availableProjects.length === 0 || loadingProjects}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={availableProjects.length === 0 ? "Carregue credenciais primeiro" : "Selecione um projeto"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {loadingDatasets && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Buscando datasets...
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dataset">{t('addSource.dataset')}</Label>
                  <Select 
                    value={bigQueryData.datasetId} 
                    onValueChange={handleDatasetSelect}
                    disabled={!bigQueryData.projectId || availableDatasets.length === 0 || loadingDatasets}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={!bigQueryData.projectId ? "Selecione um projeto primeiro" : availableDatasets.length === 0 ? "Nenhum dataset encontrado" : "Selecione um dataset"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDatasets.map((dataset) => (
                        <SelectItem key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {loadingTables && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Buscando tabelas...
                    </p>
                  )}
                </div>

                {availableTables.length > 0 && (
                  <div className="space-y-2">
                    <Label>{t('addSource.selectTable')}</Label>
                    <Select 
                      value={selectedTable} 
                      onValueChange={handleTableSelect}
                      disabled={!bigQueryData.datasetId || availableTables.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione uma tabela" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTables.map((table) => (
                          <SelectItem key={table.id} value={table.id}>
                            {table.name} <span className="text-muted-foreground">({table.type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button 
                  className="w-full" 
                  onClick={handleBigQueryConnect}
                  disabled={connecting}
                >
                  {connecting ? 'Conectando...' : t('addSource.connectBigQuery')}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sheets-url">{t('addSource.sheetsUrl')}</Label>
                  <div className="flex gap-2">
                    <Input id="sheets-url" placeholder={t('addSource.sheetsUrlPlaceholder')} className="flex-1" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('addSource.sheetsDescription')}
                </p>
                <Button className="w-full">{t('addSource.connectSheets')}</Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="pt-4 border-t">
            
          </div>
        </div>
      </DialogContent>
    </Dialog>;
}