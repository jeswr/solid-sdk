// AUTHORED-BY Claude Fable 5
"use client";
/**
 * A user-VISIBLE warning shown after a sign-out whose mandatory local-cache purge
 * failed (securityCritical: on a shared device the departed user's private health
 * data may still be readable). Rendered instead of console-only logging so the
 * incomplete wipe is never hidden behind a clean-looking logout. Offers a retry
 * (re-attempt the purge) and a dismiss. `role="alert"` so assistive tech announces
 * it immediately.
 */
import { useState } from "react";

export function LogoutPurgeWarning({
  onRetry,
  onDismiss,
}: {
  onRetry: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="logout-warning" role="alert">
      <p className="logout-warning__text">
        You&rsquo;re signed out, but this device&rsquo;s local copy of your health data may not have
        been fully cleared. On a shared device, clear it before someone else signs in.
      </p>
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
