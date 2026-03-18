import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface UploadSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
}

export function UploadSourceForm({ agentId, onSourceAdded, onClose }: UploadSourceFormProps) {
  const { t } = useLanguage();
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

      onClose();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(t('addSource.uploadError'), {
        description: error.message
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <Upload className="h-12 w-12 mx-auto mb-4 text-primary" />
      <h3 className="text-lg font-medium mb-2">{t('addSource.uploadTitle')}</h3>
      <p className="text-sm text-muted-foreground mb-4">
        {t('addSource.dragDrop')}{" "}
        <label htmlFor="file-upload" className="text-primary cursor-pointer hover:underline">
          {t('addSource.chooseFile')}
        </label>{" "}
        {t('addSource.uploadText')}
      </p>

      <input id="file-upload" type="file" className="hidden" multiple accept=".csv,.xlsx,.xls,.db,.sqlite,.sqlite3,.parquet,.json,.jsonl" onChange={handleFileInput} disabled={uploading} />
    </div>
  );
}
