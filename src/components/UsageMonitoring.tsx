import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Database, MessageSquare, Calendar, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

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

  useEffect(() => {
    fetchUsageStats();
  }, [user?.id]);

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
  return <div className="space-y-6">
      
      
      <div className="grid gap-6 md:grid-cols-4">
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

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>
            {language === 'pt' ? 'Perguntas por Dia' : 'Questions per Day'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          {dailyQuestions.length > 0 ? (
            <ChartContainer
              config={{
                count: {
                  label: language === 'pt' ? 'Perguntas' : 'Questions',
                  color: "hsl(var(--primary))",
                },
              }}
              className="h-full min-h-[400px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyQuestions}>
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
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-full min-h-[400px] flex items-center justify-center text-muted-foreground">
              {language === 'pt' ? 'Nenhuma pergunta nos últimos 30 dias' : 'No questions in the last 30 days'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>;
};
export default UsageMonitoring;