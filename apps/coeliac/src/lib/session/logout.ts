// AUTHORED-BY Claude Fable 5
/**
 * The secure sign-out sequence, extracted from the client `SessionProvider` so it
 * is fully unit-testable with mocks — no reactive-auth, no browser, no server.
 *
 * Health data is securityCritical, so logout does three things in a fixed order:
 *   1. **Best-effort final flush** of the optimistic outbox, so an ONLINE logout
 *      never silently drops writes that were logged but not yet synced to the pod.
 *   2. **Revoke the persisted credential** (reactive-auth `controller.logout()`),
 *      clearing the DPoP refresh token so the session cannot be silently restored.
 *   3. **MANDATORY purge** of the WebID-scoped private cache, so nothing the
 *      departed user logged or read survives on a shared browser/device (the
 *      offline design's §7 logout-purge, parallel to the credential wipe).
 *
 * Steps 1 and 2 must NOT block or prevent the step-3 purge from running. Step 1
 * (flush) is genuinely best-effort — a transient/offline failure is swallowed. But
 * step 2 (revoke) is NOT swallowed: a failed credential revocation means the session
 * may STILL BE LIVE, so it is captured and surfaced DISTINCTLY from a purge failure —
 * a revoke failure must never masquerade as a clean sign-out (it would hide an active
 * session behind a signed-out UI). Step 3 (purge) is the privacy guarantee: its
 * failure is likewise surfaced so the caller can warn about an incomplete wipe rather
 * than assume the device was cleared. Purge- and revoke-failures are reported through
 * SEPARATE flags so the UI can react to each correctly.
 *
 * The purge operates only on the app's IndexedDB cache (see {@link DiaryStore.purge});
 * it never touches the Cache API, because private pod/health data is never written
 * there (the shell-only service-worker boundary).
 */
import type { DiaryStore } from "../cache/diary-store";

export interface SecureLogoutContext {
  /** The departing account's durable cache/outbox (null if never signed in). */
  store: DiaryStore | null;
  /**
   * Best-effort final outbox flush (online only). Must run BEFORE the credential
   * is revoked (it needs the authed fetch). Any rejection is swallowed.
   */
  flush?: () => Promise<unknown>;
  /** Revoke the persisted credential (reactive-auth `controller.logout()`). */
  revokeCredentials?: () => Promise<void>;
}

/**
 * Thrown by {@link performSecureLogout} when the credential revocation and/or the
 * mandatory purge failed. It carries the two failures SEPARATELY so the caller can
 * distinguish "the session may still be live" (revoke) from "the local cache may not
 * be wiped" (purge) — they demand different user-facing messaging. Its `message` is
 * the purge-failure message when a purge failed (the privacy guarantee), else the
 * revoke-failure message, so existing text assertions on a purge failure still hold.
 */
export class SecureLogoutError extends Error {
  readonly purgeError?: Error;
  readonly revokeError?: Error;
  constructor(opts: { purgeError?: Error; revokeError?: Error }) {
    const primary = opts.purgeError ?? opts.revokeError;
    super(primary?.message ?? "secure logout failed");
    this.name = "SecureLogoutError";
    this.purgeError = opts.purgeError;
    this.revokeError = opts.revokeError;
  }
  /** The mandatory WebID-scoped cache purge rejected — the local wipe is incomplete. */
  get purgeFailed(): boolean {
    return this.purgeError !== undefined;
  }
  /** Credential revocation rejected — the session may STILL BE LIVE on this device. */
  get revokeFailed(): boolean {
    return this.revokeError !== undefined;
  }
}

/**
 * Run the flush → revoke → purge sign-out sequence. Resolves only when BOTH the
 * credential revocation and the mandatory purge succeeded. Rejects with a
 * {@link SecureLogoutError} if either failed (the flush in step 1 is always swallowed),
 * carrying the two failures distinctly. The purge ALWAYS runs, even after a revoke
 * failure — the privacy wipe is not conditional on the credential wipe.
 */
export async function performSecureLogout(ctx: SecureLogoutContext): Promise<void> {
  // 1. Best-effort final flush so an online logout does not lose un-synced writes.
  if (ctx.flush) {
    try {
      await ctx.flush();
    } catch {
      /* offline / transient — the mandatory purge below still runs */
    }
  }
  // 2. Revoke the credential. A failure is CAPTURED (not swallowed): the session may
  //    still be live, which the caller must surface distinctly. The purge still runs.
  let revokeError: Error | undefined;
  if (ctx.revokeCredentials) {
    try {
      await ctx.revokeCredentials();
    } catch (err) {
      revokeError = err instanceof Error ? err : new Error(String(err));
    }
  }
  // 3. MANDATORY privacy purge of the WebID-scoped private health cache — runs
  //    regardless of a revoke failure; its own failure is captured too.
  let purgeError: Error | undefined;
  if (ctx.store) {
    try {
      await ctx.store.purge();
    } catch (err) {
      purgeError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (purgeError || revokeError) {
    throw new SecureLogoutError({ purgeError, revokeError });
  }
}

/** The result of a sign-out — whether the purge and/or credential revocation failed. */
export interface LogoutOutcome {
  /**
   * `true` when the local WebID-scoped health cache could NOT be fully cleared
   * (the `DiaryStore.purge` rejected). The caller MUST make this VISIBLE to the
   * user — on a shared device, private health data may still be readable — rather
   * than swallow it: the credential is (usually) revoked, but the wipe is incomplete.
   */
  purgeFailed: boolean;
  /**
   * `true` when the credential revocation rejected. This is DISTINCT from a purge
   * failure and more serious for session integrity: the DPoP credential may NOT have
   * been cleared, so the session could still be live / silently restorable. The caller
   * MUST surface this as an "sign-out may be incomplete — you may still be signed in"
   * warning, and must NOT present it as a clean anonymous sign-out.
   */
  revokeFailed: boolean;
  /** The purge-failure message, present only when {@link purgeFailed}. */
  error?: string;
  /** The revoke-failure message, present only when {@link revokeFailed}. */
  revokeError?: string;
}

/**
 * Caller-facing wrapper around {@link performSecureLogout} that always resolves,
 * REPORTING (never swallowing) purge and revoke failures as a {@link LogoutOutcome}
 * with SEPARATE flags. The UI layer still transitions to signed-out (a purge failure
 * leaves the credential already revoked), but a `revokeFailed` outcome must NOT be
 * presented as a clean sign-out — the caller surfaces a distinct "you may still be
 * signed in" warning — and a `purgeFailed` outcome surfaces the "local data may not
 * be fully cleared" warning + retry.
 */
export async function runSecureLogout(ctx: SecureLogoutContext): Promise<LogoutOutcome> {
  try {
    await performSecureLogout(ctx);
    return { purgeFailed: false, revokeFailed: false };
  } catch (err) {
    if (err instanceof SecureLogoutError) {
      return {
        purgeFailed: err.purgeFailed,
        revokeFailed: err.revokeFailed,
        error: err.purgeError?.message,
        revokeError: err.revokeError?.message,
      };
    }
    // Unexpected error shape — fail closed: treat as a purge failure so the incomplete
    // wipe is surfaced rather than assumed clean.
    return {
      purgeFailed: true,
      revokeFailed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
