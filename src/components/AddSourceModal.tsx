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
import { dataClient } from "@/services/dataClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BigQuerySourceForm, BigQuerySourceFormHandle } from "@/components/BigQuerySourceForm";
import { ExcelOnlineSourceForm, ExcelOnlineSourceFormHandle } from "@/components/ExcelOnlineSourceForm";
import { DbtSourceForm, DbtSourceFormHandle } from "@/components/DbtSourceForm";
import { GithubFileSourceForm, GithubFileSourceFormHandle } from "@/components/GithubFileSourceForm";
import { GoogleSheetsSourceForm, GoogleSheetsSourceFormHandle } from "@/components/GoogleSheetsSourceForm";
import { FirebaseSourceForm, FirebaseSourceFormHandle } from "@/components/FirebaseSourceForm";
import { MongoDbSourceForm, MongoDbSourceFormHandle } from "@/components/MongoDbSourceForm";
import { RestApiSourceForm, RestApiSourceFormHandle } from "@/components/RestApiSourceForm";
import { S3SourceForm, S3SourceFormHandle } from "@/components/S3SourceForm";
import { NotionSourceForm, NotionSourceFormHandle } from "@/components/NotionSourceForm";
import { HubspotSourceForm, HubspotSourceFormHandle } from "@/components/HubspotSourceForm";
import { JiraSourceForm, JiraSourceFormHandle } from "@/components/JiraSourceForm";
import { StripeSourceForm, StripeSourceFormHandle } from "@/components/StripeSourceForm";
import { PipedriveSourceForm, PipedriveSourceFormHandle } from "@/components/PipedriveSourceForm";
import { SalesforceSourceForm, SalesforceSourceFormHandle } from "@/components/SalesforceSourceForm";
import { GA4SourceForm, GA4SourceFormHandle } from "@/components/GA4SourceForm";
import { IntercomSourceForm, IntercomSourceFormHandle } from "@/components/IntercomSourceForm";
import { GithubAnalyticsSourceForm, GithubAnalyticsSourceFormHandle } from "@/components/GithubAnalyticsSourceForm";
import { ShopifySourceForm, ShopifySourceFormHandle } from "@/components/ShopifySourceForm";
import { SnowflakeSourceForm, SnowflakeSourceFormHandle } from "@/components/SnowflakeSourceForm";
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
  { key: "existing",    label: "Existing Sources", connectLabelKey: "",                           hasConnect: false },
  { key: "upload",      label: "CSV / XLSX",      connectLabelKey: "",                           hasConnect: false },
  { key: "bigquery",    label: "BigQuery",         connectLabelKey: "addSource.connectBigQuery",  hasConnect: true },
  { key: "sheets",      label: "Google Sheets",    connectLabelKey: "addSource.connectSheets",    hasConnect: true },
  { key: "sql",         label: "SQL Database",     connectLabelKey: "addSource.sqlConnect",       hasConnect: true },
  { key: "firebase",    label: "Firebase / Firestore", connectLabelKey: "addSource.connectFirebase", hasConnect: true },
  { key: "dbt",         label: "dbt",              connectLabelKey: "addSource.dbtConnect",       hasConnect: true },
  { key: "github_file", label: "GitHub File",      connectLabelKey: "addSource.githubConnect",    hasConnect: true },
  { key: "mongodb",     label: "MongoDB",          connectLabelKey: "addSource.connectMongoDB",   hasConnect: true },
  { key: "snowflake",   label: "Snowflake",        connectLabelKey: "addSource.connectSnowflake", hasConnect: true },
  { key: "notion",      label: "Notion Database",  connectLabelKey: "addSource.connectNotion",    hasConnect: true },
  { key: "excel_online", label: "Excel Online",   connectLabelKey: "addSource.connectExcelOnline", hasConnect: true },
  { key: "s3",           label: "S3 / MinIO",     connectLabelKey: "addSource.connectS3",          hasConnect: true },
  { key: "rest_api",     label: "REST API",       connectLabelKey: "addSource.connectRestApi",     hasConnect: true },
  { key: "jira",          label: "Jira",           connectLabelKey: "addSource.connectJira",        hasConnect: true },
  { key: "hubspot",      label: "HubSpot CRM",   connectLabelKey: "addSource.connectHubspot",     hasConnect: true },
  { key: "stripe",        label: "Stripe",         connectLabelKey: "addSource.connectStripe",      hasConnect: true },
  { key: "pipedrive",    label: "Pipedrive CRM",  connectLabelKey: "addSource.connectPipedrive",  hasConnect: true },
  { key: "salesforce",  label: "Salesforce CRM", connectLabelKey: "addSource.connectSalesforce", hasConnect: true },
  { key: "ga4",         label: "Google Analytics 4", connectLabelKey: "addSource.connectGA4",    hasConnect: true },
  { key: "intercom",   label: "Intercom",          connectLabelKey: "addSource.connectIntercom", hasConnect: true },
  { key: "github_analytics", label: "GitHub Analytics", connectLabelKey: "addSource.connectGithubAnalytics", hasConnect: true },
  { key: "shopify",    label: "Shopify",           connectLabelKey: "addSource.connectShopify",          hasConnect: true },
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

  // Existing sources picker
  const [existingSources, setExistingSources] = useState<Array<{ id: string; name: string; type: string; agent_id?: string }>>([]);
  const [selectedExisting, setSelectedExisting] = useState<Set<string>>(new Set());
  const [addingExisting, setAddingExisting] = useState(false);

  useEffect(() => {
    if (!open || selectedType !== "existing") return;
    (async () => {
      try {
        const all = await dataClient.listSources();
        // Filter: show sources NOT in this workspace
        const currentSources = agentId ? await dataClient.listSources(agentId) : [];
        const currentIds = new Set(currentSources.map((s: { id: string }) => s.id));
        setExistingSources(all.filter((s: { id: string }) => !currentIds.has(s.id)));
        setSelectedExisting(new Set());
      } catch { /* silent */ }
    })();
  }, [open, selectedType, agentId]);

  const handleAddExistingSources = async () => {
    if (!agentId || selectedExisting.size === 0) return;
    setAddingExisting(true);
    try {
      await Promise.all(
        Array.from(selectedExisting).map((id) =>
          dataClient.updateSource(id, { agent_id: agentId, is_active: true })
        )
      );
      toast.success(`${selectedExisting.size} source(s) added`);
      onSourceAdded?.(Array.from(selectedExisting)[0]);
      onOpenChange(false);
    } catch {
      toast.error("Failed to add sources");
    } finally {
      setAddingExisting(false);
    }
  };

  const toggleExisting = (id: string) => {
    setSelectedExisting((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

          {selectedType === "existing" && (
            <div className="space-y-4">
              {existingSources.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No other sources available. Upload a new file instead.</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Select sources to add to this workspace:</p>
                  <ScrollArea className="max-h-[400px] border rounded-md">
                    <div className="p-2 space-y-1">
                      {existingSources.map((src) => (
                        <label
                          key={src.id}
                          className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedExisting.has(src.id)}
                            onCheckedChange={() => toggleExisting(src.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{src.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">({src.type})</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                  <Button onClick={handleAddExistingSources} disabled={addingExisting || selectedExisting.size === 0}>
                    {addingExisting ? "Adding..." : `Add ${selectedExisting.size} Source(s)`}
                  </Button>
                </>
              )}
            </div>
          )}

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

          {selectedType === "firebase" && (
            <div className="space-y-4">
              <FirebaseSourceForm ref={setRef("firebase")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("firebase")} onConnectingChange={setConnectingFor("firebase")} />
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

          {selectedType === "mongodb" && (
            <div className="space-y-4">
              <MongoDbSourceForm ref={setRef("mongodb")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("mongodb")} onConnectingChange={setConnectingFor("mongodb")} />
            </div>
          )}

          {selectedType === "snowflake" && (
            <div className="space-y-4">
              <SnowflakeSourceForm ref={setRef("snowflake")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("snowflake")} onConnectingChange={setConnectingFor("snowflake")} />
            </div>
          )}

          {selectedType === "notion" && (
            <div className="space-y-4">
              <NotionSourceForm ref={setRef("notion")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("notion")} onConnectingChange={setConnectingFor("notion")} />
            </div>
          )}

          {selectedType === "excel_online" && (
            <div className="space-y-4">
              <ExcelOnlineSourceForm ref={setRef("excel_online")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("excel_online")} onConnectingChange={setConnectingFor("excel_online")} />
            </div>
          )}

          {selectedType === "s3" && (
            <div className="space-y-4">
              <S3SourceForm ref={setRef("s3")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("s3")} onConnectingChange={setConnectingFor("s3")} />
            </div>
          )}

          {selectedType === "rest_api" && (
            <div className="space-y-4">
              <RestApiSourceForm ref={setRef("rest_api")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("rest_api")} onConnectingChange={setConnectingFor("rest_api")} />
            </div>
          )}

          {selectedType === "jira" && (
            <div className="space-y-4">
              <JiraSourceForm ref={setRef("jira")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("jira")} onConnectingChange={setConnectingFor("jira")} />
            </div>
          )}

          {selectedType === "hubspot" && (
            <div className="space-y-4">
              <HubspotSourceForm ref={setRef("hubspot")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("hubspot")} onConnectingChange={setConnectingFor("hubspot")} />
            </div>
          )}

          {selectedType === "stripe" && (
            <div className="space-y-4">
              <StripeSourceForm ref={setRef("stripe")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("stripe")} onConnectingChange={setConnectingFor("stripe")} />
            </div>
          )}

          {selectedType === "pipedrive" && (
            <div className="space-y-4">
              <PipedriveSourceForm ref={setRef("pipedrive")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("pipedrive")} onConnectingChange={setConnectingFor("pipedrive")} />
            </div>
          )}

          {selectedType === "salesforce" && (
            <div className="space-y-4">
              <SalesforceSourceForm ref={setRef("salesforce")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("salesforce")} onConnectingChange={setConnectingFor("salesforce")} />
            </div>
          )}

          {selectedType === "ga4" && (
            <div className="space-y-4">
              <GA4SourceForm ref={setRef("ga4")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("ga4")} onConnectingChange={setConnectingFor("ga4")} />
            </div>
          )}

          {selectedType === "intercom" && (
            <div className="space-y-4">
              <IntercomSourceForm ref={setRef("intercom")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("intercom")} onConnectingChange={setConnectingFor("intercom")} />
            </div>
          )}

          {selectedType === "github_analytics" && (
            <div className="space-y-4">
              <GithubAnalyticsSourceForm ref={setRef("github_analytics")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("github_analytics")} onConnectingChange={setConnectingFor("github_analytics")} />
            </div>
          )}

          {selectedType === "shopify" && (
            <div className="space-y-4">
              <ShopifySourceForm ref={setRef("shopify")} agentId={agentId} onSourceAdded={onSourceAdded} onClose={onClose} onCanConnectChange={setCanConnectFor("shopify")} onConnectingChange={setConnectingFor("shopify")} />
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
