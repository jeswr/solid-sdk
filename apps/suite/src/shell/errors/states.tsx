// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState } from "@jeswr/suite-ui";
export function ForbiddenState({
  onRequestAccess,
  onSwitchAccount,
}: {
  onRequestAccess?: () => void;
  onSwitchAccount: () => void;
}) {
  return (
    <ErrorState
      error="forbidden"
      accessRequests={Boolean(onRequestAccess)}
      actions={{
        ...(onRequestAccess ? { requestAccess: onRequestAccess } : {}),
        switchAccount: onSwitchAccount,
      }}
    />
  );
}
export function UnreachableState({
  onRetry,
  onShowSaved,
}: {
  onRetry: () => void;
  onShowSaved?: () => void;
}) {
  return (
    <ErrorState
      error="unreachable"
      actions={{ retry: onRetry, ...(onShowSaved ? { showSavedCopies: onShowSaved } : {}) }}
    />
  );
}
