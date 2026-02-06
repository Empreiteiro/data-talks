/**
 * Backend configuration.
 * When VITE_API_URL is set, the app uses the Python backend (no Supabase/Langflow).
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export function getApiUrl(): string | undefined {
  return API_URL ? API_URL.replace(/\/$/, '') : undefined;
}

export function usePythonBackend(): boolean {
  return !!getApiUrl();
}

const TOKEN_KEY = 'data_talks_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
