/**
 * Legacy in-memory token store. Access tokens are never persisted. Hosts may
 * separately inject the encrypted refresh vault into the OAuth engine; no
 * credentials enter localStorage, sessionStorage, cookies or the pod.
 */
import type { TokenSet } from "./types.js";

const tokens = new Map<string, TokenSet>();

export function getToken(adapterId: string): TokenSet | undefined {
  const t = tokens.get(adapterId);
  if (t?.expiresAt && t.expiresAt <= Date.now()) {
    tokens.delete(adapterId);
    return undefined;
  }
  return t;
}

export function setToken(adapterId: string, token: TokenSet): void {
  tokens.set(adapterId, token);
}

export function clearToken(adapterId: string): void {
  tokens.delete(adapterId);
}

/** Test hook: wipe everything (vitest isolation). */
export function clearAllTokens(): void {
  tokens.clear();
}
