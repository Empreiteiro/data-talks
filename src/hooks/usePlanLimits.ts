
import { useState, useEffect } from 'react';
import { supabaseClient } from '@/services/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentPlanLimits, getPlanName, PlanLimits } from '@/utils/planLimits';
import { useSubscription } from '@/hooks/useSubscription';

interface UsageCounts {
  sources: number;
  agents: number;
  monthlyQuestions: number;
}

interface PlanLimitsData {
  limits: PlanLimits;
  usage: UsageCounts;
  planName: string;
  canCreateSource: boolean;
  canCreateAgent: boolean;
  canAskQuestion: boolean;
  isLoading: boolean;
}

export const usePlanLimits = (): PlanLimitsData => {
  const { user } = useAuth();
  const { subscription, loading: subscriptionLoading } = useSubscription();
  const [usage, setUsage] = useState<UsageCounts>({
    sources: 0,
    agents: 0,
    monthlyQuestions: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  const subscribed = subscription?.subscribed || false;
  const subscription_tier = subscription?.subscription_tier;
  
  const limits = getCurrentPlanLimits(subscribed, subscription_tier);
  const planName = getPlanName(subscribed, subscription_tier);

  const fetchUsage = async () => {
    if (!user) return;

    try {
      setIsLoading(true);

      // Buscar contagem de fontes
      const sourcesResult = await supabaseClient.listSources();
      const sourcesCount = sourcesResult.length;

      // Buscar contagem de agentes
      const agentsResult = await supabaseClient.listAgents();
      const agentsCount = agentsResult.length;

      // Buscar contagem de perguntas do mês atual
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const qaResult = await supabaseClient.listQASessions();
      const monthlyQuestions = qaResult.filter(qa => 
        new Date(qa.created_at) >= startOfMonth
      ).length;

      setUsage({
        sources: sourcesCount,
        agents: agentsCount,
        monthlyQuestions
      });
    } catch (error) {
      console.error('Error fetching usage:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!subscriptionLoading) {
      fetchUsage();
    }
  }, [user, subscribed, subscription_tier, subscriptionLoading]);

  return {
    limits,
    usage,
    planName,
    canCreateSource: usage.sources < limits.sources,
    canCreateAgent: usage.agents < limits.agents,
    canAskQuestion: usage.monthlyQuestions < limits.monthlyQuestions,
    isLoading: isLoading || subscriptionLoading
  };
};
