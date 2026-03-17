import { useEffect, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { FileText, Loader2, Trash2, Download, BarChart3, Eye } from "lucide-react";
import { toast } from "sonner";

export interface ReportItem {
  id: string;
  agentId: string;
  sourceId: string;
  sourceName: string;
  chartCount: number;
  createdAt: string;
}

interface ReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function ReportModal({ open, onOpenChange, workspaceId }: ReportModalProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string; is_active?: boolean }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewingReport, setViewingReport] = useState<ReportItem | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    (async () => {
      try {
        const [sourceList, reportList] = await Promise.all([
          dataClient.listSources(workspaceId, undefined),
          dataClient.listReports(workspaceId),
        ]);
        setSources(sourceList || []);
        setReports(reportList || []);
        const list = sourceList || [];
        const active = list.find((s) => s.is_active) || list[0];
        if (active && !selectedSourceId) setSelectedSourceId(active.id);
        else if (list.length && !selectedSourceId) setSelectedSourceId(list[0].id);
      } catch (e) {
        console.error(e);
        toast.error(t("studio.reportLoadError"));
      }
    })();
  }, [open, workspaceId, t]);

  const canGenerate = sources.length > 0 && selectedSourceId && !loading;

  const handleGenerate = async () => {
    if (!workspaceId || !selectedSourceId) return;
    setLoading(true);
    setReportHtml(null);
    setViewingReport(null);
    try {
      const result = await dataClient.generateReport(workspaceId, selectedSourceId);
      setReports((prev) => [
        {
          id: result.id,
          agentId: result.agentId,
          sourceId: result.sourceId,
          sourceName: result.sourceName,
          chartCount: result.chartCount,
          createdAt: result.createdAt,
        },
        ...prev,
      ]);
      toast.success(t("studio.reportSaved"));
      // Auto-view the generated report
      await handleViewReport({
        id: result.id,
        agentId: result.agentId,
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        chartCount: result.chartCount,
        createdAt: result.createdAt,
      });
    } catch (err: unknown) {
      toast.error(t("studio.reportGenerateError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewReport = async (report: ReportItem) => {
    setViewingReport(report);
    setLoadingHtml(true);
    try {
      const html = await dataClient.getReportHtml(report.id);
      setReportHtml(html);
    } catch {
      toast.error(t("studio.reportLoadError"));
      setReportHtml(null);
    } finally {
      setLoadingHtml(false);
    }
  };

  const handleDeleteReport = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await dataClient.deleteReport(id);
      setReports((prev) => prev.filter((x) => x.id !== id));
      if (viewingReport?.id === id) {
        setViewingReport(null);
        setReportHtml(null);
      }
      toast.success(t("studio.reportDeleted"));
    } catch {
      toast.error(t("studio.reportDeleteError"));
    }
  };

  const handleDownload = () => {
    if (!reportHtml || !viewingReport) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${viewingReport.sourceName}-${new Date(viewingReport.createdAt).toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Write HTML into the iframe via srcdoc
  useEffect(() => {
    if (iframeRef.current && reportHtml) {
      iframeRef.current.srcdoc = reportHtml;
    }
  }, [reportHtml]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t("studio.reportTitle")}
          </DialogTitle>
          <DialogDescription>{t("studio.reportDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          {/* Generate section */}
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.reportSource")}</Label>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.reportNoSource")}</p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("studio.reportSelectSource")} />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleGenerate} disabled={!canGenerate}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {t("studio.reportGenerating")}
                    </>
                  ) : (
                    t("studio.reportGenerate")
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Saved reports list */}
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.reportSavedList")}</Label>
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.reportNoSaved")}</p>
            ) : (
              <ScrollArea className="h-28 border rounded-md">
                <ul className="p-2 space-y-1">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewReport(r)}
                        onKeyDown={(e) => e.key === "Enter" && handleViewReport(r)}
                        className={`flex w-full items-center justify-between gap-2 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer ${
                          viewingReport?.id === r.id
                            ? "border-accent/40 bg-accent text-accent-foreground"
                            : "border-transparent bg-transparent hover:bg-accent/80 hover:text-accent-foreground"
                        }`}
                      >
                        <span className="truncate flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          {r.sourceName} — {new Date(r.createdAt).toLocaleDateString()}
                          <span className="text-xs text-muted-foreground">({r.chartCount} charts)</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-inherit hover:bg-background/10 hover:text-inherit"
                            onClick={(e) => handleDeleteReport(e, r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>

          {/* Report view */}
          {(viewingReport || loading) && (
            <div className="border rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/50 text-sm font-medium shrink-0 flex items-center justify-between">
                <span>
                  {viewingReport
                    ? `${viewingReport.sourceName} — ${new Date(viewingReport.createdAt).toLocaleString()}`
                    : loading
                      ? t("studio.reportGenerating")
                      : t("studio.reportTitle")}
                </span>
                {reportHtml && viewingReport && (
                  <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 gap-1.5">
                    <Download className="h-3.5 w-3.5" />
                    {t("studio.reportDownload")}
                  </Button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {loading || loadingHtml ? (
                  <div className="flex flex-col items-center justify-center gap-3 h-full text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span>{loading ? t("studio.reportGenerating") : t("studio.reportLoadingHtml")}</span>
                    {loading && (
                      <span className="text-xs text-muted-foreground/60">{t("studio.reportGeneratingHint")}</span>
                    )}
                  </div>
                ) : reportHtml ? (
                  <iframe
                    ref={iframeRef}
                    title="Report"
                    sandbox="allow-same-origin"
                    className="w-full h-full border-0"
                    style={{ background: "#14141a" }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Eye className="h-5 w-5 mr-2" />
                    {t("studio.reportSelectToView")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
