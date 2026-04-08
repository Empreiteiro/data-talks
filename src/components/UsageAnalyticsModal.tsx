/**
 * UsageAnalyticsModal — Token consumption, cost estimation, and usage breakdown.
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
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartRenderer, type ChartSpec } from "@/components/ChartRenderer";
import { Activity, DollarSign, Hash, Loader2, Zap } from "lucide-react";
import { getApiUrl, getToken } from "@/config";

async function usageApi<T>(path: string): Promise<T> {
  const base = getApiUrl();
  const res = await fetch(`${base}/api/usage${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

interface UsageSummary {
  period_days: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

interface ProviderUsage {
  provider: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

interface ActionUsage {
  action: string;
  channel: string | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

interface DailyUsage {
  day: string;
  calls: number;
  total_tokens: number;
}

interface UsageAnalyticsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function UsageAnalyticsModal({ open, onOpenChange }: UsageAnalyticsModalProps) {
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [byProvider, setByProvider] = useState<ProviderUsage[]>([]);
  const [byAction, setByAction] = useState<ActionUsage[]>([]);
  const [byModel, setByModel] = useState<ModelUsage[]>([]);
  const [daily, setDaily] = useState<DailyUsage[]>([]);

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open, days]);

  async function loadData() {
    setLoading(true);
    try {
      const d = Number(days);
      const [s, p, a, m, dl] = await Promise.all([
        usageApi<UsageSummary>(`/summary?days=${d}`),
        usageApi<ProviderUsage[]>(`/by-provider?days=${d}`),
        usageApi<ActionUsage[]>(`/by-action?days=${d}`),
        usageApi<ModelUsage[]>(`/by-model?days=${d}`),
        usageApi<DailyUsage[]>(`/daily?days=${d}`),
      ]);
      setSummary(s);
      setByProvider(p);
      setByAction(a);
      setByModel(m);
      setDaily(dl);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  // Build chart specs
  const dailyChart: ChartSpec | null = daily.length > 0 ? {
    chartType: "line",
    title: "Daily Token Usage",
    categories: daily.map((d) => d.day.slice(5)),  // MM-DD
    series: [{ name: "Tokens", values: daily.map((d) => d.total_tokens) }],
  } : null;

  const providerChart: ChartSpec | null = byProvider.length > 0 ? {
    chartType: "bar",
    title: "Usage by Provider",
    categories: byProvider.map((p) => p.provider),
    series: [{ name: "Tokens", values: byProvider.map((p) => p.total_tokens) }],
  } : null;

  const actionChart: ChartSpec | null = byAction.length > 0 ? {
    chartType: "bar",
    title: "Usage by Action",
    categories: byAction.map((a) => `${a.action}${a.channel ? ` (${a.channel})` : ""}`),
    series: [{ name: "Tokens", values: byAction.map((a) => a.total_tokens) }],
  } : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Usage Analytics
          </DialogTitle>
          <DialogDescription>
            Token consumption and cost estimation across all AI operations.
          </DialogDescription>
        </DialogHeader>

        {/* Period selector */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Period:</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-32 h-8 focus:ring-0 focus:ring-offset-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : summary ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Total Calls</span>
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(summary.total_calls)}</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Total Tokens</span>
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(summary.total_tokens)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatNumber(summary.total_input_tokens)} in / {formatNumber(summary.total_output_tokens)} out
                  </p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Est. Cost</span>
                  </div>
                  <p className="text-2xl font-bold">${summary.estimated_cost_usd.toFixed(2)}</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Avg/Day</span>
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(Math.round(summary.total_tokens / summary.period_days))}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">tokens/day</p>
                </Card>
              </div>

              {/* Daily chart */}
              {dailyChart && (
                <Card className="p-4">
                  <ChartRenderer spec={dailyChart} />
                </Card>
              )}

              {/* Provider + Action charts */}
              <div className="grid grid-cols-2 gap-3">
                {providerChart && (
                  <Card className="p-4">
                    <ChartRenderer spec={providerChart} />
                  </Card>
                )}
                {actionChart && (
                  <Card className="p-4">
                    <ChartRenderer spec={actionChart} />
                  </Card>
                )}
              </div>

              {/* Model breakdown table */}
              {byModel.length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Usage by Model</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Provider</th>
                        <th className="text-left p-2">Model</th>
                        <th className="text-right p-2">Calls</th>
                        <th className="text-right p-2">Tokens</th>
                        <th className="text-right p-2">Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2"><Badge variant="outline" className="text-[10px]">{m.provider}</Badge></td>
                          <td className="p-2 font-mono text-[10px]">{m.model}</td>
                          <td className="p-2 text-right">{m.calls.toLocaleString()}</td>
                          <td className="p-2 text-right">{formatNumber(m.total_tokens)}</td>
                          <td className="p-2 text-right">${m.estimated_cost_usd.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {/* Action breakdown table */}
              {byAction.length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Usage by AI Action</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Action</th>
                        <th className="text-left p-2">Channel</th>
                        <th className="text-right p-2">Calls</th>
                        <th className="text-right p-2">Input Tokens</th>
                        <th className="text-right p-2">Output Tokens</th>
                        <th className="text-right p-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAction.map((a, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{a.action}</td>
                          <td className="p-2"><Badge variant="outline" className="text-[10px]">{a.channel || "—"}</Badge></td>
                          <td className="p-2 text-right">{a.calls.toLocaleString()}</td>
                          <td className="p-2 text-right">{formatNumber(a.input_tokens)}</td>
                          <td className="p-2 text-right">{formatNumber(a.output_tokens)}</td>
                          <td className="p-2 text-right font-medium">{formatNumber(a.total_tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No usage data available.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
