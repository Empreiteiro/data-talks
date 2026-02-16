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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import { Loader2, Network, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

interface GraphViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

type GraphNode = { id: string; name?: string; group?: string };
type GraphLink = { source: string; target: string };

/** Mode 1: Column pair - values as nodes, source→target edges per row */
function buildGraphColumnPair(
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

/** Mode 2: Property graph - rows as nodes, FK-style edges when A[source]=B[target] */
function buildGraphPropertyModel(
  rows: Record<string, unknown>[],
  sourceCol: string,
  targetCol: string
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowId = `row_${i}`;
    const labelParts: string[] = [];
    for (const col of [sourceCol, targetCol]) {
      const v = row[col];
      if (v != null && String(v).trim()) labelParts.push(String(v).trim());
    }
    const label = labelParts.length > 0 ? labelParts.join(" · ") : rowId;
    nodes.push({ id: rowId, name: label, group: "entity" });
  }

  for (let i = 0; i < rows.length; i++) {
    const srcVal = rows[i][sourceCol];
    const srcStr = srcVal != null ? String(srcVal).trim() : "";
    if (!srcStr) continue;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const tgtVal = rows[j][targetCol];
      const tgtStr = tgtVal != null ? String(tgtVal).trim() : "";
      if (srcStr === tgtStr) {
        links.push({ source: `row_${i}`, target: `row_${j}` });
      }
    }
  }

  return { nodes, links };
}

/** Mode 3: Bipartite - entity nodes (rows) + value nodes, row→value when row[col]=value */
function buildGraphBipartite(
  rows: Record<string, unknown>[],
  valueCol: string
): { nodes: GraphNode[]; links: GraphLink[] } {
  const entityNodes: GraphNode[] = [];
  const valueNodeIds = new Set<string>();
  const links: GraphLink[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowId = `row_${i}`;
    const val = row[valueCol];
    const valStr = val != null ? String(val).trim() : "";
    if (!valStr) continue;
    const valueId = `val:${valueCol}:${valStr}`;
    valueNodeIds.add(valueId);
    entityNodes.push({
      id: rowId,
      name: `Row ${i + 1}`,
      group: "entity",
    });
    links.push({ source: rowId, target: valueId });
  }

  const valueNodes: GraphNode[] = Array.from(valueNodeIds).map((id) => ({
    id,
    name: id.replace(`val:${valueCol}:`, ""),
    group: "value",
  }));

  return { nodes: [...entityNodes, ...valueNodes], links };
}

