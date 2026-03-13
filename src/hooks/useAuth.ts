import { getApiUrl, getToken, setToken } from "@/config";
import { useCallback, useEffect, useState } from "react";

export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
}

export interface AuthSession {
  user: User;
}

const cleanupAuthState = () => {
  try {
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
  } catch { /* intentional */ }
};

const toUserFromApi = (u: { id: string; email?: string; role?: string }) => ({
  id: u.id,
  email: (u as { email?: string }).email ?? "",
  name: ((u as { email?: string }).email ?? "").split("@")[0] || "User",
  role: (u as { role?: string }).role ?? "user",
});

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);

  useEffect(() => {
    const base = getApiUrl();
    const token = getToken();
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
                setSession({ user: u });
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
                setSession({ user: u });
              }
            });
        }
        setUser(null);
        setSession(null);
      })
      .catch(() => {
        if (cancelled) return;
        // Don't clear token on network error – keep it so refresh restores session when backend is back
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
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    cleanupAuthState();
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
    setSession({ user: u });
    return u;
  }, []);

  const loginWithUsername = useCallback(async (username: string, password: string) => {
    cleanupAuthState();
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
    setSession({ user: u });
    return u;
  }, []);

  const register = useCallback(async (_name: string, email: string, password: string) => {
    cleanupAuthState();
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
    setSession({ user: u });
    return { user: u, session: { user: u }, requiresConfirmation: false };
  }, []);

  const logout = useCallback(async () => {
    cleanupAuthState();
    setToken(null);
    setUser(null);
    setSession(null);
    window.location.href = loginRequired ? "/" : "/";
  }, [loginRequired]);

  const requestPasswordReset = useCallback(async (_email: string) => {
    throw new Error("Password reset is not available in this version.");
  }, []);

  const updatePassword = useCallback(async (_newPassword: string) => {
    throw new Error("Password change is not available in this version.");
  }, []);

  return {
    user,
    session,
    isAuthenticated: !!user,
    isAdmin: !!user && user.role === "admin",
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
