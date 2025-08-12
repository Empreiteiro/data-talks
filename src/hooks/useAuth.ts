import { useCallback, useEffect, useState } from "react";

export interface User {
  id: string;
  email: string;
  name: string;
}

const USERS_KEY = "demo_users";
const SESSION_KEY = "demo_session_user";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) setUser(JSON.parse(raw));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const users: Array<User & { password: string }> = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    const found = users.find((u) => u.email === email && u.password === password);
    if (!found) throw new Error("Credenciais inválidas");
    const { password: _p, ...safe } = found;
    localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
    setUser(safe);
    return safe;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const users: Array<User & { password: string }> = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    if (users.some((u) => u.email === email)) throw new Error("E-mail já cadastrado");
    const newUser: User & { password: string } = { id: uid(), name, email, password };
    users.push(newUser);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    const { password: _p, ...safe } = newUser;
    localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
    setUser(safe);
    return safe;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, []);

  return { user, isAuthenticated: !!user, login, register, logout };
}
