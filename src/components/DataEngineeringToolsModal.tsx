/**
 * DataEngineeringToolsModal — AI-powered data engineering tools.
 * Schema docs, quality tests, ERD, query analysis, transformation mapping,
 * incremental strategy, ETL docs, data catalog.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiUrl, getToken } from "@/config";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

async function deApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = getApiUrl();
  const res = await fetch(`${base}/api/data-engineering${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

const TOOLS = [
  { id: "schema-docs", label: "Schema Documentation", description: "Generate data dictionary with column descriptions", needsContext: false },
  { id: "quality-tests", label: "Data Quality Tests", description: "Generate tests (SQL, dbt, Great Expectations)", needsContext: false, contextLabel: "Format", contextPlaceholder: "sql | dbt | great_expectations | soda" },
  { id: "erd", label: "ERD & Relationships", description: "Discover relationships and generate ER diagram", needsContext: false },
  { id: "query-analysis", label: "Query Analyzer", description: "Analyze SQL for performance and anti-patterns", needsContext: true, contextLabel: "SQL to analyze", contextPlaceholder: "Paste your SQL query here..." },
  { id: "transformation-mapping", label: "Transformation Mapping", description: "Map source columns to target schema", needsContext: false, contextLabel: "Target schema (optional)", contextPlaceholder: "Describe or paste target schema..." },
  { id: "incremental-strategy", label: "Incremental Strategy", description: "Recommend loading strategy per table", needsContext: false },
  { id: "etl-docs", label: "ETL Documentation", description: "Reverse-engineer SQL into natural language docs", needsContext: true, contextLabel: "SQL/ETL code", contextPlaceholder: "Paste your SQL, stored procedure, or dbt model..." },
  { id: "catalog", label: "Data Catalog", description: "Generate asset inventory with lineage graph", needsContext: false },
] as const;

type ToolId = typeof TOOLS[number]["id"];

interface DataEngineeringToolsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

export function DataEngineeringToolsModal({ open, onOpenChange, agentId }: DataEngineeringToolsModalProps) {
  const { language } = useLanguage();
  const [selectedTool, setSelectedTool] = useState<ToolId | "">("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const tool = TOOLS.find((t) => t.id === selectedTool);

  async function handleRun() {
    if (!selectedTool) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await deApi<{ content: string }>(`/${selectedTool}`, {
        agentId,
        language,
        context: context.trim() || undefined,
      });
      setResult(data.content);
      toast.success("Generated!");
    } catch (err: unknown) {
      toast.error("Failed", { description: (err as Error)?.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Data Engineering Tools
          </DialogTitle>
          <DialogDescription>
            AI-powered tools for schema documentation, quality testing, ERD, and more.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* Tool selector */}
          <div className="flex gap-3 shrink-0">
            <div className="flex-1">
              <Select value={selectedTool} onValueChange={(v) => { setSelectedTool(v as ToolId); setResult(null); setContext(""); }}>
                <SelectTrigger className="focus:ring-0 focus:ring-offset-0">
                  <SelectValue placeholder="Select a tool..." />
                </SelectTrigger>
                <SelectContent>
                  {TOOLS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="font-medium">{t.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">— {t.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Context input (for tools that need SQL/text input) */}
          {tool && tool.needsContext && (
            <div className="space-y-1 shrink-0">
              <Label className="text-xs">{tool.contextLabel}</Label>
              <Textarea
                className="text-sm min-h-[100px] font-mono"
                placeholder={tool.contextPlaceholder}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                disabled={loading}
              />
            </div>
          )}

          {/* Optional context for non-required tools */}
          {tool && !tool.needsContext && tool.contextLabel && (
            <div className="space-y-1 shrink-0">
              <Label className="text-xs">{tool.contextLabel}</Label>
              <Textarea
                className="text-sm min-h-[60px]"
                placeholder={tool.contextPlaceholder}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                disabled={loading}
              />
            </div>
          )}

          {/* Run button */}
          {selectedTool && (
            <Button
              variant="outline"
              className="w-full shrink-0"
              onClick={handleRun}
              disabled={loading || (tool?.needsContext && !context.trim())}
            >
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : <><Sparkles className="h-4 w-4 mr-2" />Generate</>}
            </Button>
          )}

          {/* Result */}
          {result && (
            <ScrollArea className="flex-1 border rounded-lg p-4">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
              </div>
            </ScrollArea>
          )}

          {!selectedTool && !result && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a tool to get started.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
