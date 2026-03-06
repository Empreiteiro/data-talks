/**
 * Backend configuration.
 * When VITE_API_URL is set (or app is served from backend), use the Python API (no Supabase).
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export function getApiUrl(): string {
  const fromEnv = API_URL ? API_URL.replace(/\/$/, '') : '';
  if (fromEnv) return fromEnv;
  // Dev: if we're on localhost:8080 (Vite), assume backend is on 8000 (avoids 404 when .env.local not loaded yet)
  if (typeof window !== 'undefined' && window.location?.origin === 'http://localhost:8080') return 'http://localhost:8000';
  // When app is served from the backend (e.g. localhost:8000), use same origin
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

export function usePythonBackend(): boolean {
  return true;
}

const TOKEN_KEY = 'data_talks_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
