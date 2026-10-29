// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { AlertCircle, File, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

export type CollectionErrorKind =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "name-taken"
  | "quota"
  | "too-large"
  | "unreachable"
  | "unsupported"
  | "unknown";
export type CollectionState =
  | { status: "ready" | "loading" | "refreshing" }
  | { status: "offline"; cached: boolean }
  | { status: "error"; kind: CollectionErrorKind; actions?: ReactNode };
export interface CollectionSurfaceProps {
  state?: CollectionState;
  filterQuery?: string;
  emptyAction?: ReactNode;
  onClearFilters?: () => void;
  onRetry?: () => void;
}
const errorCopy: Record<CollectionErrorKind, string> = {
  reauth: "Sign in to continue",
  forbidden: "You don't have access to this",
  "not-found": "This item isn't here any more",
  conflict: "This item changed somewhere else",
  "name-taken": "A file with this name already exists",
  quota: "Your pod is full",
  "too-large": "This file is too large for your storage",
  unreachable: "Can't reach your storage",
  unsupported: "Not available on this storage",
  unknown: "Something went wrong",
};

export function CollectionPlaceholder({
  kind,
  count,
  state,
  filterQuery,
  emptyAction,
  onClearFilters,
  onRetry,
}: CollectionSurfaceProps & { kind: "table" | "grid"; count: number }) {
  if (state?.status === "loading" || (state?.status === "error" && state.kind === "reauth")) {
    return (
      <div
        className="suite-collection-state"
        role="status"
        aria-label="Loading files"
        aria-busy="true"
      >
        <span className="suite-sr-only">Loading files</span>
        <div className={kind === "grid" ? "suite-skeleton-grid" : ""} aria-hidden="true">
          {["one", "two", "three", "four", "five", "six"].map((key) => (
            <div className={`suite-skeleton-${kind}`} key={key}>
              <span />
            </div>
          ))}
        </div>
        {state.status === "error" && (
          <div role="alert">
            <p>{errorCopy.reauth}</p>
            {state.actions}
          </div>
        )}
      </div>
    );
  }
  if (state?.status === "error")
    return (
      <div className="suite-collection-state suite-collection-error" role="alert">
        <AlertCircle aria-hidden="true" size={24} strokeWidth={1.5} />
        <h3>{errorCopy[state.kind]}</h3>
        {state.actions ??
          (onRetry && (
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          ))}
      </div>
    );
  if (state?.status === "offline" && !state.cached)
    return (
      <div className="suite-collection-state" role="status">
        <WifiOff aria-hidden="true" size={24} strokeWidth={1.5} />
        <h3>Not available offline</h3>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  if (count > 0) return null;
  return (
    <div className="suite-collection-state" role="status">
      <span className="suite-empty-icon">
        <File aria-hidden="true" size={24} strokeWidth={1.5} />
      </span>
      <h3>{filterQuery !== undefined ? `No results for '${filterQuery}'` : "No files yet"}</h3>
      <p>
        {filterQuery !== undefined
          ? "Try another search or clear your filters."
          : "Add a file to get started."}
      </p>
      {filterQuery !== undefined ? (
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : (
        emptyAction
      )}
    </div>
  );
}

export function CollectionStatus({
  state,
  selectedCount,
}: {
  state?: CollectionState | undefined;
  selectedCount: number;
}) {
  return (
    <div className="suite-collection-status" role="status" aria-live="polite">
      {state?.status === "offline" && state.cached && (
        <span>Offline — showing saved copies · </span>
      )}
      {state?.status === "refreshing" && <span>Refreshing files · </span>}
      {selectedCount} selected
    </div>
  );
}

export function hasCollectionContent(state: CollectionState | undefined, count: number) {
  return (
    count > 0 &&
    state?.status !== "loading" &&
    state?.status !== "error" &&
    !(state?.status === "offline" && !state.cached)
  );
}
