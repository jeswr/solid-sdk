// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import type { NavigationError } from "./preferences.js";

export const navigationErrorCopy: Record<NavigationError, string> = {
  reauth: "Sign in again to load your app preferences",
  forbidden: "You don't have access to this",
  "not-found": "This item isn't here any more",
  conflict: "This item changed somewhere else",
  "name-taken": "A file with this name already exists",
  quota: "Your pod is full",
  "too-large": "This file is too large for your storage",
  offline: "Not available offline",
  unreachable: "Can't reach your storage",
  unsupported: "Not available on this storage",
  unknown: "Something went wrong",
};
export function NavigationErrorState({
  error,
  retry,
}: {
  error: NavigationError;
  retry: () => void;
}) {
  return (
    <div className="suite-navigation-state" role="alert">
      <p>{navigationErrorCopy[error]}</p>
      <button type="button" data-slot="navigation-action" className="suite-action" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
export function LauncherSkeleton() {
  return (
    <div role="status" aria-label="Loading apps" className="suite-launcher-skeleton">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i.toString()} />
      ))}
    </div>
  );
}
