import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Database, MessageSquare, Calendar } from "lucide-react";

interface UsageStats {
  sourcesCount: number;
  questionsCount: number;
  thisMonthQuestions: number;
}

const UsageMonitoring = () => {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState<UsageStats>({
    sourcesCount: 0,
    questionsCount: 0,
    thisMonthQuestions: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsageStats();
  }, []);

  const fetchUsageStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get sources count
      const { count: sourcesCount } = await supabase
        .from('sources')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get total questions count
      const { count: questionsCount } = await supabase
        .from('qa_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get this month's questions
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: thisMonthQuestions } = await supabase
        .from('qa_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startOfMonth.toISOString());

      setStats({
        sourcesCount: sourcesCount || 0,
        questionsCount: questionsCount || 0,
        thisMonthQuestions: thisMonthQuestions || 0
      });
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUsageStatus = (current: number, limit: number) => {
    const percentage = (current / limit) * 100;
    if (percentage >= 90) return { color: "destructive", text: language === 'pt' ? 'Crítico' : 'Critical' };
    if (percentage >= 70) return { color: "warning", text: language === 'pt' ? 'Alto' : 'High' };
    return { color: "secondary", text: language === 'pt' ? 'Normal' : 'Normal' };
  };

  const planLimits = {
    sources: 5,
    monthlyQuestions: 1000
  };

  const sourcesStatus = getUsageStatus(stats.sourcesCount, planLimits.sources);
  const questionsStatus = getUsageStatus(stats.thisMonthQuestions, planLimits.monthlyQuestions);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold">
          {language === 'pt' ? 'Monitoramento de Uso' : 'Usage Monitoring'}
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">
        {language === 'pt' ? 'Monitoramento de Uso' : 'Usage Monitoring'}
      </h2>
      
      <div className="grid gap-6 md:grid-cols-3">
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
                {language === 'pt' 
                  ? `${planLimits.sources - stats.sourcesCount} restantes` 
                  : `${planLimits.sources - stats.sourcesCount} remaining`
                }
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {language === 'pt' ? 'Perguntas (Este Mês)' : 'Questions (This Month)'}
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
                {language === 'pt' 
                  ? `${planLimits.monthlyQuestions - stats.thisMonthQuestions} restantes` 
                  : `${planLimits.monthlyQuestions - stats.thisMonthQuestions} remaining`
                }
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
            <Badge variant="default">Pro</Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{language === 'pt' ? 'Fontes de dados:' : 'Data sources:'}</span>
              <span>0/{planLimits.sources}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all" 
                style={{ width: `${(stats.sourcesCount / planLimits.sources) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{language === 'pt' ? 'Perguntas mensais:' : 'Monthly questions:'}</span>
              <span>{stats.thisMonthQuestions}/{planLimits.monthlyQuestions}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all" 
                style={{ width: `${(stats.thisMonthQuestions / planLimits.monthlyQuestions) * 100}%` }}
              ></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UsageMonitoring;