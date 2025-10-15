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
interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSourceAdded?: () => void;
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
      onSourceAdded?.();
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
  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('addSource.title')}</span>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {t('addSource.description')} {t('addSource.examples')}
          </p>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">{t('addSource.uploadTab')}</TabsTrigger>
              <TabsTrigger value="bigquery">{t('addSource.bigQueryTab')}</TabsTrigger>
              <TabsTrigger value="sheets">{t('addSource.sheetsTab')}</TabsTrigger>
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
                  <Input id="credentials" type="file" accept=".json" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project">{t('addSource.project')}</Label>
                  <Input id="project" placeholder={t('addSource.projectPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset">{t('addSource.dataset')}</Label>
                  <Input id="dataset" placeholder={t('addSource.datasetPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tables">{t('addSource.allowedTables')}</Label>
                  <Input id="tables" placeholder={t('addSource.tablesPlaceholder')} />
                </div>
                <Button className="w-full">{t('addSource.connectBigQuery')}</Button>
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