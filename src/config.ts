/**
 * Backend configuration.
 *
 * Resolution order:
 * 1. VITE_API_URL env variable (set by `make dev` or vite.config.ts proxy)
 * 2. Same origin (production: frontend served from backend on same port)
 * 3. Vite proxy fallback: in dev mode the Vite proxy forwards /api/* to the
 *    backend, so an empty string (relative URL) works transparently.
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export function getApiUrl(): string {
  const fromEnv = API_URL ? API_URL.replace(/\/$/, '') : '';
  if (fromEnv) return fromEnv;
  // When app is served from the backend (e.g. localhost:8000), use same origin.
  // In Vite dev mode with proxy, relative URLs ("/api/...") are proxied
  // automatically, so returning '' is correct.
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
