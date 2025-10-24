import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { Database, MessageSquare, Calendar, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { getCurrentPlanLimits, getPlanName } from "@/utils/planLimits";

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
  const {
    t,
    language
  } = useLanguage();
  const {
    subscription,
    loading: subscriptionLoading
  } = useSubscription();
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
  }, []);
  const fetchUsageStats = async () => {
    try {
      const {
        data: {
          user
        }
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get sources count
      const {
        count: sourcesCount
      } = await supabase.from('sources').select('*', {
        count: 'exact',
        head: true
      }).eq('user_id', user.id);

      // Get agents count
      const {
        count: agentsCount
      } = await supabase.from('agents').select('*', {
        count: 'exact',
        head: true
      }).eq('user_id', user.id);

      // Get total questions count
      const {
        count: questionsCount
      } = await supabase.from('qa_sessions').select('*', {
        count: 'exact',
        head: true
      }).eq('user_id', user.id);

      // Get this month's questions
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const {
        count: thisMonthQuestions
      } = await supabase.from('qa_sessions').select('*', {
        count: 'exact',
        head: true
      }).eq('user_id', user.id).gte('created_at', startOfMonth.toISOString());

      // Get daily questions for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: questionsData } = await supabase
        .from('qa_sessions')
        .select('created_at')
        .eq('user_id', user.id)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      // Create array with all 30 days
      const dailyMap = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('pt-BR', { 
          day: '2-digit', 
          month: '2-digit' 
        });
        dailyMap.set(dateStr, 0);
      }

      // Fill in the actual question counts
      questionsData?.forEach((q) => {
        const date = new Date(q.created_at).toLocaleDateString('pt-BR', { 
          day: '2-digit', 
          month: '2-digit' 
        });
        dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
      });

      const dailyData = Array.from(dailyMap.entries()).map(([date, count]) => ({
        date,
        count
      }));

      setStats({
        sourcesCount: sourcesCount || 0,
        agentsCount: agentsCount || 0,
        questionsCount: questionsCount || 0,
        thisMonthQuestions: thisMonthQuestions || 0
      });
      setDailyQuestions(dailyData);
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    } finally {
      setLoading(false);
    }
  };
  const getUsageStatus = (current: number, limit: number) => {
    const percentage = current / limit * 100;
    if (percentage >= 90) return {
      color: "destructive",
      text: language === 'pt' ? 'Crítico' : 'Critical'
    };
    if (percentage >= 70) return {
      color: "warning",
      text: language === 'pt' ? 'Alto' : 'High'
    };
    return {
      color: "secondary",
      text: language === 'pt' ? 'Normal' : 'Normal'
    };
  };

  // Determine plan limits based on subscription status
  const isPro = subscription?.subscribed && subscription?.subscription_tier === 'Pro';
  const planLimits = getCurrentPlanLimits(subscription?.subscribed || false, subscription?.subscription_tier);
  const planName = getPlanName(subscription?.subscribed || false, subscription?.subscription_tier);
  const sourcesStatus = getUsageStatus(stats.sourcesCount, planLimits.sources);
  const agentsStatus = getUsageStatus(stats.agentsCount, planLimits.agents);
  const questionsStatus = getUsageStatus(stats.thisMonthQuestions, planLimits.monthlyQuestions);
  if (loading || subscriptionLoading) {
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
              {stats.sourcesCount}/{planLimits.sources}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={sourcesStatus.color as any}>
                {sourcesStatus.text}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {language === 'pt' ? `${planLimits.sources - stats.sourcesCount} restantes` : `${planLimits.sources - stats.sourcesCount} remaining`}
              </p>
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
              {stats.agentsCount}/{planLimits.agents}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={agentsStatus.color as any}>
                {agentsStatus.text}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {language === 'pt' ? `${planLimits.agents - stats.agentsCount} restantes` : `${planLimits.agents - stats.agentsCount} remaining`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Perguntas' : 'Questions'}
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.thisMonthQuestions}/{planLimits.monthlyQuestions}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={questionsStatus.color as any}>
                {questionsStatus.text}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {language === 'pt' ? `${planLimits.monthlyQuestions - stats.thisMonthQuestions} restantes` : `${planLimits.monthlyQuestions - stats.thisMonthQuestions} remaining`}
              </p>
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
            {language === 'pt' ? 'Informações do Plano' : 'Plan Information'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">
              {language === 'pt' ? 'Plano Atual:' : 'Current Plan:'}
            </span>
            <Badge variant={isPro ? "default" : "secondary"}>{planName}</Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{language === 'pt' ? 'Fontes de dados:' : 'Data sources:'}</span>
              <span>{stats.sourcesCount}/{planLimits.sources}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all" style={{
              width: `${Math.min(stats.sourcesCount / planLimits.sources * 100, 100)}%`
            }}></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{language === 'pt' ? 'Workspaces:' : 'Workspaces:'}</span>
              <span>{stats.agentsCount}/{planLimits.agents}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all" style={{
              width: `${Math.min(stats.agentsCount / planLimits.agents * 100, 100)}%`
            }}></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{language === 'pt' ? 'Perguntas mensais:' : 'Monthly questions:'}</span>
              <span>{stats.thisMonthQuestions}/{planLimits.monthlyQuestions}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all" style={{
              width: `${Math.min(stats.thisMonthQuestions / planLimits.monthlyQuestions * 100, 100)}%`
            }}></div>
            </div>
          </div>
        </CardContent>
      </Card>

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