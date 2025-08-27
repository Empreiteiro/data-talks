
export interface PlanLimits {
  sources: number;
  agents: number;
  monthlyQuestions: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial: {
    sources: 2,
    agents: 2,
    monthlyQuestions: 20
  },
  pro: {
    sources: 5,
    agents: 10,
    monthlyQuestions: 1000
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
