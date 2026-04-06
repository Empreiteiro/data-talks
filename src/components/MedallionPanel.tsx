/**
 * MedallionPanel — AI-Assisted Bronze / Silver / Gold layer management.
 *
 * Opened from StudioPanel as a Dialog. Users can:
 * 1. Generate Bronze layer (raw staging)
 * 2. Get AI-suggested Silver schema, edit it, redo with feedback, then apply
 * 3. Get AI-suggested Gold aggregates, select which to materialize
 * 4. View all generated SQL and build history
 */
import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Layers,
  Database,
  Sparkles,
  Trophy,
  Loader2,
  RefreshCw,
  Check,
  AlertCircle,
  History,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import type {
  MedallionLayerOut,
  MedallionBuildLogOut,
  SilverColumnSuggestion,
  SilverSuggestResponse,
  GoldTableSuggestion,
  GoldSuggestResponse,
} from "@/services/apiClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceOption {
  id: string;
  name: string;
  type: string;
}

interface MedallionPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  sourceId?: string;
  sourceName?: string;
}

type LayerStatus = "none" | "pending" | "ready" | "error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: LayerStatus) {
  if (status === "ready")
    return <Badge variant="default" className="bg-green-600 text-white"><Check className="h-3 w-3 mr-1" /> Ready</Badge>;
  if (status === "pending")
    return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Building</Badge>;
  if (status === "error")
    return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Error</Badge>;
  return <Badge variant="outline">Not built</Badge>;
}

function SqlViewer({ label, sql }: { label: string; sql: string }) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            navigator.clipboard.writeText(sql);
            toast.info("SQL copied");
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto max-h-48 whitespace-pre-wrap font-mono">
        {sql}
      </pre>
    </div>
  );
}

