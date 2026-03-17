import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

interface GoogleSheetsSourceFormProps {
  agentId?: string;
  onSourceAdded?: (sourceId: string) => void;
  onClose: () => void;
  onCanConnectChange?: (v: boolean) => void;
  onConnectingChange?: (v: boolean) => void;
}

export interface GoogleSheetsSourceFormHandle {
  connect: () => Promise<void>;
}

export const GoogleSheetsSourceForm = forwardRef<GoogleSheetsSourceFormHandle, GoogleSheetsSourceFormProps>(
  function GoogleSheetsSourceForm({ agentId, onSourceAdded, onClose, onCanConnectChange, onConnectingChange }, ref) {
    const { t } = useLanguage();
    const [sheetsUrl, setSheetsUrl] = useState("");
    const [selectedSheet, setSelectedSheet] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [sheetsServiceEmail, setSheetsServiceEmail] = useState<string | null | undefined>(undefined);

    const canConnect = !!sheetsUrl.trim() && !!selectedSheet;

    useEffect(() => { onCanConnectChange?.(canConnect); }, [canConnect]);
    useEffect(() => { onConnectingChange?.(connecting); }, [connecting]);

    // Fetch service email on mount
    useEffect(() => {
      dataClient.getGoogleSheetsServiceEmail()
        .then((email) => setSheetsServiceEmail(email ?? null))
        .catch(() => setSheetsServiceEmail(null));
    }, []);

    const handleConnect = async () => {
      const spreadsheetId = sheetsUrl.trim();
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
        onClose();
      } catch (error) {
        console.error('Google Sheets connection error:', error);
        toast.error('Erro ao conectar Google Sheets', { description: error.message });
      } finally {
        setConnecting(false);
      }
    };

    useImperativeHandle(ref, () => ({ connect: handleConnect }));

    return (
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
      </div>
    );
  }
);