export type GraphMode = "columnPair" | "property" | "bipartite";

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
  const [graphMode, setGraphMode] = useState<GraphMode>("columnPair");
  const [sourceColumn, setSourceColumn] = useState<string>("");
  const [targetColumn, setTargetColumn] = useState<string>("");
  const [valueColumn, setValueColumn] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [graphSize, setGraphSize] = useState({ width: 700, height: 400 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setMaximized(false);
      return;
    }
    if (!workspaceId) return;

    let cancelled = false;
    setError(null);
    setLoading(true);
    setSourceColumn("");
    setTargetColumn("");

    dataClient
      .listSources(workspaceId, true)
      .then(async (sources) => {
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

        if (source.type === "bigquery" && source.id) {
          try {
            const fullTable = await dataClient.fetchBigQueryFullTable(source.id);
            cols = fullTable?.columns || tableInfos?.[0]?.columns || [];
            rows = fullTable?.rows || [];
          } catch {
            if (tableInfos?.[0]) {
              cols = tableInfos[0].columns || [];
              rows = tableInfos[0].preview_rows || [];
            } else {
              cols = (meta?.columns as string[]) || [];
              rows = (meta?.preview_rows as Record<string, unknown>[]) || [];
            }
          }
        } else if (tableInfos?.[0]) {
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
        if (cols.length >= 2) {
          setSourceColumn(cols[0]);
          setTargetColumn(cols[1]);
          setValueColumn(cols[0]);
        } else if (cols.length >= 1) {
          setSourceColumn(cols[0]);
          setTargetColumn(cols[0]);
          setValueColumn(cols[0]);
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
    if (previewRows.length === 0) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    if (graphMode === "bipartite") {
      if (!valueColumn) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
      return buildGraphBipartite(previewRows, valueColumn);
    }
    if (graphMode === "property") {
      if (!sourceColumn || !targetColumn) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
      return buildGraphPropertyModel(previewRows, sourceColumn, targetColumn);
    }
    if (!sourceColumn || !targetColumn) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    return buildGraphColumnPair(previewRows, sourceColumn, targetColumn);
  }, [previewRows, graphMode, sourceColumn, targetColumn, valueColumn]);

  const hasData = graphData.nodes.length > 0 || graphData.links.length > 0;

  // Update graph dimensions when container resizes (e.g. on maximize toggle)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 700, height: 400 };
      setGraphSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, maximized]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-4xl max-h-[90vh] flex flex-col",
          maximized &&
            "fixed inset-4 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] h-[calc(100vh-2rem)]"
        )}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <div className="space-y-1.5">
              <DialogTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                {t("graph.title")}
              </DialogTitle>
              <DialogDescription>{t("graph.description")}</DialogDescription>
            </div>
            {!loading && !error && columns.length > 0 && previewRows.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? t("graph.restore") : t("graph.maximize")}
                className="shrink-0"
              >
                {maximized ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
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
          <div className={cn("flex flex-col gap-4 min-h-0", maximized && "flex-1 overflow-auto")}>
            <div className="space-y-4 shrink-0">
              <div className="space-y-3">
                <Label>{t("graph.modeLabel")}</Label>
                <RadioGroup
                  value={graphMode}
                  onValueChange={(v) => setGraphMode(v as GraphMode)}
                  className="grid gap-3 sm:grid-cols-3"
                >
                  <div className="flex items-start space-x-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary">
                    <RadioGroupItem value="columnPair" id="mode-columnPair" />
                    <label htmlFor="mode-columnPair" className="cursor-pointer flex-1">
                      <span className="font-medium">{t("graph.modeColumnPair")}</span>
                      <p className="text-xs text-muted-foreground mt-1">{t("graph.modeColumnPairDesc")}</p>
                    </label>
                  </div>
                  <div className="flex items-start space-x-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary">
                    <RadioGroupItem value="property" id="mode-property" />
                    <label htmlFor="mode-property" className="cursor-pointer flex-1">
                      <span className="font-medium">{t("graph.modeProperty")}</span>
                      <p className="text-xs text-muted-foreground mt-1">{t("graph.modePropertyDesc")}</p>
                    </label>
                  </div>
                  <div className="flex items-start space-x-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary">
                    <RadioGroupItem value="bipartite" id="mode-bipartite" />
                    <label htmlFor="mode-bipartite" className="cursor-pointer flex-1">
                      <span className="font-medium">{t("graph.modeBipartite")}</span>
                      <p className="text-xs text-muted-foreground mt-1">{t("graph.modeBipartiteDesc")}</p>
                    </label>
                  </div>
                </RadioGroup>
              </div>

              {graphMode === "bipartite" ? (
                <div className="space-y-2">
                  <Label>{t("graph.valueColumn")}</Label>
                  <Select value={valueColumn} onValueChange={setValueColumn}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("graph.selectValueColumn")} />
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
              ) : (
                <div className="grid grid-cols-2 gap-4">
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
              )}
            </div>

            {sourceName && (
              <p className="text-xs text-muted-foreground">
                {t("graph.dataSource")}: {sourceName}
              </p>
            )}

            <div
              ref={containerRef}
              className={cn(
                "w-full rounded-lg border bg-background overflow-hidden",
                maximized ? "flex-1 min-h-0" : "min-h-[400px]"
              )}
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
                  width={graphSize.width}
                  height={graphSize.height}
                  nodeLabel="name"
                  nodeAutoColorBy={graphData.nodes.some((n) => n.group) ? "group" : "id"}
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
                  {graphMode === "bipartite"
                    ? (valueColumn ? t("graph.noEdges") : t("graph.selectValueColumn"))
                    : sourceColumn && targetColumn
                    ? t("graph.noEdges")
                    : t("graph.selectColumns")}
                </div>
              )}
            </div>

            {hasData && (
              <p className="text-xs text-muted-foreground shrink-0">
                {graphData.nodes.length} {t("graph.nodes")} · {graphData.links.length} {t("graph.links")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
