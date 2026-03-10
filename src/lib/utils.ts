import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Derives a safe display label from a SQL connection string (no password). */
export function getConnectionStringLabel(conn: string): string {
  if (!conn?.trim()) return '';
  const normalized = conn.trim();
  const m = normalized.match(/^(postgresql|mysql|postgres):\/\/(?:[^@]+@)?([^/?#]+)(\/[^?#]*)?/i);
  if (m) {
    const proto = m[1].toLowerCase();
    const host = m[2];
    const path = (m[3] || '').replace(/^\//, '');
    return `${proto} @ ${host}${path ? '/' + path : ''}`;
  }
  return normalized.length > 40 ? '...' + normalized.slice(-35) : normalized;
}
