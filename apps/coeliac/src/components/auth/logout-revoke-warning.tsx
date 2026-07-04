// AUTHORED-BY Claude Opus 4.8
"use client";
/**
 * A user-VISIBLE, PERSISTENT security warning shown after a sign-out whose credential
 * revocation FAILED — the DPoP credential may not have been cleared, so the session
 * could still be live / silently restorable on this device. Distinct from
 * {@link LogoutPurgeWarning}: because the user is genuinely still signed in, this
 * banner is NOT dismissible and offers NO "Clear local data" action (that addresses a
 * different concern). It clears ONLY when the revocation is retried and succeeds
 * ("Sign out again") — with "Reload page" as a guaranteed fallback (a reload restores
 * the still-live session, from which the user can sign out again). `role="alert"` so
 * assistive tech announces the security state immediately.
 */
import { useState } from "react";

const DEFAULT_MESSAGE =
  "Sign-out may be incomplete — your credentials could not be revoked, so you may still be signed in on this device. Sign out again, or reload the page.";

export function LogoutRevokeWarning({
  message,
  onRetry,
  onReload,
}: {
  /** The revoke-failure text to render (falls back to the default security copy). */
  message?: string;
  /** Re-attempt the credential revocation (sign out again). */
  onRetry: () => Promise<void>;
  /** Reload the page (guaranteed fallback — the session restores, then sign out). */
  onReload: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="logout-warning logout-warning--revoke" role="alert">
      <p className="logout-warning__text">{message ?? DEFAULT_MESSAGE}</p>
      <div className="logout-warning__actions">
        <button
          type="button"
          className="logout-warning__btn logout-warning__btn--primary"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void onRetry().finally(() => setRetrying(false));
          }}
        >
          {retrying ? "Signing out…" : "Sign out again"}
        </button>
        <button
          type="button"
          className="logout-warning__btn"
          disabled={retrying}
          onClick={onReload}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
