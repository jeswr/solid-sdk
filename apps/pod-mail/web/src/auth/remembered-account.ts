// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// remembered-account.ts — the small, durable note of WHO the returning user is so
// silent restore knows WHICH issuer's refresh-token grant to run on load.
//
// The DPoP-bound refresh token + key live in IndexedDB keyed by ISSUER
// (session-persistence.ts). To restore on a fresh load we must first know which
// issuer to ask — i.e. which account was last active and what its issuer is. This
// module holds exactly that pointer in localStorage (origin-scoped, survives a tab
// close, unlike sessionStorage). It holds NO credential — only the public WebID +
// issuer URL the login already resolved. The credential stays in IndexedDB,
// DPoP-bound.
//
// WebID-SCOPED: the record names ONE last-active WebID and its issuer. On a login
// we overwrite it (a new identity replaces the old pointer); on logout / account
// change we clear it, so a stale pointer can never aim silent restore at a
// previous user. The actual cross-user isolation is enforced by the per-issuer
// IndexedDB key + the WebID-match in decideSilentRestore — this is just the
// pointer that selects which issuer to try.
//
// Pure storage access (no React), guarded against an unavailable / throwing
// localStorage (private mode, SSR) so it degrades to "no remembered account"
// (→ the login screen) rather than throwing.

import type { RememberedAccount } from "./session-restore";

/** localStorage key holding the JSON {@link RememberedAccount} pointer. */
export const REMEMBERED_ACCOUNT_KEY = "pod-mail.remembered-account";

/** Read the remembered account pointer, or null when absent / unavailable / corrupt. */
export function readRememberedAccount(): RememberedAccount | null {
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(REMEMBERED_ACCOUNT_KEY) ?? null;
  } catch {
    return null; // localStorage unavailable (private mode / SSR) — no pointer.
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedAccount>;
    // A record without a webId is useless (silent restore keys off the WebID).
    if (typeof parsed.webId !== "string" || parsed.webId.length === 0) return null;
    return {
      webId: parsed.webId,
      issuer:
        typeof parsed.issuer === "string" && parsed.issuer.length > 0 ? parsed.issuer : undefined,
    };
  } catch {
    return null; // corrupt JSON — treat as absent.
  }
}

/**
 * Remember the now-active account (WebID + its resolved issuer) so a later reload
 * can attempt a silent refresh-token restore. Overwrites any prior pointer (a new
 * identity supersedes the old one). Best-effort: a storage error degrades to
 * in-memory-only behaviour (the next load shows login), never a failed login.
 */
export function writeRememberedAccount(webId: string, issuer: string): void {
  try {
    globalThis.localStorage?.setItem(
      REMEMBERED_ACCOUNT_KEY,
      JSON.stringify({ webId, issuer } satisfies RememberedAccount),
    );
  } catch {
    // localStorage unavailable / quota — silent restore just won't be available.
  }
}

/**
 * Clear the remembered-account pointer (logout / account change). Idempotent;
 * swallows storage errors. Clearing the pointer means the next load will not
 * attempt a silent restore — the credential in IndexedDB is cleared separately by
 * the provider's `forgetPersisted`.
 */
export function clearRememberedAccount(): void {
  try {
    globalThis.localStorage?.removeItem(REMEMBERED_ACCOUNT_KEY);
  } catch {
    // Nothing to clear / unavailable.
  }
}
