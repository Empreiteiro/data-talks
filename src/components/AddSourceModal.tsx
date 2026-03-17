import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCallback, useRef, useState } from "react";
import { BigQuerySourceForm, BigQuerySourceFormHandle } from "@/components/BigQuerySourceForm";
import { DbtSourceForm, DbtSourceFormHandle } from "@/components/DbtSourceForm";
import { GithubFileSourceForm, GithubFileSourceFormHandle } from "@/components/GithubFileSourceForm";
import { GoogleSheetsSourceForm, GoogleSheetsSourceFormHandle } from "@/components/GoogleSheetsSourceForm";
import { SqlSourceForm, SqlSourceFormHandle } from "@/components/SqlSourceForm";
import { UploadSourceForm } from "@/components/UploadSourceForm";

type ConnectableHandle = { connect(): Promise<void> };

interface SourceTab {
  key: string;
  labelKey: string;
  connectLabelKey: string;
  hasConnect: boolean;
}

const SOURCE_TABS: SourceTab[] = [
  { key: "upload",      labelKey: "addSource.uploadTab",    connectLabelKey: "",                        hasConnect: false },
  { key: "bigquery",    labelKey: "addSource.bigQueryTab",  connectLabelKey: "addSource.connectBigQuery", hasConnect: true },
  { key: "sheets",      labelKey: "addSource.sheetsTab",    connectLabelKey: "addSource.connectSheets",   hasConnect: true },
  { key: "sql",         labelKey: "addSource.sqlTab",       connectLabelKey: "addSource.sqlConnect",      hasConnect: true },
  { key: "dbt",         labelKey: "dbt",                    connectLabelKey: "addSource.dbtConnect",      hasConnect: true },
  { key: "github_file", labelKey: "GitHub File",            connectLabelKey: "addSource.githubConnect",   hasConnect: true },
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
  const [activeTab, setActiveTab] = useState("upload");

  // Single ref map for all connectable forms
  const refs = useRef<Record<string, ConnectableHandle | null>>({});

  // Per-tab connection state tracked in a single object
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

  const activeConfig = SOURCE_TABS.find((tab) => tab.key === activeTab);
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

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              {SOURCE_TABS.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.labelKey.startsWith("addSource.") ? t(tab.labelKey) : tab.labelKey}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <UploadSourceForm agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} />
            </TabsContent>

            <TabsContent value="bigquery" className="space-y-4">
              <BigQuerySourceForm ref={setRef("bigquery")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("bigquery")} onConnectingChange={setConnectingFor("bigquery")} />
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <GoogleSheetsSourceForm ref={setRef("sheets")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("sheets")} onConnectingChange={setConnectingFor("sheets")} />
            </TabsContent>

            <TabsContent value="sql" className="space-y-4">
              <SqlSourceForm ref={setRef("sql")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("sql")} onConnectingChange={setConnectingFor("sql")} />
            </TabsContent>

            <TabsContent value="dbt" className="space-y-4">
              <DbtSourceForm ref={setRef("dbt")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("dbt")} onConnectingChange={setConnectingFor("dbt")} />
            </TabsContent>

            <TabsContent value="github_file" className="space-y-4">
              <GithubFileSourceForm ref={setRef("github_file")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("github_file")} onConnectingChange={setConnectingFor("github_file")} />
            </TabsContent>
          </Tabs>
        </div>

        {showFooter && activeConfig && (
          <div className="flex-shrink-0 pt-6 px-1 border-t">
            <Button
              className="w-full"
              onClick={() => refs.current[activeTab]?.connect()}
              disabled={!canConnect[activeTab] || connecting[activeTab]}
            >
              {connecting[activeTab]
                ? t('addSource.connecting')
                : t(activeConfig.connectLabelKey)}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
