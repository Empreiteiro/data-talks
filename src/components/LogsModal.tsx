import { dataClient } from "@/services/dataClient";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, RefreshCw, Terminal, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

type LogEntry = {
  action: string;
  timestamp: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  source?: string;
  trace?: Record<string, unknown>;
};

interface LogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogsModal({ open, onOpenChange }: LogsModalProps) {
  const { t } = useLanguage();
  const { isAuthenticated, loginRequired } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!isAuthenticated && loginRequired) return;
    setLoading(true);
    setError(null);
    try {
      const data = await dataClient.listPlatformLogs(200);
      setLogs(data || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("logs.error"));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, loginRequired]);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  const actionLabel: Record<string, string> = {
    pergunta: t("logs.actionQuestion"),
    summary: t("logs.actionSummary"),
  };

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const toggleExpand = (idx: number) => setExpandedIdx((i) => (i === idx ? null : idx));

  const hasTrace = (log: LogEntry) => log.trace && Object.keys(log.trace).length > 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background border-t">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("logs.title")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {t("logs.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={t("logs.close")}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin mr-2" />
            {t("logs.loading")}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Terminal className="h-12 w-12 mb-4 opacity-50" />
                <p>{t("logs.empty")}</p>
                <p className="text-sm mt-1">{t("logs.emptyDescription")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-[120px]">{t("logs.action")}</TableHead>
                <TableHead className="w-[160px]">{t("logs.timestamp")}</TableHead>
                <TableHead>{t("logs.provider")}</TableHead>
                <TableHead>{t("logs.model")}</TableHead>
                <TableHead className="text-right">{t("logs.tokensIn")}</TableHead>
                <TableHead className="text-right">{t("logs.tokensOut")}</TableHead>
                <TableHead className="max-w-[200px]">{t("logs.source")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, idx) => (
                <React.Fragment key={idx}>
                  <TableRow
                    key={idx}
                    className={hasTrace(log) ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => hasTrace(log) && toggleExpand(idx)}
                  >
                    <TableCell className="w-8 py-2">
                      {hasTrace(log) ? (
                        expandedIdx === idx ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                    </TableCell>
                    <TableCell>
                    <Badge
                      variant={
                        log.action === "pergunta" ? "default" : "secondary"
                      }
                    >
                      {actionLabel[log.action] ?? log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatTimestamp(log.timestamp)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {log.provider || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {log.model || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {log.input_tokens ?? 0}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {log.output_tokens ?? 0}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {log.source || "—"}
                  </TableCell>
                </TableRow>
                {expandedIdx === idx && hasTrace(log) && log.trace && (
                  <TableRow key={`${idx}-detail`}>
                    <TableCell colSpan={8} className="bg-muted/30 p-4 align-top">
                      <div className="space-y-3">
                        {log.trace.reasoning && (
                          <div>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                              Reasoning
                            </h4>
                            <pre className="text-xs overflow-auto max-h-40 rounded border bg-background p-3 font-mono whitespace-pre-wrap break-words">
                              {String(log.trace.reasoning)}
                            </pre>
                          </div>
                        )}
                        {Array.isArray(log.trace.tool_calls) && log.trace.tool_calls.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                              Tool calls ({log.trace.tool_calls.length})
                            </h4>
                            <div className="space-y-2">
                              {log.trace.tool_calls.map((tc: { name?: string; args?: string }, i: number) => (
                                <div key={i} className="rounded border bg-background p-2 font-mono text-xs">
                                  <span className="text-primary font-medium">{tc.name || "?"}</span>
                                  {tc.args && (
                                    <pre className="mt-1 text-muted-foreground whitespace-pre-wrap break-words">
                                      {typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args)}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                            {t("logs.details")}
                          </h4>
                          <pre className="text-xs overflow-auto max-h-48 rounded border bg-background p-3 font-mono whitespace-pre-wrap break-words">
                            {JSON.stringify(log.trace, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}
