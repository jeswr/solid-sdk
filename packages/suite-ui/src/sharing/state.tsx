// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Button } from "./primitives.js";

export type SharingError =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "unreachable"
  | "unsupported"
  | "unknown";
export type SharingState =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "filtered"; query: string }
  | { kind: "error"; code: SharingError }
  | { kind: "offline"; cached: boolean };

const errorCopy: Record<SharingError, string> = {
  reauth: "Sign in again to continue",
  forbidden: "You don't have access to this",
  "not-found": "This item isn't here any more",
  unreachable: "Can't reach your storage",
  unsupported: "Not available on this storage",
  unknown: "Something went wrong",
};

export function hasSharingContent(state: SharingState) {
  return state.kind === "ready" || (state.kind === "offline" && state.cached);
}

export function SharingStatus({
  state,
  empty,
  onRetry,
  onClear,
}: {
  state: SharingState;
  empty: string;
  onRetry?: (() => void) | undefined;
  onClear?: (() => void) | undefined;
}) {
  if (state.kind === "ready") return null;
  if (state.kind === "loading")
    return (
      <div role="status" aria-label="Loading" className="su-stack">
        <span className="su-skeleton" />
        <span className="su-skeleton" />
        <span className="su-skeleton" />
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="su-stack">
        <p role="alert">{errorCopy[state.code]}</p>
        {onRetry && (
          <Button onClick={onRetry}>{state.code === "reauth" ? "Sign in again" : "Retry"}</Button>
        )}
      </div>
    );
  return (
    <div className="su-stack">
      <p role="status">
        {state.kind === "filtered"
          ? `No results for '${state.query}'`
          : state.kind === "empty"
            ? empty
            : state.cached
              ? "Offline — showing saved copies"
              : "Not available offline"}
      </p>
      {state.kind === "filtered" && onClear && <Button onClick={onClear}>Clear filters</Button>}
      {state.kind === "offline" && !state.cached && onRetry && (
        <Button onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}
