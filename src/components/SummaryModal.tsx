import { useEffect, useState } from "react";
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
import { FileText, Loader2, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

export interface TableSummaryItem {
  id: string;
  agentId: string;
  sourceId: string;
  sourceName: string;
  report: string;
  queriesRun: unknown[];
  createdAt: string;
}

interface SummaryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function SummaryModal({ open, onOpenChange, workspaceId }: SummaryModalProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string; is_active?: boolean }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [summaries, setSummaries] = useState<TableSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [viewingSummary, setViewingSummary] = useState<TableSummaryItem | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    (async () => {
      try {
        const [sourceList, summaryList] = await Promise.all([
          dataClient.listSources(workspaceId, undefined),
          dataClient.listTableSummaries(workspaceId),
        ]);
        setSources(sourceList || []);
        setSummaries(summaryList || []);
        const list = sourceList || [];
        const active = list.find((s) => s.is_active) || list[0];
        if (active && !selectedSourceId) setSelectedSourceId(active.id);
        else if (list.length && !selectedSourceId) setSelectedSourceId(list[0].id);
      } catch (e) {
        console.error(e);
        toast.error(t("studio.summaryLoadError"));
      }
    })();
  }, [open, workspaceId, t]);

  const canGenerate = sources.length > 0 && selectedSourceId && !loading;

  const handleGenerate = async () => {
    if (!workspaceId || !selectedSourceId) return;
    setLoading(true);
    setGeneratedReport(null);
    setViewingSummary(null);
    try {
      const result = await dataClient.generateTableSummary(workspaceId, selectedSourceId);
      setGeneratedReport(result.report);
      setSummaries((prev) => [
        {
          id: result.id,
          agentId: result.agentId,
          sourceId: result.sourceId,
          sourceName: result.sourceName,
          report: result.report,
          queriesRun: result.queriesRun || [],
          createdAt: result.createdAt,
        },
        ...prev,
      ]);
      toast.success(t("studio.summarySaved"));
    } catch (err: unknown) {
      toast.error(t("studio.summaryGenerateError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewSaved = (s: TableSummaryItem) => {
    setViewingSummary(s);
    setGeneratedReport(null);
  };

  const handleDeleteSummary = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await dataClient.deleteTableSummary(id);
      setSummaries((prev) => prev.filter((x) => x.id !== id));
      if (viewingSummary?.id === id) {
        setViewingSummary(null);
        setGeneratedReport(null);
      }
      toast.success(t("studio.summaryDeleted"));
    } catch {
      toast.error(t("studio.summaryDeleteError"));
    }
  };

  const displayReport = viewingSummary?.report ?? generatedReport;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("studio.summaryTitle")}
          </DialogTitle>
          <DialogDescription>{t("studio.summaryDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          {/* Generate section */}
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.summarySource")}</Label>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.summaryNoSource")}</p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("studio.summarySelectSource")} />
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("studio.summaryGenerate")
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Saved summaries list */}
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.summarySavedList")}</Label>
            {summaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.summaryNoSaved")}</p>
            ) : (
              <ScrollArea className="h-32 border rounded-md">
                <ul className="p-2 space-y-1">
                  {summaries.map((s) => (
                    <li key={s.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewSaved(s)}
                        onKeyDown={(e) => e.key === "Enter" && handleViewSaved(s)}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent ${viewingSummary?.id === s.id ? "bg-accent" : ""}`}
                      >
                        <span className="truncate">
                          {s.sourceName} — {new Date(s.createdAt).toLocaleDateString()}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={(e) => handleDeleteSummary(e, s.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>

          {/* Report view */}
          {(displayReport || loading) && (
            <div className="border rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/50 text-sm font-medium shrink-0">
                {viewingSummary
                  ? `${viewingSummary.sourceName} — ${new Date(viewingSummary.createdAt).toLocaleString()}`
                  : loading
                    ? t("studio.summaryGenerating")
                    : t("studio.summaryReport")}
              </div>
              <ScrollArea className="h-full min-h-0 flex-1">
                <div className="p-4 pr-6">
                  {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{t("studio.summaryGenerating")}</span>
                    </div>
                  ) : (
                    <div className="table-summary-markdown prose prose-sm md:prose-base max-w-none text-foreground dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-ul:my-3 prose-ul:text-foreground prose-ol:my-3 prose-ol:text-foreground prose-li:my-0.5 prose-li:text-foreground prose-code:bg-muted prose-code:text-foreground prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:rounded-lg prose-blockquote:border-l-4 prose-blockquote:text-foreground prose-blockquote:italic prose-table:border-collapse prose-th:border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-foreground prose-td:border prose-td:px-3 prose-td:py-2 prose-td:text-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayReport || ""}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
