
export interface PlanLimits {
  sources: number;
  agents: number;
  monthlyQuestions: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial: {
    sources: 999,
    agents: 999,
    monthlyQuestions: 999999
  },
  pro: {
    sources: 999,
    agents: 999,
    monthlyQuestions: 999999
  }
};

export const getCurrentPlanLimits = (subscribed: boolean, tier?: string): PlanLimits => {
  if (subscribed && tier === 'Pro') {
    return PLAN_LIMITS.pro;
  }
  return PLAN_LIMITS.trial;
};

export const getPlanName = (subscribed: boolean, tier?: string): string => {
  if (subscribed && tier === 'Pro') {
    return 'Pro';
  }
  return 'Trial';
};
