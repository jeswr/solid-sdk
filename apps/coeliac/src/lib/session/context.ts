// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The session/auth seam as a plain React context (DESIGN §1). Every data view
 * reads `authedFetch` / `publicFetch` / `webId` / `storageRoot` / `store` from
 * here, so the whole app is unit-testable by wrapping a component in a
 * `SessionContext.Provider` with a STUBBED fetch and a `MemoryKv`-backed store —
 * no reactive-auth, no server. The real wiring lives in the client
 * `SessionProvider`; this module carries no browser-only imports so tests import
 * it freely.
 */
import { createContext, useContext } from "react";
import type { DiaryStore } from "../cache/diary-store";

/** Coarse auth status driving the top-level shell (restoring → login/app). */
export type SessionStatus = "loading" | "anonymous" | "authed";

/** The value every consumer reads off `useSession()`. */
export interface SessionValue {
  status: SessionStatus;
  /** The authenticated WebID, or null when not signed in. */
  webId: string | null;
  /** The session-bound authed fetch (pristine credential-free fetch before login). */
  authedFetch: typeof globalThis.fetch;
  /** The pristine, credential-free fetch for foreign-origin reads (OFF). */
  publicFetch: typeof globalThis.fetch;
  /** The resolved pod storage root (container URL), or null before login. */
  storageRoot: string | null;
  /** The durable client cache + outbox for this account, or null before login. */
  store: DiaryStore | null;
  /**
   * Set when the last sign-out could NOT fully clear the local WebID-scoped health
   * cache (the mandatory logout purge failed). Surfaced to the user (a visible
   * warning, not a console line) because on a shared device private health data may
   * still be readable; `null` when the last sign-out purged cleanly. FULLY INDEPENDENT
   * of {@link revokeWarning} — clearing one never affects the other.
   */
  purgeWarning: string | null;
  /**
   * Set when the last sign-out could NOT revoke the credential — the session may STILL
   * BE LIVE / silently restorable on this device. A SECURITY state, distinct from
   * {@link purgeWarning}: it is NOT dismissible and NOT cleared by the purge retry; it
   * clears ONLY on a successful revoke retry ({@link retryRevoke}) or a fresh session
   * (re)activation. `null` when the last sign-out revoked cleanly.
   */
  revokeWarning: string | null;
  /** Start an interactive login for a WebID (or re-login the last account). */
  login: (webId?: string) => Promise<void>;
  /** Sign out (clears the session + persisted credential). */
  logout: () => Promise<void>;
  /** Flush the optimistic outbox to the pod (reconcile). */
  reconcile: () => Promise<void>;
  /** Re-attempt the failed logout purge (clears {@link purgeWarning} on success only). */
  retryPurge: () => Promise<void>;
  /** Dismiss the {@link purgeWarning} banner without retrying (revoke warning untouched). */
  dismissPurgeWarning: () => void;
  /**
   * Re-attempt the failed credential revocation (sign out again). Clears
   * {@link revokeWarning} ONLY on success; the purge warning is never touched.
   */
  retryRevoke: () => Promise<void>;
}

/** The pre-login default: pristine global fetch, no session. */
export const anonymousSession: SessionValue = {
  status: "loading",
  webId: null,
  authedFetch: (...a) => globalThis.fetch(...a),
  publicFetch: (...a) => globalThis.fetch(...a),
  storageRoot: null,
  store: null,
  purgeWarning: null,
  revokeWarning: null,
  login: async () => {},
  logout: async () => {},
  reconcile: async () => {},
  retryPurge: async () => {},
  dismissPurgeWarning: () => {},
  retryRevoke: async () => {},
};

export const SessionContext = createContext<SessionValue>(anonymousSession);

/** Read the current session (auth seam). */
export function useSession(): SessionValue {
  return useContext(SessionContext);
}
