import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { dataClient } from "@/services/dataClient";
import { getApiUrl, getToken } from "@/config";
import { Activity, Calendar, Database, DollarSign, MessageSquare, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

async function usageApi<T>(path: string): Promise<T> {
  const base = getApiUrl();
  const res = await fetch(`${base}/api/usage${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface UsageStats {
  sourcesCount: number;
  agentsCount: number;
  questionsCount: number;
  thisMonthQuestions: number;
}

interface DailyQuestion {
  date: string;
  count: number;
}
const UsageMonitoring = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [stats, setStats] = useState<UsageStats>({
    sourcesCount: 0,
    agentsCount: 0,
    questionsCount: 0,
    thisMonthQuestions: 0
  });
  const [dailyQuestions, setDailyQuestions] = useState<DailyQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Usage data
  const [aiSummary, setAiSummary] = useState<{ total_calls: number; total_tokens: number; estimated_cost_usd: number; total_input_tokens: number; total_output_tokens: number } | null>(null);
  const [aiByProvider, setAiByProvider] = useState<Array<{ provider: string; calls: number; total_tokens: number; estimated_cost_usd: number }>>([]);
  const [aiByAction, setAiByAction] = useState<Array<{ action: string; channel: string | null; calls: number; total_tokens: number }>>([]);
  const [aiByModel, setAiByModel] = useState<Array<{ provider: string; model: string; calls: number; total_tokens: number; estimated_cost_usd: number }>>([]);

  useEffect(() => {
    fetchUsageStats();
    fetchAiUsage();
  }, [user?.id]);

  const fetchAiUsage = async () => {
    try {
      const [s, p, a, m] = await Promise.all([
        usageApi<typeof aiSummary>("/summary?days=30"),
        usageApi<typeof aiByProvider>("/by-provider?days=30"),
        usageApi<typeof aiByAction>("/by-action?days=30"),
        usageApi<typeof aiByModel>("/by-model?days=30"),
      ]);
      setAiSummary(s);
      setAiByProvider(p || []);
      setAiByAction(a || []);
      setAiByModel(m || []);
    } catch { /* silent */ }
  };

  const fetchUsageStats = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const [sourcesList, agentsList, sessionsList] = await Promise.all([
        dataClient.listSources(),
        dataClient.listAgents(),
        dataClient.listQASessions(),
      ]);

      const sourcesCount = sourcesList.length;
      const agentsCount = agentsList.length;
      const questionsCount = sessionsList.length;

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const sessionsWithDate = sessionsList as { created_at?: string }[];
      const thisMonthQuestions = sessionsWithDate.filter(
        (s) => s.created_at && new Date(s.created_at) >= startOfMonth
      ).length;

      const dailyMap = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        dailyMap.set(dateStr, 0);
      }
      sessionsWithDate.forEach((s) => {
        if (!s.created_at) return;
        const d = new Date(s.created_at);
        if (d < thirtyDaysAgo) return;
        const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
      });

      setStats({
        sourcesCount,
        agentsCount,
        questionsCount,
        thisMonthQuestions,
      });
      setDailyQuestions(Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })));
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    } finally {
      setLoading(false);
    }
  };
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  // Normal block flow inside the Account page's `overflow-y-auto` scroll
  // container. The previous `h-full flex flex-col` layout combined with a
  // `flex-1` chart card greedily consumed remaining height — fine when the
  // chart was the only thing below the stat cards, but as soon as the AI
  // Usage section was rendered underneath the chart card pushed up and
  // overlapped it. Pure stacked sections solve the issue.
  return <div className="space-y-4">

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Fontes de Dados' : 'Data Sources'}
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.sourcesCount}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Workspaces' : 'Workspaces'}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.agentsCount}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Perguntas no mês' : 'Questions this month'}
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.thisMonthQuestions}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Total de Perguntas' : 'Total Questions'}
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.questionsCount}</div>
            <p className="text-xs text-muted-foreground mt-2">
              {language === 'pt' ? 'Desde o início' : 'Since the beginning'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {language === 'pt' ? 'Perguntas por Dia' : 'Questions per Day'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 px-2 sm:px-4">
          {dailyQuestions.length > 0 ? (
            <ChartContainer
              config={{
                count: {
                  label: language === 'pt' ? 'Perguntas' : 'Questions',
                  color: "hsl(var(--primary))",
                },
              }}
              className="w-full h-[260px] sm:h-[320px] md:h-[360px]"
            >
              <BarChart data={dailyQuestions} margin={{ top: 10, right: 24, bottom: 28, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar 
                  dataKey="count" 
                  fill="hsl(var(--primary))" 
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="h-[260px] sm:h-[320px] md:h-[360px] flex items-center justify-center text-muted-foreground">
              {language === 'pt' ? 'Nenhuma pergunta nos últimos 30 dias' : 'No questions in the last 30 days'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Usage Section */}
      {aiSummary && aiSummary.total_calls > 0 && (
        <>
          <h3 className="text-sm font-semibold pt-2">
            {language === 'pt' ? 'Uso de IA (últimos 30 dias)' : 'AI Usage (last 30 days)'}
          </h3>

          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{language === 'pt' ? 'Chamadas IA' : 'AI Calls'}</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{fmtNum(aiSummary.total_calls)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tokens</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtNum(aiSummary.total_tokens)}</div>
                <p className="text-xs text-muted-foreground">{fmtNum(aiSummary.total_input_tokens)} in / {fmtNum(aiSummary.total_output_tokens)} out</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{language === 'pt' ? 'Custo Est.' : 'Est. Cost'}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">${aiSummary.estimated_cost_usd.toFixed(2)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{language === 'pt' ? 'Provedores' : 'Providers'}</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{aiByProvider.length}</div></CardContent>
            </Card>
          </div>

          {/* By Model table */}
          {aiByModel.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">{language === 'pt' ? 'Uso por Modelo' : 'Usage by Model'}</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b">
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Model</th>
                    <th className="text-right p-2">{language === 'pt' ? 'Chamadas' : 'Calls'}</th>
                    <th className="text-right p-2">Tokens</th>
                    <th className="text-right p-2">{language === 'pt' ? 'Custo' : 'Cost'}</th>
                  </tr></thead>
                  <tbody>
                    {aiByModel.map((m, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2"><Badge variant="outline" className="text-[10px]">{m.provider}</Badge></td>
                        <td className="p-2 font-mono text-[10px]">{m.model}</td>
                        <td className="p-2 text-right">{m.calls.toLocaleString()}</td>
                        <td className="p-2 text-right">{fmtNum(m.total_tokens)}</td>
                        <td className="p-2 text-right">${m.estimated_cost_usd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* By Action table */}
          {aiByAction.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">{language === 'pt' ? 'Uso por Ação' : 'Usage by AI Action'}</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b">
                    <th className="text-left p-2">{language === 'pt' ? 'Ação' : 'Action'}</th>
                    <th className="text-left p-2">Channel</th>
                    <th className="text-right p-2">{language === 'pt' ? 'Chamadas' : 'Calls'}</th>
                    <th className="text-right p-2">Tokens</th>
                  </tr></thead>
                  <tbody>
                    {aiByAction.map((a, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{a.action}</td>
                        <td className="p-2"><Badge variant="outline" className="text-[10px]">{a.channel || "—"}</Badge></td>
                        <td className="p-2 text-right">{a.calls.toLocaleString()}</td>
                        <td className="p-2 text-right">{fmtNum(a.total_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>;
};
export default UsageMonitoring;