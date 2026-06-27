import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, Code2, Copy } from "lucide-react";
import { useState } from "react";

interface GeneratedSqlPanelProps {
  sql: string;
  /** "sql" (default) or "python" — drives the label and copy affordance. */
  lang?: string;
  t: (key: string) => string;
  className?: string;
}

/**
 * Collapsible, copyable panel that surfaces the query the AI generated for an
 * answer (SQL for most sources, pandas for document stores). Collapsed by
 * default so it stays non-intrusive, letting analysts audit or reuse the
 * underlying logic without leaving the chat. Implements issue #219.
 */
export function GeneratedSqlPanel({ sql, lang = "sql", t, className }: GeneratedSqlPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const trimmed = (sql || "").trim();
  if (!trimmed) return null;

  const isPython = lang === "python";
  const title = isPython ? t("workspace.generatedCode") : t("workspace.generatedSql");

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission);
      // fail silently rather than disrupting the chat.
    }
  };

  return (
    <div className={cn("mt-2 overflow-hidden rounded-lg border border-border/60 bg-background/60", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
          <Code2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          title={t("workspace.copySql")}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("workspace.sqlCopied") : t("workspace.copySql")}
        </Button>
      </div>
      {expanded && (
        <pre className="max-h-72 overflow-auto border-t border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed">
          <code className="whitespace-pre font-mono text-foreground">{trimmed}</code>
        </pre>
      )}
    </div>
  );
}
