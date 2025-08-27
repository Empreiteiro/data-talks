const CACHE_KEY = 'subscription_cache';

export const clearSubscriptionCache = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.warn('Error clearing subscription cache:', error);
  }
};

export const hasValidCache = (userId: string): boolean => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return false;

    const parsedCache = JSON.parse(cached);
    const now = Date.now();
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas
    
    return parsedCache.userId === userId && (now - parsedCache.cachedAt) < CACHE_DURATION;
  } catch (error) {
    return false;
  }
};