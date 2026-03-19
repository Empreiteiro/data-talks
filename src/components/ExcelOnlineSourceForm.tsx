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
import { Loader2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface ExcelOnlineSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface ExcelOnlineSourceFormHandle {
  connect: () => Promise<void>;
}

export const ExcelOnlineSourceForm = forwardRef<ExcelOnlineSourceFormHandle, ExcelOnlineSourceFormProps>(
  function ExcelOnlineSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [connecting, setConnecting] = useState(false);
    const [accessToken, setAccessToken] = useState("");

    const [files, setFiles] = useState<Array<{ id: string; name: string; driveId: string }>>([]);
    const [selectedFile, setSelectedFile] = useState("");
    const [loadingFiles, setLoadingFiles] = useState(false);

    const [sheets, setSheets] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedSheet, setSelectedSheet] = useState("");
    const [loadingSheets, setLoadingSheets] = useState(false);

    const canConnect = !!accessToken && !!selectedFile && !!selectedSheet;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    const handleLoadFiles = async () => {
      if (!accessToken.trim()) return;
      setLoadingFiles(true);
      setFiles([]);
      setSelectedFile("");
      setSheets([]);
      setSelectedSheet("");
      try {
        const res = await dataClient.excelOnlineListFiles({ accessToken });
        setFiles((res.files || []).map((f) => ({
          id: f.id,
          name: f.name,
          driveId: f.driveId,
        })));
      } catch (error) {
        toast.error(t('addSource.excelOnlineListError'), { description: error.message });
      } finally {
        setLoadingFiles(false);
      }
    };

    // Load sheets when file is selected
    useEffect(() => {
      if (!accessToken || !selectedFile) {
        setSheets([]);
        setSelectedSheet("");
        return;
      }
      const file = files.find((f) => f.id === selectedFile);
      if (!file) return;

      let cancelled = false;
      setLoadingSheets(true);
      (async () => {
        try {
          const res = await dataClient.excelOnlineListSheets({
            accessToken,
            driveId: file.driveId,
            itemId: file.id,
          });
          if (!cancelled) setSheets(res.sheets || []);
        } catch {
          if (!cancelled) setSheets([]);
        } finally {
          if (!cancelled) setLoadingSheets(false);
        }
      })();
      return () => { cancelled = true; };
    }, [accessToken, selectedFile]);

    const handleConnect = async () => {
      if (!canConnect) {
        toast.error(t('addSource.excelOnlineFillFields'));
        return;
      }

      setConnecting(true);
      try {
        const file = files.find((f) => f.id === selectedFile);
        const sheetObj = sheets.find((s) => s.id === selectedSheet || s.name === selectedSheet);
        const fileName = file?.name || "Excel";
        const sheetName = sheetObj?.name || selectedSheet;
        const name = `Excel Online: ${fileName} - ${sheetName}`;
        const metadata = {
          accessToken,
          driveId: file?.driveId || "",
          itemId: selectedFile,
          fileName,
          sheetName,
        };

        const source = await dataClient.createSource(name, 'excel_online', metadata, undefined);
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
          await dataClient.excelOnlineRefreshMetadata(source.id);
        } catch { /* non-blocking */ }

        toast.success(t('addSource.excelOnlineConnectSuccess'));
        onSourceAdded?.(source.id);
        onClose();
      } catch (error) {
        console.error('Excel Online connection error:', error);
        toast.error(t('addSource.excelOnlineConnectError'), { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
      <>
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <p className="text-sm">
            <strong>Excel Online</strong> — {t('addSource.excelOnlineDescription')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addSource.excelOnlineHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="excel-online-token">{t('addSource.excelOnlineToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="excel-online-token"
              type="password"
              placeholder={t('addSource.excelOnlineTokenPlaceholder')}
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
                setFiles([]);
                setSelectedFile("");
                setSheets([]);
                setSelectedSheet("");
              }}
              disabled={loadingFiles}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleLoadFiles}
              disabled={!accessToken.trim() || loadingFiles}
              className="shrink-0"
            >
              {loadingFiles ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {t('addSource.excelOnlineLoadingFiles')}</>
              ) : (
                t('addSource.excelOnlineListFiles')
              )}
            </Button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <Label>{t('addSource.excelOnlineFile')}</Label>
            <Select value={selectedFile} onValueChange={(v) => { setSelectedFile(v); setSelectedSheet(""); }}>
              <SelectTrigger>
                <SelectValue placeholder={t('addSource.excelOnlineSelectFile')} />
              </SelectTrigger>
              <SelectContent>
                {files.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedFile && (
          <div className="space-y-2">
            <Label>{t('addSource.excelOnlineSheet')}</Label>
            {loadingSheets ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('addSource.excelOnlineLoadingSheets')}
              </p>
            ) : sheets.length > 0 ? (
              <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addSource.excelOnlineSelectSheet')} />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">{t('addSource.excelOnlineNoSheets')}</p>
            )}
          </div>
        )}
      </>
    );
  }
);
