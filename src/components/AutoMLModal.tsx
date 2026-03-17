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
import { Loader2, Network, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

interface AutoMLRunItem {
  id: string;
  agentId: string;
  sourceId: string;
  sourceName: string;
  targetColumn: string;
  taskType: string;
  modelType: string;
  metrics: Record<string, unknown>;
  featureImportance: Array<{ feature: string; importance: number }>;
  report: string;
  createdAt: string;
}

interface AutoMLModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

function MetricsTable({ metrics, taskType, t }: { metrics: Record<string, unknown>; taskType: string; t: (key: string) => string }) {
  const entries = Object.entries(metrics).filter(
    ([key]) => !["confusion_matrix", "classes"].includes(key)
  );
  if (entries.length === 0) return null;

  const formatValue = (v: unknown) => {
    if (typeof v === "number") return v.toFixed(4);
    return String(v);
  };

  const labelMap: Record<string, string> = {
    accuracy: "Accuracy",
    precision: "Precision",
    recall: "Recall",
    f1: "F1 Score",
    r2: "R\u00B2",
    mae: "MAE",
    rmse: "RMSE",
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{t("studio.autoMLMetrics")}</Label>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span className="px-2 py-0.5 bg-muted rounded">
          {taskType === "classification"
            ? t("studio.autoMLTaskClassification")
            : t("studio.autoMLTaskRegression")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between border rounded px-3 py-2 text-sm">
            <span className="text-muted-foreground">{labelMap[key] || key}</span>
            <span className="font-mono font-medium">{formatValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureImportanceChart({
  features,
  t,
}: {
  features: Array<{ feature: string; importance: number }>;
  t: (key: string) => string;
}) {
  if (!features.length) return null;
  const maxImp = Math.max(...features.map((f) => f.importance));

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{t("studio.autoMLFeatureImportance")}</Label>
      <div className="space-y-1.5">
        {features.slice(0, 10).map((f) => (
          <div key={f.feature} className="flex items-center gap-2 text-sm">
            <span className="w-32 truncate text-muted-foreground text-xs" title={f.feature}>
              {f.feature}
            </span>
            <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded transition-all"
                style={{ width: `${maxImp > 0 ? (f.importance / maxImp) * 100 : 0}%` }}
              />
            </div>
            <span className="w-14 text-right text-xs font-mono">
              {(f.importance * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutoMLModal({ open, onOpenChange, workspaceId }: AutoMLModalProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Array<{ id: string; name: string; type: string; is_active?: boolean }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [runs, setRuns] = useState<AutoMLRunItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [result, setResult] = useState<AutoMLRunItem | null>(null);
  const [viewingRun, setViewingRun] = useState<AutoMLRunItem | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    (async () => {
      try {
        const [sourceList, runList] = await Promise.all([
          dataClient.listSources(workspaceId, undefined),
          dataClient.listAutoMLRuns(workspaceId),
        ]);
        // Only show sources that support Auto ML (csv, xlsx, sql_database)
        const supported = (sourceList || []).filter((s) =>
          ["csv", "xlsx", "sql_database"].includes(s.type)
        );
        setSources(supported);
        setRuns(runList || []);
        const active = supported.find((s) => s.is_active) || supported[0];
        if (active && !selectedSourceId) setSelectedSourceId(active.id);
      } catch (e) {
        console.error(e);
        toast.error(t("studio.autoMLLoadError"));
      }
    })();
  }, [open, workspaceId, t]);

  useEffect(() => {
    if (!selectedSourceId || !workspaceId) {
      setColumns([]);
      setSelectedTarget("");
      return;
    }
    (async () => {
      setLoadingColumns(true);
      try {
        const data = await dataClient.getAutoMLColumns(workspaceId, selectedSourceId);
        setColumns(data.columns || []);
        setSelectedTarget("");
      } catch (e) {
        console.error(e);
        setColumns([]);
      } finally {
        setLoadingColumns(false);
      }
    })();
  }, [selectedSourceId, workspaceId]);

  const canTrain = sources.length > 0 && selectedSourceId && selectedTarget && !loading;

  const handleTrain = async () => {
    if (!workspaceId || !selectedSourceId || !selectedTarget) return;
    setLoading(true);
    setResult(null);
    setViewingRun(null);
    try {
      const res = await dataClient.trainAutoML(workspaceId, selectedSourceId, selectedTarget);
      setResult(res);
      setRuns((prev) => [res, ...prev]);
      toast.success(t("studio.autoMLTrainSuccess"));
    } catch (err: unknown) {
      toast.error(t("studio.autoMLTrainError"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewRun = (run: AutoMLRunItem) => {
    setViewingRun(run);
    setResult(null);
  };

  const handleDeleteRun = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await dataClient.deleteAutoMLRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (viewingRun?.id === id) {
        setViewingRun(null);
        setResult(null);
      }
      toast.success(t("studio.autoMLDeleted"));
    } catch {
      toast.error(t("studio.autoMLDeleteError"));
    }
  };

  const displayRun = viewingRun ?? result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            {t("studio.autoMLTitle")}
          </DialogTitle>
          <DialogDescription>{t("studio.autoMLDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          {/* Source + Target selection */}
          <div className="space-y-3 shrink-0">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.autoMLNoSource")}</p>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>{t("studio.autoMLSelectSource")}</Label>
                  <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("studio.autoMLSelectSource")} />
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

                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>{t("studio.autoMLSelectTarget")}</Label>
                    <Select
                      value={selectedTarget}
                      onValueChange={setSelectedTarget}
                      disabled={loadingColumns || columns.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingColumns
                              ? "..."
                              : t("studio.autoMLSelectTarget")
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col} value={col}>
                            {col}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleTrain} disabled={!canTrain}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        {t("studio.autoMLTraining")}
                      </>
                    ) : (
                      t("studio.autoMLTrain")
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Previous runs */}
          <div className="space-y-2 shrink-0">
            <Label>{t("studio.autoMLSavedList")}</Label>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("studio.autoMLNoSaved")}</p>
            ) : (
              <ScrollArea className="h-28 border rounded-md">
                <ul className="p-2 space-y-1">
                  {runs.map((run) => (
                    <li key={run.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewRun(run)}
                        onKeyDown={(e) => e.key === "Enter" && handleViewRun(run)}
                        className={`flex w-full items-center justify-between gap-2 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors cursor-pointer ${
                          viewingRun?.id === run.id
                            ? "border-accent/40 bg-accent text-accent-foreground"
                            : "border-transparent bg-transparent hover:bg-accent/80 hover:text-accent-foreground"
                        }`}
                      >
                        <span className="truncate">
                          {run.sourceName} &rarr; {run.targetColumn} ({run.taskType}) &mdash;{" "}
                          {new Date(run.createdAt).toLocaleDateString()}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-inherit hover:bg-background/10 hover:text-inherit"
                          onClick={(e) => handleDeleteRun(e, run.id)}
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

          {/* Results view */}
          {(displayRun || loading) && (
            <div className="border rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/50 text-sm font-medium shrink-0">
                {loading
                  ? t("studio.autoMLTraining")
                  : displayRun
                    ? `${displayRun.sourceName} \u2192 ${displayRun.targetColumn} \u2014 ${new Date(displayRun.createdAt).toLocaleString()}`
                    : ""}
              </div>
              <ScrollArea className="h-full min-h-0 flex-1">
                <div className="p-4 pr-6 space-y-6">
                  {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{t("studio.autoMLTraining")}</span>
                    </div>
                  ) : displayRun ? (
                    <>
                      <MetricsTable
                        metrics={displayRun.metrics}
                        taskType={displayRun.taskType}
                        t={t}
                      />
                      <FeatureImportanceChart
                        features={displayRun.featureImportance}
                        t={t}
                      />
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">{t("studio.autoMLReport")}</Label>
                        <div className="table-summary-markdown prose prose-sm md:prose-base max-w-none text-foreground dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-ul:my-3 prose-ul:text-foreground prose-ol:my-3 prose-ol:text-foreground prose-li:my-0.5 prose-li:text-foreground prose-code:bg-muted prose-code:text-foreground prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:rounded-lg prose-blockquote:border-l-4 prose-blockquote:text-foreground prose-blockquote:italic prose-table:border-collapse prose-th:border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-foreground prose-td:border prose-td:px-3 prose-td:py-2 prose-td:text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {displayRun.report}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
