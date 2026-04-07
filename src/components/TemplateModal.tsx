import { useEffect, useRef, useState } from "react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/services/apiClient";
import { ChartRenderer, type ChartSpec } from "@/components/ChartRenderer";
import { TemplateCustomizeDialog } from "@/components/TemplateCustomizeDialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Maximize2,
  MessageCircle,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  explanation?: string | null;
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

interface SavedReport {
  id: string;
  sourceName: string;
  chartCount: number;
  createdAt: string;
}

interface TemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onUseInChat?: (question: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateModal({ open, onOpenChange, workspaceId, onUseInChat }: TemplateModalProps) {
  const { t, language } = useLanguage();

  // Source & template browsing
  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef | null>(null);
  const [loading, setLoading] = useState(false);

  // Run results
  const [runResult, setRunResult] = useState<TemplateRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [withCommentary, setWithCommentary] = useState(false);

  // Customization
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [disabledQueries, setDisabledQueries] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  // AI generation
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  // Report history
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loadingReportHtml, setLoadingReportHtml] = useState(false);
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Add query
  const [addQueryDesc, setAddQueryDesc] = useState("");
  const [addingQuery, setAddingQuery] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState("results");

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !workspaceId) return;
    setSelectedTemplate(null);
    setRunResult(null);
    setReportHtml(null);
    (async () => {
      try {
        const sourceList = await apiClient.listSources(workspaceId);
        setSources(sourceList || []);
      } catch {
        toast.error(t("studio.templateLoadError"));
      }
    })();
  }, [open, workspaceId]);

  useEffect(() => {
    if (!selectedSourceId) { setTemplates([]); return; }
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

  // Load report history when template is selected
  useEffect(() => {
    if (!selectedTemplate || !selectedSourceId) { setSavedReports([]); return; }
    (async () => {
      try {
        const reports = await apiClient.listTemplateReports(selectedSourceId, selectedTemplate.id);
        setSavedReports(reports || []);
      } catch { /* silent */ }
    })();
  }, [selectedTemplate, selectedSourceId]);

  // Iframe srcdoc sync
  useEffect(() => {
    if (iframeRef.current && reportHtml) iframeRef.current.srcdoc = reportHtml;
  }, [reportHtml]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSelectTemplate = (tpl: TemplateDef) => {
    setSelectedTemplate(tpl);
    setRunResult(null);
    setReportHtml(null);
    setViewingReportId(null);
    setDisabledQueries([]);
    setDateRange({ start: "", end: "" });
    setDetailTab("results");
  };

  const handleRunTemplate = async () => {
    if (!selectedTemplate || !selectedSourceId) return;
    setRunning(true);
    try {
      let result: TemplateRunResult;
      if (withCommentary) {
        result = await apiClient.runTemplateWithCommentary(selectedSourceId, selectedTemplate.id, {
          agentId: workspaceId,
          language,
          disabledQueries: disabledQueries.length > 0 ? disabledQueries : undefined,
          dateRange: dateRange.start || dateRange.end ? dateRange : undefined,
        });
      } else {
        result = await apiClient.runTemplate(selectedSourceId, selectedTemplate.id, {
          disabledQueries: disabledQueries.length > 0 ? disabledQueries : undefined,
          dateRange: dateRange.start || dateRange.end ? dateRange : undefined,
        });
      }
      setRunResult(result);
      setDetailTab("results");
    } catch (err: unknown) {
      toast.error(t("studio.templateRunError"), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setRunning(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedTemplate || !selectedSourceId) return;
    setGeneratingReport(true);
    setReportHtml(null);
    try {
      const result = await apiClient.runTemplateAsReport(selectedSourceId, selectedTemplate.id, {
        agentId: workspaceId, language,
      });
      setSavedReports((prev) => [result, ...prev]);
      // Load and display
      const html = await apiClient.getReportHtml(result.id);
      setReportHtml(html);
      setViewingReportId(result.id);
      setDetailTab("reports");
      toast.success(t("studio.templateReportGenerated") || "Report generated!");
    } catch (err: unknown) {
      toast.error(t("studio.templateReportError") || "Failed to generate report", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleViewSavedReport = async (reportId: string) => {
    setLoadingReportHtml(true);
    setViewingReportId(reportId);
    try {
      const html = await apiClient.getReportHtml(reportId);
      setReportHtml(html);
    } catch {
      toast.error("Failed to load report");
      setReportHtml(null);
    } finally {
      setLoadingReportHtml(false);
    }
  };

  const handleDeleteSavedReport = async (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    try {
      await apiClient.deleteReport(reportId);
      setSavedReports((prev) => prev.filter((r) => r.id !== reportId));
      if (viewingReportId === reportId) { setReportHtml(null); setViewingReportId(null); }
      toast.success("Report deleted");
    } catch { toast.error("Failed to delete report"); }
  };

  const handleOpenReportNewTab = () => {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDownloadReport = () => {
    if (!reportHtml || !selectedTemplate) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${selectedTemplate.name}-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGenerateTemplate = async () => {
    if (!selectedSourceId) return;
    setGenerating(true);
    try {
      const result = await apiClient.generateTemplate(selectedSourceId, {
        agentId: workspaceId, prompt: generatePrompt || undefined, language,
      });
      setTemplates((prev) => [...prev, result]);
      setGeneratePrompt("");
      toast.success(t("studio.templateGenerated") || "Template generated!");
    } catch (err: unknown) {
      toast.error(t("studio.templateGenerateError") || "Failed to generate template", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    if (!selectedSourceId) return;
    try {
      await apiClient.deleteTemplate(selectedSourceId, templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      if (selectedTemplate?.id === templateId) { setSelectedTemplate(null); setRunResult(null); }
      toast.success(t("studio.templateDeleted") || "Template deleted");
    } catch { toast.error(t("studio.templateDeleteError") || "Failed to delete"); }
  };

  const handleRemoveQuery = async (queryId: string) => {
    if (!selectedTemplate || !selectedSourceId || selectedTemplate.isBuiltin) return;
    const updated = selectedTemplate.queries.filter((q) => q.id !== queryId);
    try {
      await apiClient.updateTemplateQueries(selectedSourceId, selectedTemplate.id, updated);
      setSelectedTemplate({ ...selectedTemplate, queries: updated, queryCount: updated.length });
      toast.success("Query removed");
    } catch { toast.error("Failed to remove query"); }
  };

  const handleAddQuery = async () => {
    if (!selectedTemplate || !selectedSourceId || !addQueryDesc.trim()) return;
    setAddingQuery(true);
    try {
      const result = await apiClient.addQueryToTemplate(selectedSourceId, selectedTemplate.id, {
        agentId: workspaceId, description: addQueryDesc.trim(), language,
      });
      const newQuery = result.query as TemplateDef["queries"][0];
      setSelectedTemplate({
        ...selectedTemplate,
        queries: [...selectedTemplate.queries, newQuery],
        queryCount: result.queryCount,
      });
      setAddQueryDesc("");
      toast.success("Query added");
    } catch (err: unknown) {
      toast.error("Failed to add query", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setAddingQuery(false);
    }
  };

  const handleUseInChat = (result: TemplateResult) => {
    if (!onUseInChat || !selectedTemplate) return;
    onUseInChat(`Show me the data for "${result.title}" from the ${selectedTemplate.name} template`);
    onOpenChange(false);
  };

  const handleCustomizeSave = (newDisabled: string[], newDateRange: { start: string; end: string }) => {
    setDisabledQueries(newDisabled);
    setDateRange(newDateRange);
  };

  const layoutClass = (layout: string) => {
    switch (layout) {
      case "grid_2x2": case "grid_2x1": return "grid grid-cols-1 md:grid-cols-2 gap-4";
      default: return "flex flex-col gap-4";
    }
  };

  // ---------------------------------------------------------------------------
  // Template browser view
  // ---------------------------------------------------------------------------

  const renderBrowser = () => (
    <div className="space-y-4">
      <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
        <SelectTrigger><SelectValue placeholder={t("studio.templateSelectSource")} /></SelectTrigger>
        <SelectContent>
          {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.type})</SelectItem>)}
        </SelectContent>
      </Select>

      {!selectedSourceId && sources.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">{t("studio.templateNoSource")}</p>
      )}

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {!loading && selectedSourceId && (
        <div className="border rounded-md p-3 space-y-2">
          <Label className="text-xs font-medium">{t("studio.templateCreateLabel") || "Create template with AI"}</Label>
          <Textarea className="text-xs min-h-[60px]" placeholder={t("studio.templateCreatePlaceholder") || "Describe the report you want..."} value={generatePrompt} onChange={(e) => setGeneratePrompt(e.target.value)} disabled={generating} />
          <Button size="sm" onClick={handleGenerateTemplate} disabled={generating}>
            {generating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("studio.templateGenerating") || "Generating..."}</> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />{t("studio.templateGenerate") || "Generate Template"}</>}
          </Button>
        </div>
      )}

      {!loading && selectedSourceId && templates.length === 0 && !generating && (
        <p className="text-sm text-muted-foreground text-center py-4">{t("studio.templateNoTemplates")}</p>
      )}

      {!loading && templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="p-4 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all group" onClick={() => handleSelectTemplate(tpl)}>
              <div className="flex items-start justify-between">
                <h4 className="font-semibold text-sm flex-1">{tpl.name}</h4>
                {!tpl.isBuiltin && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive flex-shrink-0" onClick={(e) => handleDeleteTemplate(e, tpl.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs bg-muted px-2 py-0.5 rounded">{tpl.queryCount} queries</span>
                {tpl.isBuiltin && <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">Built-in</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Template detail view
  // ---------------------------------------------------------------------------

  const renderDetail = () => (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedTemplate(null); setRunResult(null); setReportHtml(null); setViewingReportId(null); }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{selectedTemplate!.name}</h3>
          <p className="text-xs text-muted-foreground truncate">{selectedTemplate!.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5 mr-2">
            <Switch id="commentary" checked={withCommentary} onCheckedChange={setWithCommentary} className="scale-75" />
            <Label htmlFor="commentary" className="text-xs cursor-pointer">AI Commentary</Label>
          </div>
          <Button variant="outline" size="sm" className="h-7" onClick={() => setCustomizeOpen(true)}>
            <Settings2 className="h-3.5 w-3.5 mr-1" /><span className="text-xs">{t("studio.templateCustomize")}</span>
          </Button>
          <Button size="sm" className="h-7" onClick={handleRunTemplate} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Play className="h-3.5 w-3.5 mr-1" /><span className="text-xs">{t("studio.templateRun")}</span></>}
          </Button>
          <Button variant="outline" size="sm" className="h-7" onClick={handleGenerateReport} disabled={generatingReport}>
            {generatingReport ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><FileText className="h-3.5 w-3.5 mr-1" /><span className="text-xs">{t("studio.templateGenerateReport") || "Full Report"}</span></>}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="results" className="flex-1 text-xs">Results</TabsTrigger>
          <TabsTrigger value="queries" className="flex-1 text-xs">Queries ({selectedTemplate!.queries.length})</TabsTrigger>
          <TabsTrigger value="reports" className="flex-1 text-xs">Reports ({savedReports.length})</TabsTrigger>
        </TabsList>

        {/* ── Results tab ── */}
        <TabsContent value="results" className="flex-1 overflow-y-auto mt-2">
          {runResult ? (
            <div className="space-y-3">
              <div className={layoutClass(selectedTemplate!.layout)}>
                {runResult.results.map((result) => (
                  <Card key={result.queryId} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">{result.title}</h4>
                      {onUseInChat && (
                        <Button variant="ghost" size="sm" onClick={() => handleUseInChat(result)}>
                          <MessageCircle className="h-3 w-3 mr-1" /><span className="text-xs">{t("studio.templateUseInChat")}</span>
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
                          <thead><tr>{Object.keys(result.rows[0]).map((col) => <th key={col} className="text-left p-1 border-b font-medium">{col}</th>)}</tr></thead>
                          <tbody>{result.rows.slice(0, 20).map((row, i) => <tr key={i}>{Object.values(row).map((val, j) => <td key={j} className="p-1 border-b">{String(val ?? "")}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    ) : <p className="text-xs text-muted-foreground">No data</p>}
                    {result.explanation && (
                      <p className="text-sm text-muted-foreground mt-3 pt-3 border-t italic">{result.explanation}</p>
                    )}
                  </Card>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-right">{runResult.status} &middot; {runResult.durationMs ? `${runResult.durationMs}ms` : ""}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Click "{t("studio.templateRun")}" to execute queries{withCommentary ? " with AI commentary" : ""}.</p>
          )}
        </TabsContent>

        {/* ── Queries tab ── */}
        <TabsContent value="queries" className="flex-1 overflow-y-auto mt-2">
          <div className="space-y-2">
            {selectedTemplate!.queries.map((q) => (
              <div key={q.id} className="border rounded-md p-3 group">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{q.title}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{q.chart_type}</span>
                    {!selectedTemplate!.isBuiltin && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive" onClick={() => handleRemoveQuery(q.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <Accordion type="single" collapsible>
                  <AccordionItem value="sql" className="border-0">
                    <AccordionTrigger className="text-xs py-1">SQL</AccordionTrigger>
                    <AccordionContent>
                      <pre className="bg-muted rounded p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">{q.sql}</pre>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            ))}

            {/* Add query */}
            {!selectedTemplate!.isBuiltin && (
              <div className="border rounded-md p-3 border-dashed space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1"><Plus className="h-3 w-3" /> Add query with AI</Label>
                <Textarea className="text-xs min-h-[50px]" placeholder="Describe the query... e.g. 'Top 10 products by revenue'" value={addQueryDesc} onChange={(e) => setAddQueryDesc(e.target.value)} disabled={addingQuery} />
                <Button size="sm" variant="outline" onClick={handleAddQuery} disabled={addingQuery || !addQueryDesc.trim()}>
                  {addingQuery ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Adding...</> : <><Sparkles className="h-3 w-3 mr-1" />Add Query</>}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Reports tab ── */}
        <TabsContent value="reports" className="flex-1 flex flex-col min-h-0 mt-2">
          {/* Report list */}
          <ScrollArea className="h-28 border rounded-md shrink-0">
            {savedReports.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No reports generated yet. Click "Full Report" to create one.</p>
            ) : (
              <ul className="p-2 space-y-1">
                {savedReports.map((r) => (
                  <li key={r.id}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => handleViewSavedReport(r.id)}
                      onKeyDown={(e) => e.key === "Enter" && handleViewSavedReport(r.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${viewingReportId === r.id ? "border-accent/40 bg-accent text-accent-foreground" : "border-transparent hover:bg-accent/80"}`}
                    >
                      <span className="truncate flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        {new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString()}
                        <span className="text-xs text-muted-foreground">({r.chartCount} charts)</span>
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => handleDeleteSavedReport(e, r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>

          {/* Report iframe viewer */}
          <div className="flex-1 min-h-0 border rounded-lg flex flex-col overflow-hidden mt-2">
            {reportHtml && (
              <div className="p-2 border-b bg-muted/50 text-xs font-medium shrink-0 flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={handleOpenReportNewTab}>
                  <Maximize2 className="h-3 w-3" />{t("studio.reportOpenNewTab") || "Open in new tab"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={handleDownloadReport}>
                  <Download className="h-3 w-3" />{t("studio.reportDownload")}
                </Button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
              {generatingReport || loadingReportHtml ? (
                <div className="flex flex-col items-center justify-center gap-3 h-full text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="text-sm">{generatingReport ? (t("studio.templateGeneratingReport") || "Generating report...") : "Loading..."}</span>
                </div>
              ) : reportHtml ? (
                <iframe ref={iframeRef} title="Template Report" sandbox="allow-same-origin" className="w-full h-full border-0" style={{ background: "#14141a" }} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a report from the list or generate a new one.
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("studio.templateTitle")}</DialogTitle>
            <DialogDescription>{t("studio.templateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedTemplate ? renderDetail() : renderBrowser()}
          </div>
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
