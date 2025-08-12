import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface User {
  id: string;
  email: string;
  name: string;
}

const cleanupAuthState = () => {
  try {
    localStorage.removeItem('supabase.auth.token');
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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
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
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    cleanupAuthState();
    try { await supabase.auth.signOut({ scope: "global" }); } catch {}
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    setSession(data.session);
    setUser(toSafeUser(data.session));
    return toSafeUser(data.session);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    cleanupAuthState();
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
  }, []);

  const logout = useCallback(async () => {
    cleanupAuthState();
    try { await supabase.auth.signOut({ scope: "global" }); } catch {}
    cleanupAuthState();
    window.location.href = "/login";
  }, []);

  return { user, session, isAuthenticated: !!session?.user, initializing, login, register, logout };
}
