import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRef, useState } from "react";
import { BigQuerySourceForm, BigQuerySourceFormHandle } from "@/components/BigQuerySourceForm";
import { DbtSourceForm, DbtSourceFormHandle } from "@/components/DbtSourceForm";
import { GithubFileSourceForm, GithubFileSourceFormHandle } from "@/components/GithubFileSourceForm";
import { GoogleSheetsSourceForm, GoogleSheetsSourceFormHandle } from "@/components/GoogleSheetsSourceForm";
import { SqlSourceForm, SqlSourceFormHandle } from "@/components/SqlSourceForm";
import { UploadSourceForm } from "@/components/UploadSourceForm";

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
  agentId
}: AddSourceModalProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("upload");

  // Refs for imperative connect
  const bigQueryRef = useRef<BigQuerySourceFormHandle>(null);
  const sheetsRef = useRef<GoogleSheetsSourceFormHandle>(null);
  const sqlRef = useRef<SqlSourceFormHandle>(null);
  const dbtFormRef = useRef<DbtSourceFormHandle>(null);
  const githubFileFormRef = useRef<GithubFileSourceFormHandle>(null);

  // Per-tab connection state
  const [bigQueryCanConnect, setBigQueryCanConnect] = useState(false);
  const [bigQueryConnecting, setBigQueryConnecting] = useState(false);
  const [sheetsCanConnect, setSheetsCanConnect] = useState(false);
  const [sheetsConnecting, setSheetsConnecting] = useState(false);
  const [sqlCanConnect, setSqlCanConnect] = useState(false);
  const [sqlConnecting, setSqlConnecting] = useState(false);
  const [dbtCanConnect, setDbtCanConnect] = useState(false);
  const [dbtConnecting, setDbtConnecting] = useState(false);
  const [githubCanConnect, setGithubCanConnect] = useState(false);
  const [githubConnecting, setGithubConnecting] = useState(false);

  const onClose = () => onOpenChange(false);

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
              <TabsTrigger value="upload">{t('addSource.uploadTab')}</TabsTrigger>
              <TabsTrigger value="bigquery">{t('addSource.bigQueryTab')}</TabsTrigger>
              <TabsTrigger value="sheets">{t('addSource.sheetsTab')}</TabsTrigger>
              <TabsTrigger value="sql">{t('addSource.sqlTab')}</TabsTrigger>
              <TabsTrigger value="dbt">dbt</TabsTrigger>
              <TabsTrigger value="github_file">GitHub File</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <UploadSourceForm agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} />
            </TabsContent>

            <TabsContent value="bigquery" className="space-y-4">
              <BigQuerySourceForm ref={bigQueryRef} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setBigQueryCanConnect} onConnectingChange={setBigQueryConnecting} />
            </TabsContent>

            <TabsContent value="sheets" className="space-y-4">
              <GoogleSheetsSourceForm ref={sheetsRef} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setSheetsCanConnect} onConnectingChange={setSheetsConnecting} />
            </TabsContent>

            <TabsContent value="sql" className="space-y-4">
              <SqlSourceForm ref={sqlRef} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setSqlCanConnect} onConnectingChange={setSqlConnecting} />
            </TabsContent>

            <TabsContent value="dbt" className="space-y-4">
              <DbtSourceForm ref={dbtFormRef} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setDbtCanConnect} onConnectingChange={setDbtConnecting} />
            </TabsContent>

            <TabsContent value="github_file" className="space-y-4">
              <GithubFileSourceForm ref={githubFileFormRef} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setGithubCanConnect} onConnectingChange={setGithubConnecting} />
            </TabsContent>
          </Tabs>
        </div>

        {activeTab !== "upload" && (
          <div className="flex-shrink-0 pt-6 px-1 border-t">
            {activeTab === "bigquery" && (
              <Button className="w-full" onClick={() => bigQueryRef.current?.connect()} disabled={!bigQueryCanConnect || bigQueryConnecting}>
                {bigQueryConnecting ? t('addSource.connecting') : t('addSource.connectBigQuery')}
              </Button>
            )}
            {activeTab === "sheets" && (
              <Button className="w-full" onClick={() => sheetsRef.current?.connect()} disabled={!sheetsCanConnect || sheetsConnecting}>
                {sheetsConnecting ? t('addSource.connecting') : t('addSource.connectSheets')}
              </Button>
            )}
            {activeTab === "sql" && (
              <Button className="w-full" onClick={() => sqlRef.current?.connect()} disabled={!sqlCanConnect || sqlConnecting}>
                {sqlConnecting ? t('addSource.connecting') : t('addSource.sqlConnect')}
              </Button>
            )}
            {activeTab === "dbt" && (
              <Button className="w-full" onClick={() => dbtFormRef.current?.connect()} disabled={!dbtCanConnect || dbtConnecting}>
                {dbtConnecting ? t('addSource.connecting') : t('addSource.dbtConnect')}
              </Button>
            )}
            {activeTab === "github_file" && (
              <Button className="w-full" onClick={() => githubFileFormRef.current?.connect()} disabled={!githubCanConnect || githubConnecting}>
                {githubConnecting ? t('addSource.connecting') : t('addSource.githubConnect')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
