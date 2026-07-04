// AUTHORED-BY Claude Fable 5
"use client";
/**
 * A user-VISIBLE warning shown after a sign-out that did not complete cleanly —
 * either the mandatory local-cache purge failed (securityCritical: on a shared device
 * the departed user's private health data may still be readable) OR the credential
 * revocation failed (the session may still be live). Rendered instead of console-only
 * logging so an incomplete sign-out is never hidden behind a clean-looking logout.
 * The exact {@link message} (which distinguishes the purge- vs revoke-failure case,
 * and carries the retry-specific update text) is passed in and rendered verbatim.
 * Offers a retry (re-attempt the purge) and a dismiss. `role="alert"` so assistive
 * tech announces it immediately.
 */
import { useState } from "react";

const DEFAULT_MESSAGE =
  "You’re signed out, but this device’s local copy of your health data may not have been fully cleared. On a shared device, clear it before someone else signs in.";

export function LogoutPurgeWarning({
  message,
  onRetry,
  onDismiss,
}: {
  /** The specific warning to render (purge- or revoke-failure text, incl. a retry-specific update). */
  message?: string;
  onRetry: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="logout-warning" role="alert">
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
          {retrying ? "Clearing…" : "Clear local data"}
        </button>
        <button
          type="button"
          className="logout-warning__btn"
          disabled={retrying}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
