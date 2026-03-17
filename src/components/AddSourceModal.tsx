import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCallback, useRef, useState } from "react";
import { BigQuerySourceForm, BigQuerySourceFormHandle } from "@/components/BigQuerySourceForm";
import { DbtSourceForm, DbtSourceFormHandle } from "@/components/DbtSourceForm";
import { GithubFileSourceForm, GithubFileSourceFormHandle } from "@/components/GithubFileSourceForm";
import { GoogleSheetsSourceForm, GoogleSheetsSourceFormHandle } from "@/components/GoogleSheetsSourceForm";
import { SqlSourceForm, SqlSourceFormHandle } from "@/components/SqlSourceForm";
import { UploadSourceForm } from "@/components/UploadSourceForm";

type ConnectableHandle = { connect(): Promise<void> };

interface SourceOption {
  key: string;
  label: string;
  connectLabelKey: string;
  hasConnect: boolean;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { key: "upload",      label: "CSV / XLSX",      connectLabelKey: "",                           hasConnect: false },
  { key: "bigquery",    label: "BigQuery",         connectLabelKey: "addSource.connectBigQuery",  hasConnect: true },
  { key: "sheets",      label: "Google Sheets",    connectLabelKey: "addSource.connectSheets",    hasConnect: true },
  { key: "sql",         label: "SQL Database",     connectLabelKey: "addSource.sqlConnect",       hasConnect: true },
  { key: "dbt",         label: "dbt",              connectLabelKey: "addSource.dbtConnect",       hasConnect: true },
  { key: "github_file", label: "GitHub File",      connectLabelKey: "addSource.githubConnect",    hasConnect: true },
];

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
  agentId,
}: AddSourceModalProps) {
  const { t } = useLanguage();
  const [selectedType, setSelectedType] = useState<string>("");

  const refs = useRef<Record<string, ConnectableHandle | null>>({});
  const [canConnect, setCanConnect] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<Record<string, boolean>>({});

  const setRef = useCallback(
    (key: string) => (handle: ConnectableHandle | null) => {
      refs.current[key] = handle;
    },
    [],
  );

  const setCanConnectFor = useCallback(
    (key: string) => (v: boolean) =>
      setCanConnect((prev) => ({ ...prev, [key]: v })),
    [],
  );

  const setConnectingFor = useCallback(
    (key: string) => (v: boolean) =>
      setConnecting((prev) => ({ ...prev, [key]: v })),
    [],
  );

  const onClose = () => onOpenChange(false);

  const activeConfig = SOURCE_OPTIONS.find((o) => o.key === selectedType);
  const showFooter = activeConfig?.hasConnect;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] h-[780px] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t('addSource.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-6 px-1">
          <p className="text-sm text-muted-foreground">
            {t('addSource.description')}
          </p>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t('addSource.sourceType')}</label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('addSource.selectSourceType')} />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedType === "upload" && (
            <div className="space-y-4">
              <UploadSourceForm agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} />
            </div>
          )}

          {selectedType === "bigquery" && (
            <div className="space-y-4">
              <BigQuerySourceForm ref={setRef("bigquery")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("bigquery")} onConnectingChange={setConnectingFor("bigquery")} />
            </div>
          )}

          {selectedType === "sheets" && (
            <div className="space-y-4">
              <GoogleSheetsSourceForm ref={setRef("sheets")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("sheets")} onConnectingChange={setConnectingFor("sheets")} />
            </div>
          )}

          {selectedType === "sql" && (
            <div className="space-y-4">
              <SqlSourceForm ref={setRef("sql")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("sql")} onConnectingChange={setConnectingFor("sql")} />
            </div>
          )}

          {selectedType === "dbt" && (
            <div className="space-y-4">
              <DbtSourceForm ref={setRef("dbt")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("dbt")} onConnectingChange={setConnectingFor("dbt")} />
            </div>
          )}

          {selectedType === "github_file" && (
            <div className="space-y-4">
              <GithubFileSourceForm ref={setRef("github_file")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("github_file")} onConnectingChange={setConnectingFor("github_file")} />
            </div>
          )}
        </div>

        {showFooter && activeConfig && (
          <div className="flex-shrink-0 pt-6 px-1 border-t">
            <Button
              className="w-full"
              onClick={() => refs.current[selectedType]?.connect()}
              disabled={!canConnect[selectedType] || connecting[selectedType]}
            >
              {connecting[selectedType]
                ? t('addSource.connecting')
                : t(activeConfig.connectLabelKey)}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
