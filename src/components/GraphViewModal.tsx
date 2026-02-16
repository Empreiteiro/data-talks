import { useEffect, useMemo, useRef, useState, Suspense, lazy } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2, Network } from "lucide-react";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

interface GraphViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

type GraphNode = { id: string; name?: string };
type GraphLink = { source: string; target: string };

function buildGraphFromTable(
  rows: Record<string, unknown>[],
  sourceCol: string,
  targetCol: string
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeIds = new Set<string>();
  const links: GraphLink[] = [];

  for (const row of rows) {
    const src = row[sourceCol];
    const tgt = row[targetCol];
    const srcId = src != null ? String(src).trim() : "";
    const tgtId = tgt != null ? String(tgt).trim() : "";
    if (srcId && tgtId) {
      nodeIds.add(srcId);
      nodeIds.add(tgtId);
      links.push({ source: srcId, target: tgtId });
    }
  }

  const nodes: GraphNode[] = Array.from(nodeIds).map((id) => ({ id, name: id }));
  return { nodes, links };
}

export function GraphViewModal({
  open,
  onOpenChange,
  workspaceId,
}: GraphViewModalProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [sourceName, setSourceName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [sourceColumn, setSourceColumn] = useState<string>("");
  const [targetColumn, setTargetColumn] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;

    let cancelled = false;
    setError(null);
    setLoading(true);
    setSourceColumn("");
    setTargetColumn("");

    dataClient
      .listSources(workspaceId, true)
      .then((sources) => {
        if (cancelled || !sources?.length) {
          setColumns([]);
          setPreviewRows([]);
          setSourceName("");
          setLoading(false);
          return;
        }

        const source = sources[0];
        const meta = source.metaJSON as Record<string, unknown> | undefined;
        const tableInfos = meta?.table_infos as Array<{ columns?: string[]; preview_rows?: Record<string, unknown>[] }> | undefined;

        let cols: string[] = [];
        let rows: Record<string, unknown>[] = [];

        if (tableInfos?.[0]) {
          cols = tableInfos[0].columns || [];
          rows = tableInfos[0].preview_rows || [];
        } else {
          cols = (meta?.columns as string[]) || [];
          rows = (meta?.preview_rows as Record<string, unknown>[]) || [];
        }

        if (cancelled) return;
        setSourceName(source.name || "");
        setColumns(cols);
        setPreviewRows(rows);
        if (cols.length >= 2 && !sourceColumn && !targetColumn) {
          setSourceColumn(cols[0]);
          setTargetColumn(cols[1]);
        } else if (cols.length >= 1) {
          setSourceColumn(cols[0]);
          setTargetColumn(cols[cols.length > 1 ? 1 : 0]);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setColumns([]);
          setPreviewRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  const graphData = useMemo(() => {
    if (!sourceColumn || !targetColumn || previewRows.length === 0)
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    return buildGraphFromTable(previewRows, sourceColumn, targetColumn);
  }, [previewRows, sourceColumn, targetColumn]);

  const hasData = graphData.nodes.length > 0 || graphData.links.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            {t("graph.title")}
          </DialogTitle>
          <DialogDescription>{t("graph.description")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : columns.length === 0 || previewRows.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-8 text-center text-muted-foreground">
            <Network className="mx-auto h-12 w-12 mb-3 opacity-50" />
            <p>{t("graph.noPreview")}</p>
            <p className="text-sm mt-1">{t("graph.noData")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("graph.sourceColumn")}</Label>
                <Select
                  value={sourceColumn}
                  onValueChange={(v) => {
                    setSourceColumn(v);
                    if (targetColumn === v) setTargetColumn(columns.filter((c) => c !== v)[0] || "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("graph.selectSource")} />
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
              <div className="space-y-2">
                <Label>{t("graph.targetColumn")}</Label>
                <Select
                  value={targetColumn}
                  onValueChange={(v) => {
                    setTargetColumn(v);
                    if (sourceColumn === v) setSourceColumn(columns.filter((c) => c !== v)[0] || "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("graph.selectTarget")} />
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
            </div>

            {sourceName && (
              <p className="text-xs text-muted-foreground">
                {t("graph.dataSource")}: {sourceName}
              </p>
            )}

            <div
              ref={containerRef}
              className="min-h-[400px] w-full rounded-lg border bg-background overflow-hidden"
            >
              {hasData ? (
                <Suspense
                  fallback={
                    <div className="w-full h-[400px] flex items-center justify-center bg-muted/30 rounded-lg">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <ForceGraph2D
                  graphData={graphData}
                  width={containerRef.current?.offsetWidth ?? 700}
                  height={400}
                  nodeLabel="name"
                  nodeAutoColorBy="id"
                  linkDirectionalArrowLength={4}
                  linkDirectionalArrowRelPos={1}
                  backgroundColor="hsl(var(--background))"
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = (node as GraphNode).id;
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const padding = 4;
                    const textWidth = ctx.measureText(label).width + padding * 2;
                    const bgr = [255, 255, 255];
                    ctx.fillStyle = `rgba(${bgr[0]},${bgr[1]},${bgr[2]},0.8)`;
                    ctx.strokeStyle = "hsl(var(--primary))";
                    ctx.lineWidth = 1 / globalScale;
                    ctx.beginPath();
                    ctx.arc((node as { x?: number }).x ?? 0, (node as { y?: number }).y ?? 0, Math.max(textWidth / 2, 12), 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.stroke();
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "hsl(var(--foreground))";
                    ctx.fillText(label, (node as { x?: number }).x ?? 0, (node as { y?: number }).y ?? 0);
                  }}
                  />
                </Suspense>
              ) : (
                <div className="flex h-[400px] items-center justify-center text-muted-foreground">
                  {sourceColumn && targetColumn
                    ? t("graph.noEdges")
                    : t("graph.selectColumns")}
                </div>
              )}
            </div>

            {hasData && (
              <p className="text-xs text-muted-foreground">
                {graphData.nodes.length} {t("graph.nodes")} · {graphData.links.length} {t("graph.links")}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
