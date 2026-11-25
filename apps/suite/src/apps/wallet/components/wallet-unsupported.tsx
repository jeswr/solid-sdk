// AUTHORED-BY Claude Opus 5.5
"use client";
import { ErrorState } from "@jeswr/suite-ui";

/** ACP pods and sub-root sessions: Permissions cannot fix this, so no retry or sharing advice. */
export function WalletUnsupported() {
  return (
    <ErrorState error="unsupported">
      <p>This pod's access setup isn't supported by Wallet yet.</p>
      <p>
        Wallet can't confirm that documents stay private on this kind of pod, so it doesn't store
        anything here. Changing Permissions won't fix this.
      </p>
    </ErrorState>
  );
}
