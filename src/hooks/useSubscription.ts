import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";

interface SubscriptionData {
  subscribed: boolean;
  subscription_tier?: string;
  subscription_end?: string;
  plan_type?: string;
}


export const useSubscription = () => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionData | null>({ subscribed: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setSubscription({ subscribed: false });
    } else {
      setSubscription(null);
    }
    setLoading(false);
  }, [user]);

  const checkSubscription = async (_forceRefresh = false) => {
    if (user) setSubscription({ subscribed: false });
  };

  return {
    subscription,
    loading,
    checkSubscription,
    isPro: false,
  };
};
