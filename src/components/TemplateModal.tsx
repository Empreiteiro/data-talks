import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/services/apiClient";
import { ChartRenderer, type ChartSpec } from "@/components/ChartRenderer";
import { TemplateCustomizeDialog } from "@/components/TemplateCustomizeDialog";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageCircle, Play, Settings2 } from "lucide-react";

interface TemplateDef {
  id: string;
  name: string;
  sourceType: string;
  description: string;
  queries: Array<{ id: string; title: string; sql: string; chart_type: string; chart_config: Record<string, unknown> }>;
  layout: string;
  refreshInterval: number;
  isBuiltin: boolean;
  queryCount: number;
}

interface TemplateResult {
  queryId: string;
  title: string;
  rows: Record<string, unknown>[];
  chartSpec: ChartSpec | null;
  error: string | null;
}

interface TemplateRunResult {
  runId: string;
  templateId: string;
  templateName: string;
  status: string;
  results: TemplateResult[];
  durationMs: number | null;
  createdAt: string;
}

interface TemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onUseInChat?: (question: string) => void;
}

export function TemplateModal({ open, onOpenChange, workspaceId, onUseInChat }: TemplateModalProps) {
  const { t } = useLanguage();

  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef | null>(null);
  const [runResult, setRunResult] = useState<TemplateRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [disabledQueries, setDisabledQueries] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  // Load sources when modal opens
  useEffect(() => {
    if (!open || !workspaceId) return;
    setSelectedTemplate(null);
    setRunResult(null);
    (async () => {
      try {
        const sourceList = await apiClient.listSources(workspaceId);
        setSources(sourceList || []);
      } catch {
        toast.error(t("studio.templateLoadError"));
      }
    })();
  }, [open, workspaceId]);

  // Load templates when source changes
  useEffect(() => {
    if (!selectedSourceId) {
      setTemplates([]);
      return;
    }
    setSelectedTemplate(null);
    setRunResult(null);
    setLoading(true);
    (async () => {
      try {
        const tpls = await apiClient.listTemplates(selectedSourceId);
        setTemplates(tpls || []);
      } catch {
        toast.error(t("studio.templateLoadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedSourceId]);

  const handleRunTemplate = async () => {
    if (!selectedTemplate || !selectedSourceId) return;
    setRunning(true);
    try {
      const result = await apiClient.runTemplate(selectedSourceId, selectedTemplate.id, {
        disabledQueries: disabledQueries.length > 0 ? disabledQueries : undefined,
        dateRange: dateRange.start || dateRange.end ? dateRange : undefined,
      });
      setRunResult(result);
      if (result.status === "success") {
        toast.success(t("studio.templateRunSuccess"));
      } else if (result.status === "partial") {
        toast.info(t("studio.templateRunPartial"));
      } else {
        toast.error(t("studio.templateRunError"));
      }
    } catch (err: unknown) {
      toast.error(t("studio.templateRunError"), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setRunning(false);
    }
  };

  const handleUseInChat = (result: TemplateResult) => {
    if (!onUseInChat || !selectedTemplate) return;
    const question = `Show me the data for "${result.title}" from the ${selectedTemplate.name} template`;
    onUseInChat(question);
    onOpenChange(false);
  };

  const handleCustomizeSave = (newDisabled: string[], newDateRange: { start: string; end: string }) => {
    setDisabledQueries(newDisabled);
    setDateRange(newDateRange);
  };

  const layoutClass = (layout: string) => {
    switch (layout) {
      case "grid_2x2":
        return "grid grid-cols-1 md:grid-cols-2 gap-4";
      case "grid_2x1":
        return "grid grid-cols-1 md:grid-cols-2 gap-4";
      case "single":
      default:
        return "flex flex-col gap-4";
    }
  };

  // Template browser view
  const renderTemplateBrowser = () => (
    <div className="space-y-4">
      {/* Source selector */}
      <div>
        <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
          <SelectTrigger>
            <SelectValue placeholder={t("studio.templateSelectSource")} />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedSourceId && sources.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          {t("studio.templateNoSource")}
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && selectedSourceId && templates.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          {t("studio.templateNoTemplates")}
        </p>
      )}

      {/* Template cards */}
      {!loading && templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <Card
              key={tpl.id}
              className="p-4 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all"
              onClick={() => {
                setSelectedTemplate(tpl);
                setDisabledQueries([]);
                setDateRange({ start: "", end: "" });
              }}
            >
              <h4 className="font-semibold text-sm">{tpl.name}</h4>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs bg-muted px-2 py-0.5 rounded">{tpl.queryCount} queries</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded">{tpl.layout}</span>
                {tpl.isBuiltin && <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">Built-in</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // Template detail + results view
  const renderTemplateDetail = () => (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedTemplate(null); setRunResult(null); }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h3 className="font-semibold">{selectedTemplate!.name}</h3>
          <p className="text-xs text-muted-foreground">{selectedTemplate!.description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
          <Settings2 className="h-4 w-4 mr-1" />
          {t("studio.templateCustomize")}
        </Button>
        <Button size="sm" onClick={handleRunTemplate} disabled={running}>
          {running ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{t("studio.templateRunning")}</>
          ) : (
            <><Play className="h-4 w-4 mr-1" />{t("studio.templateRun")}</>
          )}
        </Button>
      </div>

      {/* Results */}
      {runResult && (
        <div className={layoutClass(selectedTemplate!.layout)}>
          {runResult.results.map((result) => (
            <Card key={result.queryId} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">{result.title}</h4>
                {onUseInChat && (
                  <Button variant="ghost" size="sm" onClick={() => handleUseInChat(result)}>
                    <MessageCircle className="h-3 w-3 mr-1" />
                    <span className="text-xs">{t("studio.templateUseInChat")}</span>
                  </Button>
                )}
              </div>
              {result.error ? (
                <p className="text-sm text-destructive">{result.error}</p>
              ) : result.chartSpec ? (
                <ChartRenderer spec={result.chartSpec as ChartSpec} />
              ) : result.rows.length > 0 ? (
                <div className="overflow-x-auto max-h-48">
                  <table className="text-xs w-full">
                    <thead>
                      <tr>
                        {Object.keys(result.rows[0]).map((col) => (
                          <th key={col} className="text-left p-1 border-b font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 20).map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="p-1 border-b">{String(val ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {!runResult && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Click "{t("studio.templateRun")}" to execute this template.
        </p>
      )}

      {runResult && (
        <p className="text-xs text-muted-foreground text-right">
          {runResult.status} &middot; {runResult.durationMs ? `${runResult.durationMs}ms` : ""}
        </p>
      )}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{t("studio.templateTitle")}</DialogTitle>
            <DialogDescription>{t("studio.templateDescription")}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-2">
            {selectedTemplate ? renderTemplateDetail() : renderTemplateBrowser()}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {selectedTemplate && (
        <TemplateCustomizeDialog
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          queries={selectedTemplate.queries.map((q) => ({ id: q.id, title: q.title }))}
          disabledQueries={disabledQueries}
          dateRange={dateRange}
          onSave={handleCustomizeSave}
        />
      )}
    </>
  );
}
