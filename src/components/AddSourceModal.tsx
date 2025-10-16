import { useState, useEffect } from "react";
import { Upload, Link as LinkIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  }>>([]);
  const [useExistingCredential, setUseExistingCredential] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<string>("");
  const [bigQueryData, setBigQueryData] = useState({
    credentialsFile: null as File | null,
    projectId: '',
    datasetId: '',
    tables: ''
  });

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
        langflowName: source.langflow_name!,
        sourceName: source.name
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

    setConnecting(true);
    try {
      let langflowPath = null;
      let langflowName = null;
      let credentialsJson = '';

      if (useExistingCredential) {
        // Use existing credential
        const selectedCred = existingCredentials.find(c => c.langflowPath === selectedCredential);
        if (selectedCred) {
          langflowPath = selectedCred.langflowPath;
          langflowName = selectedCred.langflowName;
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
            console.log('Credentials uploaded to Langflow:', { path: langflowPath, name: langflowName });
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
          tables: bigQueryData.tables ? bigQueryData.tables.split(',').map(t => t.trim()) : [],
          langflowPath: langflowPath,
          langflowName: langflowName
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
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addSource.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
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
                      <Select value={selectedCredential} onValueChange={setSelectedCredential}>
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
                      onChange={(e) => setBigQueryData({
                        ...bigQueryData,
                        credentialsFile: e.target.files?.[0] || null
                      })}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="project">{t('addSource.project')}</Label>
                  <Input 
                    id="project" 
                    placeholder={t('addSource.projectPlaceholder')}
                    value={bigQueryData.projectId}
                    onChange={(e) => setBigQueryData({
                      ...bigQueryData,
                      projectId: e.target.value
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset">{t('addSource.dataset')}</Label>
                  <Input 
                    id="dataset" 
                    placeholder={t('addSource.datasetPlaceholder')}
                    value={bigQueryData.datasetId}
                    onChange={(e) => setBigQueryData({
                      ...bigQueryData,
                      datasetId: e.target.value
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tables">{t('addSource.allowedTables')}</Label>
                  <Input 
                    id="tables" 
                    placeholder={t('addSource.tablesPlaceholder')}
                    value={bigQueryData.tables}
                    onChange={(e) => setBigQueryData({
                      ...bigQueryData,
                      tables: e.target.value
                    })}
                  />
                </div>
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