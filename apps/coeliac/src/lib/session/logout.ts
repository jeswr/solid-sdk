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
 * Steps 1 and 2 are best-effort — a transient/offline failure must not block
 * sign-out, and (critically) must NOT prevent the step-3 purge from running. Step 3
 * is the privacy guarantee: its failure is propagated so the caller can surface an
 * incomplete purge rather than assume the device was cleared.
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
 * Run the flush → revoke → purge sign-out sequence. Resolves once the mandatory
 * purge has completed; rejects only if that purge failed (steps 1–2 never reject).
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
  // 2. Revoke the credential (best-effort — a failure must not stop the purge).
  if (ctx.revokeCredentials) {
    try {
      await ctx.revokeCredentials();
    } catch {
      /* credential wipe is best-effort; the purge is the privacy guarantee */
    }
  }
  // 3. MANDATORY privacy purge of the WebID-scoped private health cache.
  if (ctx.store) {
    await ctx.store.purge();
  }
}
