/**
 * EtlPipelineModal — AI-assisted ETL pipeline builder.
 * Create pipelines, add transforms, view lineage.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowRight, GitMerge, Loader2, Network, Plus, Route, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiUrl, getToken } from "@/config";

async function etlApi<T>(path: string, method = "GET", body?: Record<string, unknown>): Promise<T> {
  const base = getApiUrl();
  const url = `${base}/api/etl${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  steps: Array<{ id: string; name: string; type: string; sql: string; description: string; depends_on?: string[]; source?: string }>;
  schedule?: string;
  explanation?: string;
}

interface LineageGraph {
  nodes: Array<{ id: string; name: string; type: string }>;
  edges: Array<{ from: string; to: string }>;
}

interface EtlPipelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function EtlPipelineModal({ open, onOpenChange, agentId }: EtlPipelineModalProps) {
  const { language } = useLanguage();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [lineage, setLineage] = useState<LineageGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"pipelines" | "lineage">("pipelines");

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pipelineDesc, setPipelineDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Transform form
  const [showTransformForm, setShowTransformForm] = useState(false);
  const [transformDesc, setTransformDesc] = useState("");
  const [generatingTransform, setGeneratingTransform] = useState(false);
  const [lastTransform, setLastTransform] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!open) return;
    loadPipelines();
  }, [open, agentId]);

  async function loadPipelines() {
    try {
      const data = await etlApi<Pipeline[]>(`/pipelines/${agentId}`);
      setPipelines(data || []);
    } catch { /* silent */ }
  }

  async function loadLineage() {
    try {
      const data = await etlApi<LineageGraph>(`/lineage/${agentId}`);
      setLineage(data);
    } catch { /* silent */ }
  }

  async function handleCreatePipeline() {
    if (!pipelineDesc.trim()) return;
    setCreating(true);
    try {
      const result = await etlApi<Pipeline>("/pipeline/suggest", "POST", {
        agentId, description: pipelineDesc.trim(), language,
      });
      setPipelines((prev) => [...prev, result]);
      setPipelineDesc("");
      setShowCreateForm(false);
      toast.success("Pipeline created");
    } catch (err: unknown) {
      toast.error("Failed to create pipeline", { description: (err as Error)?.message });
    } finally {
      setCreating(false);
    }
  }

  async function handleDeletePipeline(pipelineId: string) {
    try {
      await etlApi(`/pipelines/${agentId}/${pipelineId}`, "DELETE");
      setPipelines((prev) => prev.filter((p) => p.id !== pipelineId));
      toast.success("Pipeline deleted");
    } catch {
      toast.error("Failed to delete pipeline");
    }
  }

  async function handleSuggestTransform() {
    if (!transformDesc.trim()) return;
    setGeneratingTransform(true);
    try {
      const result = await etlApi<Record<string, unknown>>("/transform/suggest", "POST", {
        agentId, description: transformDesc.trim(), language,
      });
      setLastTransform(result);
      toast.success("Transform generated");
    } catch (err: unknown) {
      toast.error("Failed", { description: (err as Error)?.message });
    } finally {
      setGeneratingTransform(false);
    }
  }

  const NODE_COLORS: Record<string, string> = {
    source: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    extract: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    transform: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    load: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            ETL Pipeline Builder
          </DialogTitle>
          <DialogDescription>
            Design data pipelines with AI assistance.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex rounded-md bg-muted p-1 shrink-0">
          <button onClick={() => setTab("pipelines")} className={`flex-1 text-sm font-medium py-2 rounded-sm transition-all ${tab === "pipelines" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Pipelines ({pipelines.length})
          </button>
          <button onClick={() => { setTab("lineage"); loadLineage(); }} className={`flex-1 text-sm font-medium py-2 rounded-sm transition-all ${tab === "lineage" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Lineage
          </button>
          <button onClick={() => { setTab("pipelines"); setShowTransformForm(!showTransformForm); }} className={`flex-1 text-sm font-medium py-2 rounded-sm transition-all text-muted-foreground hover:text-foreground`}>
            Transforms
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-2">
          {/* Pipelines tab */}
          {tab === "pipelines" && (
            <div className="space-y-3">
              {/* Create CTA */}
              {!showCreateForm ? (
                <Button variant="outline" className="w-full" onClick={() => setShowCreateForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />Create Pipeline with AI
                </Button>
              ) : (
                <div className="border rounded-md p-4 space-y-3">
                  <Label className="text-sm font-medium">Describe your pipeline</Label>
                  <Textarea className="text-sm min-h-[70px]" placeholder="e.g. 'Load sales data, clean it, calculate daily revenue aggregates'" value={pipelineDesc} onChange={(e) => setPipelineDesc(e.target.value)} disabled={creating} autoFocus />
                  <div className="flex gap-2">
                    <Button onClick={handleCreatePipeline} disabled={creating || !pipelineDesc.trim()}>
                      {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><Sparkles className="h-4 w-4 mr-2" />Create Pipeline</>}
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowCreateForm(false); setPipelineDesc(""); }}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Transform generator */}
              {!showTransformForm ? (
                <Button variant="outline" className="w-full" onClick={() => setShowTransformForm(true)}>
                  <GitMerge className="h-4 w-4 mr-2" />Generate Transform with AI
                </Button>
              ) : (
                <div className="border rounded-md p-4 space-y-3">
                  <Label className="text-sm font-medium">Describe the transformation</Label>
                  <Textarea className="text-sm min-h-[60px]" placeholder="e.g. 'Clean email column, deduplicate by customer_id'" value={transformDesc} onChange={(e) => setTransformDesc(e.target.value)} disabled={generatingTransform} />
                  <div className="flex gap-2">
                    <Button onClick={handleSuggestTransform} disabled={generatingTransform || !transformDesc.trim()}>
                      {generatingTransform ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : <><Sparkles className="h-4 w-4 mr-2" />Generate</>}
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowTransformForm(false); setTransformDesc(""); setLastTransform(null); }}>Cancel</Button>
                  </div>
                  {lastTransform && (
                    <div className="border rounded p-3 space-y-2 mt-2">
                      <span className="text-sm font-medium">{String(lastTransform.name || "Transform")}</span>
                      <p className="text-xs text-muted-foreground">{String(lastTransform.description || "")}</p>
                      <pre className="bg-muted rounded p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">{String(lastTransform.sql || "")}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Pipeline list */}
              {pipelines.length === 0 && !showCreateForm && (
                <div className="text-center py-8">
                  <Route className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No pipelines yet. Create one to get started.</p>
                </div>
              )}

              {pipelines.map((pipeline) => (
                <div key={pipeline.id} className="border rounded-md group">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{pipeline.name}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{pipeline.description}</p>
                      {pipeline.schedule && (
                        <Badge variant="outline" className="text-[10px] mt-1">{pipeline.schedule}</Badge>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive" onClick={() => handleDeletePipeline(pipeline.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Pipeline steps */}
                  <div className="px-4 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {pipeline.steps.map((step, i) => (
                        <div key={step.id} className="flex items-center gap-1">
                          {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                          <Badge className={`text-[10px] ${NODE_COLORS[step.type] || "bg-muted"}`}>{step.name}</Badge>
                        </div>
                      ))}
                    </div>

                    <Accordion type="single" collapsible>
                      <AccordionItem value="steps" className="border-0">
                        <AccordionTrigger className="text-xs py-1">Step details</AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2">
                            {pipeline.steps.map((step) => (
                              <div key={step.id} className="border rounded p-2 space-y-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[9px]">{step.type}</Badge>
                                  <span className="text-xs font-medium">{step.name}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">{step.description}</p>
                                <pre className="bg-muted rounded p-1.5 text-[9px] font-mono overflow-x-auto whitespace-pre-wrap">{step.sql}</pre>
                              </div>
                            ))}
                          </div>
                          {pipeline.explanation && (
                            <p className="text-xs italic text-muted-foreground mt-2">{pipeline.explanation}</p>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lineage tab */}
          {tab === "lineage" && (
            <div className="space-y-3">
              {!lineage || (lineage.nodes.length === 0) ? (
                <div className="text-center py-8">
                  <Network className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">Create pipelines to see the data lineage graph.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">{lineage.nodes.length} nodes, {lineage.edges.length} edges</p>

                  {/* Simple visual lineage */}
                  <div className="space-y-2">
                    {lineage.nodes.map((node) => {
                      const inEdges = lineage.edges.filter((e) => e.to === node.id);
                      const outEdges = lineage.edges.filter((e) => e.from === node.id);
                      return (
                        <div key={node.id} className="border rounded p-3">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] ${NODE_COLORS[node.type] || "bg-muted"}`}>{node.type}</Badge>
                            <span className="text-sm font-medium">{node.name}</span>
                          </div>
                          {inEdges.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              ← from: {inEdges.map((e) => lineage.nodes.find((n) => n.id === e.from)?.name || e.from).join(", ")}
                            </p>
                          )}
                          {outEdges.length > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              → to: {outEdges.map((e) => lineage.nodes.find((n) => n.id === e.to)?.name || e.to).join(", ")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
