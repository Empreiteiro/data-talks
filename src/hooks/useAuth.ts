import { getApiUrl, getToken, setToken } from "@/config";
import { useCallback, useEffect, useState } from "react";

export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  /** The caller's role in the active organization (viewer|member|admin|owner).
   *  Distinct from `role`, which is the legacy admin/user superuser flag. */
  activeRole?: string;
  /** The caller's currently-active organization id, driven by the JWT
   *  `org_id` claim. Switching orgs reissues the JWT. */
  activeOrganizationId?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  role: string;
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

const toUserFromApi = (
  u: { id: string; email?: string; role?: string; organization_id?: string },
  extra: { activeRole?: string; activeOrganizationId?: string } = {},
): User => ({
  id: u.id,
  email: (u as { email?: string }).email ?? "",
  name: ((u as { email?: string }).email ?? "").split("@")[0] || "User",
  role: (u as { role?: string }).role ?? "user",
  activeRole: extra.activeRole,
  activeOrganizationId:
    extra.activeOrganizationId ?? (u as { organization_id?: string }).organization_id,
});

/** The backend `/api/auth/me` response changed shape with multi-tenancy. New
 *  shape: `{ user, organizations, active_organization_id, active_role }`.
 *  Old shape: `{ id, email, role, organization_id }`. Handle both so a
 *  partial rollout doesn't break. */
const parseMe = (
  data: Record<string, unknown>,
): { user: User; orgs: Organization[]; activeOrgId: string | undefined } => {
  if (data && typeof data === "object" && "user" in data && "organizations" in data) {
    const userPayload = data.user as {
      id: string;
      email?: string;
      role?: string;
      organization_id?: string;
    };
    const orgs = (data.organizations as Organization[]) || [];
    const activeOrgId = (data.active_organization_id as string | undefined) ?? undefined;
    const activeRole = (data.active_role as string | undefined) ?? undefined;
    return {
      user: toUserFromApi(userPayload, { activeOrganizationId: activeOrgId, activeRole }),
      orgs,
      activeOrgId,
    };
  }
  // Legacy flat shape.
  return { user: toUserFromApi(data as { id: string; email?: string; role?: string }), orgs: [], activeOrgId: undefined };
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | undefined>(undefined);

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
                const { user: u, orgs, activeOrgId } = parseMe(data);
                setUser(u);
                setSession({ user: u });
                setOrganizations(orgs);
                setActiveOrganizationId(activeOrgId);
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
                const { user: u, orgs, activeOrgId } = parseMe(data);
                setUser(u);
                setSession({ user: u });
                setOrganizations(orgs);
                setActiveOrganizationId(activeOrgId);
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
    const u = toUserFromApi(data.user, {
      activeOrganizationId: data.active_organization_id,
    });
    setUser(u);
    setSession({ user: u });
    if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
    if (data.active_organization_id) setActiveOrganizationId(data.active_organization_id);
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
    const u = toUserFromApi(data.user, {
      activeOrganizationId: data.active_organization_id,
    });
    setUser(u);
    setSession({ user: u });
    if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
    if (data.active_organization_id) setActiveOrganizationId(data.active_organization_id);
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
    const u = toUserFromApi(data.user, {
      activeOrganizationId: data.active_organization_id,
    });
    setUser(u);
    setSession({ user: u });
    if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
    if (data.active_organization_id) setActiveOrganizationId(data.active_organization_id);
    return { user: u, session: { user: u }, requiresConfirmation: false };
  }, []);

  /** Re-issue the JWT bound to a different organization the caller is a
   *  member of, then reload so every React Query cache refetches under the
   *  new tenant. */
  const switchOrganization = useCallback(async (organizationId: string) => {
    const token = getToken();
    const res = await fetch(`${getApiUrl()}/api/auth/switch-org`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to switch organization");
    }
    const data = await res.json();
    setToken(data.access_token);
    const u = toUserFromApi(data.user, {
      activeOrganizationId: data.active_organization_id,
    });
    setUser(u);
    setSession({ user: u });
    if (Array.isArray(data.organizations)) setOrganizations(data.organizations);
    if (data.active_organization_id) setActiveOrganizationId(data.active_organization_id);
    // Targeted react-query invalidation would require every hook to key
    // on activeOrganizationId — too invasive for this PR. A hard reload
    // guarantees a clean cache under the new tenant.
    window.location.reload();
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
    organizations,
    activeOrganizationId,
    /** Current membership role in the active org. Useful for conditionally
     *  rendering owner/admin-only actions in the UI. */
    activeRole: user?.activeRole,
    login,
    loginWithUsername,
    register,
    logout,
    switchOrganization,
    requestPasswordReset,
    updatePassword,
  };
}
