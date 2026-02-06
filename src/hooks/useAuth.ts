import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { usePythonBackend, getApiUrl, getToken, setToken } from "@/config";

export interface User {
  id: string;
  email: string;
  name: string;
}

const cleanupAuthState = () => {
  try {
    localStorage.removeItem('supabase.auth.token');
    setToken(null);
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
        localStorage.removeItem(key);
      }
    });
    if (typeof sessionStorage !== "undefined") {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
          sessionStorage.removeItem(key);
        }
      });
    }
  } catch {}
};

const toSafeUser = (session: Session | null): User | null => {
  const u = session?.user;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || "",
    name: (u.user_metadata && (u.user_metadata.name as string)) || (u.email ? u.email.split("@")[0] : ""),
  };
};

const toUserFromApi = (u: { id: string; email: string }) => ({
  id: u.id,
  email: u.email,
  name: u.email ? u.email.split("@")[0] : "",
});

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const useApi = usePythonBackend();

  useEffect(() => {
    if (useApi) {
      const token = getToken();
      const base = getApiUrl()!;
      const timeoutMs = 12000;
      let cancelled = false;
      const timer = setTimeout(() => {
        if (cancelled) return;
        cancelled = true;
        setLoginRequired(true);
        setUser(null);
        setSession(null);
        setInitializing(false);
      }, timeoutMs);
      fetch(`${base}/api/config`)
        .then((r) => (r.ok ? r.json() : { loginRequired: true }))
        .then((config: { loginRequired?: boolean }) => {
          if (cancelled) return;
          setLoginRequired(!!config.loginRequired);
          if (token) {
            return fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (cancelled) return;
                if (data) {
                  const u = toUserFromApi(data);
                  setUser(u);
                  setSession({ user: u } as Session);
                } else {
                  setToken(null);
                  setUser(null);
                  setSession(null);
                }
              });
          }
          if (!config.loginRequired) {
            return fetch(`${base}/api/auth/me`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (cancelled) return;
                if (data) {
                  const u = toUserFromApi(data);
                  setUser(u);
                  setSession({ user: u } as Session);
                }
              });
          }
          setUser(null);
          setSession(null);
        })
        .catch(() => {
          if (cancelled) return;
          setToken(null);
          setUser(null);
          setSession(null);
          setLoginRequired(true);
        })
        .finally(() => {
          if (cancelled) return;
          cancelled = true;
          clearTimeout(timer);
          setInitializing(false);
        });
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(toSafeUser(s));
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(toSafeUser(s));
      setInitializing(false);
    });

    return () => subscription.unsubscribe();
  }, [useApi]);

  const login = useCallback(async (email: string, password: string) => {
    cleanupAuthState();
    if (useApi) {
      const res = await fetch(`${getApiUrl()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Login failed");
      }
      const data = await res.json();
      setToken(data.access_token);
      const u = toUserFromApi(data.user);
      setUser(u);
      setSession({ user: u } as Session);
      return u;
    }
    try { await supabase.auth.signOut({ scope: "global" }); } catch {}
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    setSession(data.session);
    setUser(toSafeUser(data.session));
    return toSafeUser(data.session);
  }, [useApi]);

  const loginWithUsername = useCallback(async (username: string, password: string) => {
    cleanupAuthState();
    if (!useApi) throw new Error("Username login only supported with Python backend");
    const res = await fetch(`${getApiUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Login failed");
    }
    const data = await res.json();
    setToken(data.access_token);
    const u = toUserFromApi(data.user);
    setUser(u);
    setSession({ user: u } as Session);
    return u;
  }, [useApi]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    cleanupAuthState();
    if (useApi) {
      const res = await fetch(`${getApiUrl()}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Registration failed");
      }
      const data = await res.json();
      setToken(data.access_token);
      const u = toUserFromApi(data.user);
      setUser(u);
      setSession({ user: u } as Session);
      return { user: u, session: { user: u }, requiresConfirmation: false };
    }
    try { await supabase.auth.signOut({ scope: "global" }); } catch {}
    const redirectUrl = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: redirectUrl
      }
    });
    if (error) throw new Error(error.message);
    if (data.session) {
      setSession(data.session);
      setUser(toSafeUser(data.session));
    }
    return { user: toSafeUser(data.session), session: data.session, requiresConfirmation: !data.session };
  }, [useApi]);

  const logout = useCallback(async () => {
    cleanupAuthState();
    try { localStorage.removeItem('subscription_cache'); } catch {}
    if (useApi) {
      setToken(null);
      setUser(null);
      setSession(null);
      window.location.href = loginRequired ? "/login" : "/";
      return;
    }
    try { await supabase.auth.signOut({ scope: "global" }); } catch {}
    cleanupAuthState();
    window.location.href = "/login";
  }, [useApi, loginRequired]);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (useApi) throw new Error("Password reset not available on Python backend.");
    const redirectUrl = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });
    if (error) throw new Error(error.message);
  }, [useApi]);

  const updatePassword = useCallback(async (newPassword: string) => {
    if (useApi) throw new Error("Password change not available on Python backend.");
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });
    if (error) throw new Error(error.message);
  }, [useApi]);

  return {
    user,
    session,
    isAuthenticated: !!user,
    initializing,
    loginRequired,
    login,
    loginWithUsername,
    register,
    logout,
    requestPasswordReset,
    updatePassword,
  };
}
