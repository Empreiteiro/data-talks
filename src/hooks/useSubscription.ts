import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface SubscriptionData {
  subscribed: boolean;
  subscription_tier?: string;
  subscription_end?: string;
  plan_type?: string;
}

interface CachedSubscriptionData extends SubscriptionData {
  cachedAt: number;
  userId: string;
}

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
const CACHE_KEY = 'subscription_cache';

export const useSubscription = () => {
  const { session, user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  const getCachedSubscription = useCallback((userId: string): SubscriptionData | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const parsedCache: CachedSubscriptionData = JSON.parse(cached);
      const now = Date.now();
      
      // Verifica se o cache é do mesmo usuário e ainda é válido
      if (parsedCache.userId === userId && (now - parsedCache.cachedAt) < CACHE_DURATION) {
        return {
          subscribed: parsedCache.subscribed,
          subscription_tier: parsedCache.subscription_tier,
          subscription_end: parsedCache.subscription_end,
          plan_type: parsedCache.plan_type,
        };
      }
    } catch (error) {
      console.warn('Error reading subscription cache:', error);
    }
    return null;
  }, []);

  const setCachedSubscription = useCallback((userId: string, data: SubscriptionData) => {
    try {
      const cacheData: CachedSubscriptionData = {
        ...data,
        cachedAt: Date.now(),
        userId,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Error saving subscription cache:', error);
    }
  }, []);

  const checkSubscription = useCallback(async (forceRefresh = false) => {
    if (!session?.access_token || !user?.id) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    // Verifica cache primeiro, a menos que seja um refresh forçado
    if (!forceRefresh) {
      const cached = getCachedSubscription(user.id);
      if (cached) {
        setSubscription(cached);
        setLoading(false);
        return;
      }
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;
      
      setSubscription(data);
      setCachedSubscription(user.id, data);
    } catch (error) {
      console.error('Error checking subscription:', error);
      const fallbackData = { subscribed: false };
      setSubscription(fallbackData);
      setCachedSubscription(user.id, fallbackData);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, user?.id, getCachedSubscription, setCachedSubscription]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  // Auto-refresh subscription status quando volta do Stripe (apenas se foi para uma URL do Stripe)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && session?.access_token) {
        // Só força refresh se o referrer contém "stripe"
        const fromStripe = document.referrer.includes('stripe') || 
                          window.location.search.includes('stripe') ||
                          sessionStorage.getItem('returning_from_stripe') === 'true';
        
        if (fromStripe) {
          sessionStorage.removeItem('returning_from_stripe');
          checkSubscription(true); // Força refresh após retorno do Stripe
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkSubscription, session?.access_token]);

  return {
    subscription,
    loading,
    checkSubscription,
    isPro: subscription?.subscribed && subscription?.subscription_tier === 'Pro'
  };
};