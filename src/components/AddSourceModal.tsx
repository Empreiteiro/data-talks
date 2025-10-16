import { useState } from "react";
import { Upload, Link as LinkIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const [bigQueryData, setBigQueryData] = useState({
    credentialsFile: null as File | null,
    projectId: '',
    datasetId: '',
    tables: ''
  });
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
    if (!bigQueryData.credentialsFile || !bigQueryData.projectId || !bigQueryData.datasetId) {
      toast.error('Por favor, preencha todos os campos obrigatórios');
      return;
    }

    setConnecting(true);
    try {
      // Read credentials file
      const credentialsText = await bigQueryData.credentialsFile.text();
      const credentials = JSON.parse(credentialsText);

      // Call BigQuery connect edge function
      const { data, error } = await supabase.functions.invoke('bigquery-connect', {
        body: {
          credentials,
          projectId: bigQueryData.projectId,
          datasetId: bigQueryData.datasetId,
          tables: bigQueryData.tables ? bigQueryData.tables.split(',').map(t => t.trim()) : []
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