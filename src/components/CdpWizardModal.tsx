/**
 * CdpWizardModal — AI-assisted CDP setup wizard.
 * Steps: Identity Resolution → Enrichment → Segmentation
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Check, ChevronRight, Database, Loader2, Sparkles, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiUrl, getToken } from "@/config";

// Simple API helper for CDP endpoints
async function cdpApi<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const base = getApiUrl();
  const url = `${base}/api/cdp${path}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

interface CdpWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

type Step = "identity" | "enrichment" | "segmentation";

function SqlViewer({ sql }: { sql: string }) {
  return (
    <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto max-h-48 whitespace-pre-wrap font-mono mt-2">
      {sql}
    </pre>
  );
}

export function CdpWizardModal({ open, onOpenChange, agentId }: CdpWizardModalProps) {
  const { language } = useLanguage();

  const [currentStep, setCurrentStep] = useState<Step>("identity");
  const [loading, setLoading] = useState(false);

  // Results from each step
  const [identityResult, setIdentityResult] = useState<Record<string, unknown> | null>(null);
  const [enrichmentResult, setEnrichmentResult] = useState<Record<string, unknown> | null>(null);
  const [segmentationResult, setSegmentationResult] = useState<Record<string, unknown> | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [materializedResult, setMaterializedResult] = useState<{ sourceName: string; rowCount: number; columns: string[] } | null>(null);

  // Load saved config on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const config = await cdpApi<Record<string, unknown>>(`/config/${agentId}`);
        if (config?.identity_resolution) setIdentityResult(config.identity_resolution as Record<string, unknown>);
        if (config?.enrichment) setEnrichmentResult(config.enrichment as Record<string, unknown>);
        if (config?.segmentation) setSegmentationResult(config.segmentation as Record<string, unknown>);
        // Jump to the latest incomplete step
        if (config?.segmentation) setCurrentStep("segmentation");
        else if (config?.enrichment) setCurrentStep("segmentation");
        else if (config?.identity_resolution) setCurrentStep("enrichment");
      } catch { /* silent — first time, no config */ }
    })();
  }, [open, agentId]);

  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: "identity", label: "Identity Resolution", done: !!identityResult },
    { id: "enrichment", label: "Enrichment", done: !!enrichmentResult },
    { id: "segmentation", label: "Segmentation", done: !!segmentationResult },
  ];

  async function runIdentityResolution() {
    setLoading(true);
    try {
      const result = await cdpApi<Record<string, unknown>>("/identity-resolution", { agentId, language });
      setIdentityResult(result);
      toast.success("Identity resolution suggested");
    } catch (err: unknown) {
      toast.error("Failed", { description: (err as Error)?.message });
    } finally {
      setLoading(false);
    }
  }

  async function runEnrichment() {
    setLoading(true);
    try {
      const result = await cdpApi<Record<string, unknown>>("/enrichment", { agentId, language, unifiedSchema: identityResult });
      setEnrichmentResult(result);
      toast.success("Enrichment metrics suggested");
    } catch (err: unknown) {
      toast.error("Failed", { description: (err as Error)?.message });
    } finally {
      setLoading(false);
    }
  }

  async function runSegmentation() {
    setLoading(true);
    try {
      const result = await cdpApi<Record<string, unknown>>("/segmentation", { agentId, language, enrichedSchema: enrichmentResult });
      setSegmentationResult(result);
      toast.success("Segmentation rules suggested");
    } catch (err: unknown) {
      toast.error("Failed", { description: (err as Error)?.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleMaterialize(sql: string, tableName: string) {
    setMaterializing(true);
    try {
      const result = await cdpApi<{ sourceName: string; rowCount: number; columns: string[] }>("/materialize", {
        agentId, sql, tableName,
      });
      setMaterializedResult(result);
      toast.success(`Table "${result.sourceName}" created with ${result.rowCount} rows`);
    } catch (err: unknown) {
      toast.error("Failed to materialize", { description: (err as Error)?.message });
    } finally {
      setMaterializing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            CDP Wizard
          </DialogTitle>
          <DialogDescription>
            Build your Customer Data Platform step by step with AI assistance.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 shrink-0">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <button
                onClick={() => setCurrentStep(step.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                  currentStep === step.id
                    ? "bg-primary text-primary-foreground"
                    : step.done
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {step.done && <Check className="h-3 w-3" />}
                {step.label}
              </button>
            </div>
          ))}
        </div>

        {/* Step content */}
        <ScrollArea className="flex-1">
          {/* Identity Resolution */}
          {currentStep === "identity" && (
            <div className="space-y-4 p-1">
              <p className="text-sm text-muted-foreground">
                AI will analyze your data sources and suggest how to unify customer records by matching emails, phone numbers, or other identifiers.
              </p>

              <Button variant="outline" className="w-full" onClick={runIdentityResolution} disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing sources...</> : <><Sparkles className="h-4 w-4 mr-2" />Suggest Identity Resolution</>}
              </Button>

              {identityResult && (
                <div className="space-y-3">
                  {identityResult.join_key && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Join key:</span>
                      <Badge>{String(identityResult.join_key)}</Badge>
                    </div>
                  )}
                  {identityResult.join_strategy && (
                    <p className="text-sm text-muted-foreground">{String(identityResult.join_strategy)}</p>
                  )}
                  {identityResult.explanation && (
                    <p className="text-sm italic text-muted-foreground">{String(identityResult.explanation)}</p>
                  )}
                  {Array.isArray(identityResult.source_mappings) && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Source mappings:</span>
                      {(identityResult.source_mappings as Array<Record<string, unknown>>).map((m, i) => (
                        <div key={i} className="text-xs bg-muted rounded px-2 py-1">
                          {String(m.source)} → key: <strong>{String(m.key_column)}</strong>
                          {Array.isArray(m.extra_keys) && (m.extra_keys as string[]).length > 0 && ` (+ ${(m.extra_keys as string[]).join(", ")})`}
                        </div>
                      ))}
                    </div>
                  )}
                  {identityResult.silver_sql && (
                    <>
                      <Accordion type="single" collapsible>
                        <AccordionItem value="sql">
                          <AccordionTrigger className="text-xs">View SQL</AccordionTrigger>
                          <AccordionContent><SqlViewer sql={String(identityResult.silver_sql)} /></AccordionContent>
                        </AccordionItem>
                      </Accordion>
                      <Button variant="outline" className="w-full" onClick={() => handleMaterialize(String(identityResult.silver_sql), "unified_customers")} disabled={materializing}>
                        {materializing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Materializing...</> : <><Database className="h-4 w-4 mr-2" />Materialize: unified_customers.csv</>}
                      </Button>
                    </>
                  )}
                  <Button className="w-full" onClick={() => setCurrentStep("enrichment")}>
                    Next: Enrichment <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Enrichment */}
          {currentStep === "enrichment" && (
            <div className="space-y-4 p-1">
              <p className="text-sm text-muted-foreground">
                AI will suggest customer metrics to calculate: LTV, purchase frequency, recency, RFM score, and more.
              </p>

              <Button variant="outline" className="w-full" onClick={runEnrichment} disabled={loading || !identityResult}>
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Suggesting metrics...</> : <><Sparkles className="h-4 w-4 mr-2" />Suggest Enrichment Metrics</>}
              </Button>

              {!identityResult && (
                <p className="text-sm text-destructive">Complete Identity Resolution first.</p>
              )}

              {enrichmentResult && (
                <div className="space-y-3">
                  {Array.isArray(enrichmentResult.metrics) && (
                    <div className="space-y-1">
                      {(enrichmentResult.metrics as Array<Record<string, unknown>>).map((m, i) => (
                        <div key={i} className="border rounded p-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{String(m.name)}</Badge>
                            <span className="text-xs text-muted-foreground">{String(m.description)}</span>
                          </div>
                          <code className="text-[10px] text-muted-foreground mt-1 block">{String(m.sql_expression)}</code>
                        </div>
                      ))}
                    </div>
                  )}
                  {enrichmentResult.explanation && (
                    <p className="text-sm italic text-muted-foreground">{String(enrichmentResult.explanation)}</p>
                  )}
                  {enrichmentResult.gold_sql && (
                    <>
                      <Accordion type="single" collapsible>
                        <AccordionItem value="sql">
                          <AccordionTrigger className="text-xs">View SQL</AccordionTrigger>
                          <AccordionContent><SqlViewer sql={String(enrichmentResult.gold_sql)} /></AccordionContent>
                        </AccordionItem>
                      </Accordion>
                      <Button variant="outline" className="w-full" onClick={() => handleMaterialize(String(enrichmentResult.gold_sql), "enriched_customers")} disabled={materializing}>
                        {materializing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Materializing...</> : <><Database className="h-4 w-4 mr-2" />Materialize: enriched_customers.csv</>}
                      </Button>
                    </>
                  )}
                  <Button className="w-full" onClick={() => setCurrentStep("segmentation")}>
                    Next: Segmentation <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Segmentation */}
          {currentStep === "segmentation" && (
            <div className="space-y-4 p-1">
              <p className="text-sm text-muted-foreground">
                AI will suggest customer segments based on your enriched data: VIP, At-risk, New customers, and more.
              </p>

              <Button variant="outline" className="w-full" onClick={runSegmentation} disabled={loading || !enrichmentResult}>
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Suggesting segments...</> : <><Users className="h-4 w-4 mr-2" />Suggest Segmentation</>}
              </Button>

              {!enrichmentResult && (
                <p className="text-sm text-destructive">Complete Enrichment first.</p>
              )}

              {segmentationResult && (
                <div className="space-y-3">
                  {Array.isArray(segmentationResult.segments) && (
                    <div className="space-y-2">
                      {(segmentationResult.segments as Array<Record<string, unknown>>).map((s, i) => (
                        <div key={i} className="border rounded p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge>{String(s.name)}</Badge>
                            <span className="text-xs text-muted-foreground">{String(s.description)}</span>
                          </div>
                          <code className="text-[10px] bg-muted rounded px-2 py-1 block">{String(s.rule_sql)}</code>
                        </div>
                      ))}
                    </div>
                  )}
                  {segmentationResult.explanation && (
                    <p className="text-sm italic text-muted-foreground">{String(segmentationResult.explanation)}</p>
                  )}
                  {segmentationResult.segment_sql && (
                    <>
                      <Accordion type="single" collapsible>
                        <AccordionItem value="sql">
                          <AccordionTrigger className="text-xs">View SQL</AccordionTrigger>
                          <AccordionContent><SqlViewer sql={String(segmentationResult.segment_sql)} /></AccordionContent>
                        </AccordionItem>
                      </Accordion>
                      <Button variant="outline" className="w-full" onClick={() => handleMaterialize(String(segmentationResult.segment_sql), "customer_segments")} disabled={materializing}>
                        {materializing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Materializing...</> : <><Database className="h-4 w-4 mr-2" />Materialize: customer_segments.csv</>}
                      </Button>
                    </>
                  )}
                  {materializedResult && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3">
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        ✅ Table "{materializedResult.sourceName}" created — {materializedResult.rowCount} rows, {materializedResult.columns.length} columns
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Available in your workspace sources for Q&A analysis.
                      </p>
                    </div>
                  )}
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3">
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                      ✅ CDP configuration complete! All SQL suggestions are saved.
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      You can now use the Q&A chat to ask questions about your customer data, or configure alerts for segment changes.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
