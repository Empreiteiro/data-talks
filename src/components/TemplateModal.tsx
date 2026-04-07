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
import { ArrowLeft, Download, Loader2, Maximize2, MessageCircle, Play, Settings2, Sparkles, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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
  const { t, language } = useLanguage();

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
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);

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

  const handleGenerateTemplate = async () => {
    if (!selectedSourceId) return;
    setGenerating(true);
    try {
      const result = await apiClient.generateTemplate(selectedSourceId, {
        agentId: workspaceId,
        prompt: generatePrompt || undefined,
        language,
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
      if (selectedTemplate?.id === templateId) {
        setSelectedTemplate(null);
        setRunResult(null);
      }
      toast.success(t("studio.templateDeleted") || "Template deleted");
    } catch {
      toast.error(t("studio.templateDeleteError") || "Failed to delete template");
    }
  };

  const buildReportHtml = (): string => {
    if (!runResult || !selectedTemplate) return "";
    const title = selectedTemplate.name;
    const desc = selectedTemplate.description;
    const cards = runResult.results.map((r) => {
      if (r.error) {
        return `<div class="card"><h3>${r.title}</h3><p class="error">${r.error}</p></div>`;
      }
      let tableHtml = "";
      if (r.rows.length > 0) {
        const cols = Object.keys(r.rows[0]);
        const thead = cols.map((c) => `<th>${c}</th>`).join("");
        const tbody = r.rows.slice(0, 50).map((row) =>
          "<tr>" + cols.map((c) => `<td>${row[c] ?? ""}</td>`).join("") + "</tr>"
        ).join("\n");
        tableHtml = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
      }
      return `<div class="card"><h3>${r.title}</h3>${tableHtml || '<p class="empty">No data</p>'}</div>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f13;color:#e4e4e7;padding:2rem}
h1{font-size:1.5rem;margin-bottom:.25rem}
.desc{color:#a1a1aa;font-size:.875rem;margin-bottom:1.5rem}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem}
@media(max-width:768px){.grid{grid-template-columns:1fr}}
.card{background:#1a1a23;border:1px solid #27272a;border-radius:.75rem;padding:1.25rem}
.card h3{font-size:.875rem;font-weight:600;margin-bottom:.75rem;color:#f4f4f5}
table{width:100%;border-collapse:collapse;font-size:.75rem}
th{text-align:left;padding:.375rem .5rem;border-bottom:1px solid #3f3f46;color:#a1a1aa;font-weight:500}
td{padding:.375rem .5rem;border-bottom:1px solid #27272a}
.error{color:#f87171;font-size:.8rem}
.empty{color:#71717a;font-size:.8rem}
.meta{text-align:right;color:#71717a;font-size:.75rem;margin-top:1rem}
</style></head><body>
<h1>${title}</h1>
<p class="desc">${desc}</p>
<div class="grid">${cards}</div>
<p class="meta">${runResult.status} &middot; ${runResult.durationMs ? runResult.durationMs + "ms" : ""} &middot; ${runResult.createdAt ? new Date(runResult.createdAt).toLocaleString() : ""}</p>
</body></html>`;
  };

  const handleOpenHtmlNewTab = () => {
    const html = buildReportHtml();
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDownloadHtml = () => {
    const html = buildReportHtml();
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-${selectedTemplate?.name || "report"}-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

      {/* AI Generate section */}
      {!loading && selectedSourceId && (
        <div className="border rounded-md p-3 space-y-2">
          <Label className="text-xs font-medium">{t("studio.templateCreateLabel") || "Create template with AI"}</Label>
          <Textarea
            className="text-xs min-h-[60px]"
            placeholder={t("studio.templateCreatePlaceholder") || "Describe the report you want (optional)... e.g. 'Monthly revenue by category with trends'"}
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            disabled={generating}
          />
          <Button size="sm" onClick={handleGenerateTemplate} disabled={generating}>
            {generating ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("studio.templateGenerating") || "Generating..."}</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" />{t("studio.templateGenerate") || "Generate Template"}</>
            )}
          </Button>
        </div>
      )}

      {!loading && selectedSourceId && templates.length === 0 && !generating && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("studio.templateNoTemplates")}
        </p>
      )}

      {/* Template cards */}
      {!loading && templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <Card
              key={tpl.id}
              className="p-4 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all group"
              onClick={() => {
                setSelectedTemplate(tpl);
                setDisabledQueries([]);
                setDateRange({ start: "", end: "" });
              }}
            >
              <div className="flex items-start justify-between">
                <h4 className="font-semibold text-sm flex-1">{tpl.name}</h4>
                {!tpl.isBuiltin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive flex-shrink-0"
                    onClick={(e) => handleDeleteTemplate(e, tpl.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
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
        {runResult && (
          <>
            <Button variant="ghost" size="sm" onClick={handleOpenHtmlNewTab} className="h-8 gap-1">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadHtml} className="h-8 gap-1">
              <Download className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
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
