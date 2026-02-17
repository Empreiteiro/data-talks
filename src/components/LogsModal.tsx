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
import { RefreshCw, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

type LogEntry = {
  action: string;
  timestamp: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  context?: string;
};

interface LogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogsModal({ open, onOpenChange }: LogsModalProps) {
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
      setError(e instanceof Error ? e.message : "Erro ao carregar logs");
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
    pergunta: "Pergunta",
    summary: "Summary",
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background border-t">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Logs da plataforma</h2>
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
            Atualizar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
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
            Carregando logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Terminal className="h-12 w-12 mb-4 opacity-50" />
            <p>Nenhum log registrado ainda.</p>
            <p className="text-sm mt-1">
              Faça perguntas ou gere summaries para ver os logs aqui.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Ação</TableHead>
                <TableHead className="w-[160px]">Data/Hora</TableHead>
                <TableHead>Provedor</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Tokens in</TableHead>
                <TableHead className="text-right">Tokens out</TableHead>
                <TableHead className="max-w-[200px]">Contexto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, idx) => (
                <TableRow key={idx}>
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
                    {log.context || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}