const SQL_TYPES = ["TEXT", "INTEGER", "REAL", "BOOLEAN", "DATE", "TIMESTAMP", "DECIMAL"];
const TRANSFORMS = ["none", "trim", "lower_trim", "remove_commas", "strip_currency"];
const NULL_STRATEGIES = ["KEEP_NULL", "DROP_ROW", "FILL_ZERO", "FILL_DEFAULT"];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MedallionPanel({
  open,
  onOpenChange,
  agentId,
  sourceId,
  sourceName,
}: MedallionPanelProps) {
  const { t } = useLanguage();

  // Source selector (when sourceId prop is empty, loads from agent)
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState(sourceId || "");
  const [selectedSourceName, setSelectedSourceName] = useState(sourceName || "");
  const effectiveSourceId = sourceId || selectedSourceId;

  // Layer states
  const [layers, setLayers] = useState<MedallionLayerOut[]>([]);
  const [logs, setLogs] = useState<MedallionBuildLogOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("bronze");

  // Bronze
  const [bronzeLoading, setBronzeLoading] = useState(false);

  // Silver
  const [silverSuggestion, setSilverSuggestion] = useState<SilverSuggestResponse | null>(null);
  const [silverColumns, setSilverColumns] = useState<SilverColumnSuggestion[]>([]);
  const [silverDedupKey, setSilverDedupKey] = useState<string[]>([]);
  const [silverDedupOrder, setSilverDedupOrder] = useState<string>("");
  const [silverFeedback, setSilverFeedback] = useState("");
  const [silverLoading, setSilverLoading] = useState(false);
  const [silverApplying, setSilverApplying] = useState(false);

  // Gold
  const [goldSuggestion, setGoldSuggestion] = useState<GoldSuggestResponse | null>(null);
  const [goldSelected, setGoldSelected] = useState<Set<number>>(new Set());
  const [goldFeedback, setGoldFeedback] = useState("");
  const [goldLoading, setGoldLoading] = useState(false);
  const [goldApplying, setGoldApplying] = useState(false);

  // History panel
  const [showHistory, setShowHistory] = useState(false);

  // Derived statuses
  const bronzeLayer = layers.find((l) => l.layer === "bronze");
  const silverLayer = layers.find((l) => l.layer === "silver");
  const goldLayers = layers.filter((l) => l.layer === "gold");
  const bronzeStatus: LayerStatus = bronzeLayer?.status as LayerStatus || "none";
  const silverStatus: LayerStatus = silverLayer?.status as LayerStatus || "none";
  const goldStatus: LayerStatus = goldLayers.length > 0 ? "ready" : "none";

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  // Load sources when no sourceId prop
  useEffect(() => {
    if (!open || sourceId) return;
    (async () => {
      try {
        const list = await dataClient.listSources(agentId, true);
        const fileTypes = ["csv", "xlsx", "parquet", "json", "sqlite"];
        const filtered = (list || []).filter((s: { type: string }) => fileTypes.includes(s.type));
        setSources(filtered.map((s: { id: string; name: string; type: string }) => ({ id: s.id, name: s.name, type: s.type })));
        if (filtered.length === 1) {
          setSelectedSourceId(filtered[0].id);
          setSelectedSourceName(filtered[0].name);
        }
      } catch { /* silent */ }
    })();
  }, [open, agentId, sourceId]);

  const refresh = useCallback(async () => {
    if (!effectiveSourceId) return;
    setLoading(true);
    try {
      const [layerData, logData] = await Promise.all([
        dataClient.medallionListLayers(effectiveSourceId),
        dataClient.medallionListLogs(effectiveSourceId),
      ]);
      setLayers(layerData);
      setLogs(logData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [effectiveSourceId]);

  useEffect(() => {
    if (open && effectiveSourceId) refresh();
  }, [open, effectiveSourceId, refresh]);

  // ---------------------------------------------------------------------------
  // Bronze
  // ---------------------------------------------------------------------------

  async function handleGenerateBronze() {
    setBronzeLoading(true);
    try {
      await dataClient.medallionGenerateBronze({ sourceId: effectiveSourceId, agentId });
      toast.success("Bronze DDL generated");
      await refresh();
      setActiveTab("silver");
    } catch (e: unknown) {
      toast.error("Error generating bronze", { description: (e as Error)?.message });
    } finally {
      setBronzeLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Silver — suggest / edit / redo / apply
  // ---------------------------------------------------------------------------

  async function handleSuggestSilver(feedback?: string) {
    setSilverLoading(true);
    try {
      const result = await dataClient.medallionSuggestSilver({
        sourceId: effectiveSourceId,
        agentId,
        feedback: feedback || undefined,
      });
      setSilverSuggestion(result);
      setSilverColumns(result.suggestion.columns || []);
      setSilverDedupKey(result.suggestion.dedup_key || []);
      setSilverDedupOrder(result.suggestion.dedup_order_by || "");
      setSilverFeedback("");
      toast.success(feedback ? "Schema re-suggested with your feedback" : "Silver schema suggested");
      await refresh();
    } catch (e: unknown) {
      toast.error("Error suggesting silver schema", { description: (e as Error)?.message });
    } finally {
      setSilverLoading(false);
    }
  }

  function updateSilverColumn(idx: number, field: keyof SilverColumnSuggestion, value: string) {
    setSilverColumns((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  }

  function toggleDedupKey(col: string) {
    setSilverDedupKey((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  }

  async function handleApplySilver() {
    if (!silverSuggestion) return;
    setSilverApplying(true);
    try {
      await dataClient.medallionApplySilver({
        sourceId: effectiveSourceId,
        agentId,
        buildLogId: silverSuggestion.buildLogId,
        config: {
          columns: silverColumns,
          dedup_key: silverDedupKey,
          dedup_order_by: silverDedupOrder || null,
        },
      });
      toast.success("Silver schema saved");
      setSilverSuggestion(null);
      await refresh();
      setActiveTab("gold");
    } catch (e: unknown) {
      toast.error("Error applying silver layer", { description: (e as Error)?.message });
    } finally {
      setSilverApplying(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Gold — suggest / select / redo / apply
  // ---------------------------------------------------------------------------

  async function handleSuggestGold(feedback?: string) {
    setGoldLoading(true);
    try {
      const result = await dataClient.medallionSuggestGold({
        sourceId: effectiveSourceId,
        agentId,
        feedback: feedback || undefined,
      });
      setGoldSuggestion(result);
      setGoldSelected(new Set(result.suggestions.map((_, i) => i)));
      setGoldFeedback("");
      toast.success(feedback ? "Aggregates re-suggested with your feedback" : "Gold aggregates suggested");
      await refresh();
    } catch (e: unknown) {
      toast.error("Error suggesting gold aggregates", { description: (e as Error)?.message });
    } finally {
      setGoldLoading(false);
    }
  }

  function toggleGoldSelection(idx: number) {
    setGoldSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleApplyGold() {
    if (!goldSuggestion) return;
    setGoldApplying(true);
    try {
      const selected = goldSuggestion.suggestions.filter((_, i) => goldSelected.has(i));
      await dataClient.medallionApplyGold({
        sourceId: effectiveSourceId,
        agentId,
        buildLogId: goldSuggestion.buildLogId,
        selectedTables: selected,
      });
      toast.success("Gold SQL saved");
      setGoldSuggestion(null);
      await refresh();
    } catch (e: unknown) {
      toast.error("Error applying gold layers", { description: (e as Error)?.message });
    } finally {
      setGoldApplying(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] h-[780px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Medallion Architecture
          </DialogTitle>
          <DialogDescription>
            {selectedSourceName ? `Source: ${selectedSourceName}` : "Generate Bronze → Silver → Gold SQL suggestions"}
          </DialogDescription>
        </DialogHeader>

        {/* Source selector (when no sourceId prop) */}
        {!sourceId && sources.length > 1 && (
          <div className="px-1">
            <Select value={selectedSourceId} onValueChange={(v) => {
              setSelectedSourceId(v);
              setSelectedSourceName(sources.find(s => s.id === v)?.name || "");
              setLayers([]);
              setLogs([]);
              setSilverSuggestion(null);
              setGoldSuggestion(null);
            }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a data source..." />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!effectiveSourceId && sources.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No file-based sources found. Upload a CSV or XLSX file first.
          </div>
        )}

        {/* Progress indicators */}
        {effectiveSourceId && <><div className="flex items-center gap-2 px-1">
          <div className="flex items-center gap-1">
            <Database className="h-4 w-4" />
            <span className="text-xs">Bronze</span>
            {statusBadge(bronzeStatus)}
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-1">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs">Silver</span>
            {statusBadge(silverStatus)}
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-1">
            <Trophy className="h-4 w-4" />
            <span className="text-xs">Gold</span>
            {statusBadge(goldStatus)}
          </div>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4 mr-1" />
              {showHistory ? "Hide" : "History"}
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 flex gap-3">
          {/* Tabs area */}
          <div className={showHistory ? "flex-1 min-w-0" : "w-full"}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="bronze" className="flex-1">Bronze</TabsTrigger>
                <TabsTrigger value="silver" className="flex-1" disabled={bronzeStatus !== "ready"}>
                  Silver
                </TabsTrigger>
                <TabsTrigger value="gold" className="flex-1" disabled={silverStatus !== "ready"}>
                  Gold
                </TabsTrigger>
              </TabsList>

              {/* ─── Bronze Tab ─── */}
              <TabsContent value="bronze" className="flex-1 overflow-y-auto mt-3 space-y-4">
                {bronzeStatus === "none" ? (
                  <div className="text-center py-8 space-y-4">
                    <Database className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Generate a Bronze layer to stage raw data with metadata columns.
                    </p>
                    <Button onClick={handleGenerateBronze} disabled={bronzeLoading}>
                      {bronzeLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Generate Bronze Layer
                    </Button>
                  </div>
                ) : bronzeLayer ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">Table: </span>
                        <code className="text-sm bg-muted px-2 py-0.5 rounded">{bronzeLayer.tableName}</code>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {bronzeLayer.rowCount?.toLocaleString()} rows
                      </div>
                    </div>

                    {/* Columns list */}
                    {bronzeLayer.schemaConfig?.columns && (
                      <div>
                        <span className="text-xs text-muted-foreground font-medium">Columns ({(bronzeLayer.schemaConfig.columns as string[]).length})</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(bronzeLayer.schemaConfig.columns as string[]).map((col) => (
                            <Badge key={col} variant="outline" className="text-xs">{col}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Accordion type="single" collapsible>
                      <AccordionItem value="ddl">
                        <AccordionTrigger className="text-sm">View DDL SQL</AccordionTrigger>
                        <AccordionContent>
                          <SqlViewer label="CREATE TABLE" sql={bronzeLayer.ddlSql} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                ) : null}
              </TabsContent>

              {/* ─── Silver Tab ─── */}
              <TabsContent value="silver" className="flex-1 overflow-y-auto mt-3 space-y-4">
                {silverStatus === "ready" && silverLayer && !silverSuggestion ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">Table: </span>
                        <code className="text-sm bg-muted px-2 py-0.5 rounded">{silverLayer.tableName}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{silverLayer.rowCount?.toLocaleString()} rows</span>
                        <Button variant="outline" size="sm" onClick={() => handleSuggestSilver()}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Re-suggest
                        </Button>
                      </div>
                    </div>
                    <Accordion type="multiple">
                      <AccordionItem value="ddl">
                        <AccordionTrigger className="text-sm">View DDL SQL</AccordionTrigger>
                        <AccordionContent>
                          <SqlViewer label="CREATE TABLE" sql={silverLayer.ddlSql} />
                        </AccordionContent>
                      </AccordionItem>
                      {silverLayer.transformSql && (
                        <AccordionItem value="transform">
                          <AccordionTrigger className="text-sm">View Transform SQL</AccordionTrigger>
                          <AccordionContent>
                            <SqlViewer label="INSERT INTO ... SELECT" sql={silverLayer.transformSql} />
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>
                  </div>
                ) : !silverSuggestion ? (
                  <div className="text-center py-8 space-y-4">
                    <Sparkles className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      AI will analyze your data and suggest type casting, null handling, deduplication, and naming.
                    </p>
                    <Button onClick={() => handleSuggestSilver()} disabled={silverLoading}>
                      {silverLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Suggest Silver Schema
                    </Button>
                  </div>
                ) : (
                  /* Editable suggestion */
                  <div className="space-y-4">
                    {silverSuggestion.suggestion.explanation && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                        {silverSuggestion.suggestion.explanation}
                      </p>
                    )}

                    {/* Editable columns table */}
                    <ScrollArea className="max-h-[280px] border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[110px]">Source</TableHead>
                            <TableHead className="w-[110px]">Silver Name</TableHead>
                            <TableHead className="w-[100px]">Type</TableHead>
                            <TableHead className="w-[110px]">Transform</TableHead>
                            <TableHead className="w-[110px]">Nulls</TableHead>
                            <TableHead className="w-[50px]">Dedup</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {silverColumns.map((col, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs font-mono">{col.source_column}</TableCell>
                              <TableCell>
                                <Input
                                  className="h-7 text-xs"
                                  value={col.silver_name}
                                  onChange={(e) => updateSilverColumn(idx, "silver_name", e.target.value)}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={col.target_type}
                                  onValueChange={(v) => updateSilverColumn(idx, "target_type", v)}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SQL_TYPES.map((t) => (
                                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={col.transform || "none"}
                                  onValueChange={(v) => updateSilverColumn(idx, "transform", v)}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TRANSFORMS.map((tr) => (
                                      <SelectItem key={tr} value={tr} className="text-xs">{tr}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={col.null_strategy}
                                  onValueChange={(v) => updateSilverColumn(idx, "null_strategy", v)}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {NULL_STRATEGIES.map((s) => (
                                      <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={silverDedupKey.includes(col.source_column)}
                                  onCheckedChange={() => toggleDedupKey(col.source_column)}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>

                    {/* SQL Previews */}
                    <Accordion type="multiple">
                      <AccordionItem value="ddl-preview">
                        <AccordionTrigger className="text-sm">DDL Preview</AccordionTrigger>
                        <AccordionContent>
                          <SqlViewer label="CREATE TABLE" sql={silverSuggestion.ddlPreview} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="transform-preview">
                        <AccordionTrigger className="text-sm">Transform Preview</AccordionTrigger>
                        <AccordionContent>
                          <SqlViewer label="INSERT INTO ... SELECT" sql={silverSuggestion.transformPreview} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {/* Redo with feedback */}
                    <div className="border rounded-md p-3 space-y-2">
                      <span className="text-xs font-medium text-muted-foreground">Redo with feedback</span>
                      <div className="flex gap-2">
                        <Textarea
                          className="text-xs min-h-[60px]"
                          placeholder="e.g. Use DATE for date columns, rename 'amt' to 'amount_usd'..."
                          value={silverFeedback}
                          onChange={(e) => setSilverFeedback(e.target.value)}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSuggestSilver(silverFeedback)}
                        disabled={silverLoading || !silverFeedback.trim()}
                      >
                        {silverLoading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        <RefreshCw className="h-3 w-3 mr-1" /> Re-suggest
                      </Button>
                    </div>

                    {/* Save */}
                    <Button onClick={handleApplySilver} disabled={silverApplying} className="w-full">
                      {silverApplying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Save Silver Schema
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* ─── Gold Tab ─── */}
              <TabsContent value="gold" className="flex-1 overflow-y-auto mt-3 space-y-4">
                {/* Existing gold layers */}
                {goldLayers.length > 0 && !goldSuggestion && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{goldLayers.length} Gold table(s)</span>
                      <Button variant="outline" size="sm" onClick={() => handleSuggestGold()}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Suggest more
                      </Button>
                    </div>
                    {goldLayers.map((gl) => (
                      <Card key={gl.id} className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <code className="text-sm bg-muted px-2 py-0.5 rounded">{gl.tableName}</code>
                          <span className="text-xs text-muted-foreground">{gl.rowCount?.toLocaleString()} rows</span>
                        </div>
                        {gl.schemaConfig?.description && (
                          <p className="text-xs text-muted-foreground">{gl.schemaConfig.description as string}</p>
                        )}
                        <Accordion type="single" collapsible>
                          <AccordionItem value="sql">
                            <AccordionTrigger className="text-xs">View SQL</AccordionTrigger>
                            <AccordionContent>
                              <SqlViewer label="CREATE TABLE AS" sql={gl.ddlSql} />
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </Card>
                    ))}
                  </div>
                )}

                {/* No gold + no suggestion yet */}
                {goldLayers.length === 0 && !goldSuggestion && (
                  <div className="text-center py-8 space-y-4">
                    <Trophy className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      AI will suggest business aggregate tables based on your Silver schema.
                    </p>
                    <Button onClick={() => handleSuggestGold()} disabled={goldLoading}>
                      {goldLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Suggest Gold Aggregates
                    </Button>
                  </div>
                )}

                {/* Gold suggestions */}
                {goldSuggestion && (
                  <div className="space-y-3">
                    {goldSuggestion.suggestions.map((s, idx) => (
                      <Card
                        key={idx}
                        className={`p-3 cursor-pointer transition-colors ${
                          goldSelected.has(idx) ? "border-primary bg-primary/5" : ""
                        }`}
                        onClick={() => toggleGoldSelection(idx)}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={goldSelected.has(idx)}
                            onCheckedChange={() => toggleGoldSelection(idx)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{s.name}</span>
                              {s.dimensions?.map((d) => (
                                <Badge key={d} variant="outline" className="text-[10px]">{d}</Badge>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground">{s.description}</p>
                            {s.measures && (
                              <div className="flex gap-1 flex-wrap">
                                {s.measures.map((m, mi) => (
                                  <Badge key={mi} variant="secondary" className="text-[10px]">
                                    {m.agg_func}({m.column})
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <Accordion type="single" collapsible>
                              <AccordionItem value="sql">
                                <AccordionTrigger className="text-xs py-1">SQL</AccordionTrigger>
                                <AccordionContent>
                                  <pre className="bg-muted rounded p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
                                    {s.sql}
                                  </pre>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          </div>
                        </div>
                      </Card>
                    ))}

                    {/* Redo feedback */}
                    <div className="border rounded-md p-3 space-y-2">
                      <span className="text-xs font-medium text-muted-foreground">Redo with feedback</span>
                      <Textarea
                        className="text-xs min-h-[60px]"
                        placeholder="e.g. Add a weekly cohort analysis table, group revenue by product category..."
                        value={goldFeedback}
                        onChange={(e) => setGoldFeedback(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSuggestGold(goldFeedback)}
                        disabled={goldLoading || !goldFeedback.trim()}
                      >
                        {goldLoading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        <RefreshCw className="h-3 w-3 mr-1" /> Re-suggest
                      </Button>
                    </div>

                    <Button
                      onClick={handleApplyGold}
                      disabled={goldApplying || goldSelected.size === 0}
                      className="w-full"
                    >
                      {goldApplying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Save {goldSelected.size} Selected Table(s)
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Build history sidebar */}
          {showHistory && (
            <div className="w-72 border-l pl-3 flex flex-col">
              <span className="text-sm font-medium mb-2">Build History</span>
              <ScrollArea className="flex-1">
                <div className="space-y-2 pr-2">
                  {logs.map((entry) => (
                    <div key={entry.id} className="border rounded p-2 space-y-1">
                      <div className="flex items-center gap-1">
                        <Badge variant={entry.action === "apply" ? "default" : entry.action === "error" ? "destructive" : "secondary"} className="text-[10px]">
                          {entry.action}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{entry.layer}</Badge>
                      </div>
                      {entry.inputFeedback && (
                        <p className="text-[10px] text-muted-foreground italic">"{entry.inputFeedback}"</p>
                      )}
                      {entry.errorMessage && (
                        <p className="text-[10px] text-destructive">{entry.errorMessage}</p>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No history yet</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div></>}
      </DialogContent>
    </Dialog>
  );
}
