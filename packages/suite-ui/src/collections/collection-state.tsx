// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { ReactNode } from "react";
import type { ErrorCategory } from "../components/async-copy.js";
import { EmptyState } from "../components/empty-state.js";
import { type ErrorRecovery, ErrorState } from "../components/error-state.js";
import { LoadingSkeleton } from "../components/loading-skeleton.js";
import { renderAsync } from "../components/render-async.js";

// Collections already represent offline through the cached/uncached state branch.
export type CollectionErrorKind = Exclude<ErrorCategory, "offline">;
export type CollectionState =
  | { status: "ready" | "loading" | "refreshing" }
  | { status: "offline"; cached: boolean }
  | { status: "error"; kind: CollectionErrorKind; retryAfterMs?: number; actions?: ReactNode };
export interface CollectionSurfaceProps {
  state?: CollectionState;
  filterQuery?: string;
  emptyAction?: ReactNode;
  onClearFilters?: () => void;
  onRetry?: () => void;
  errorActions?: ErrorRecovery;
  accessRequests?: boolean;
}
export function CollectionPlaceholder({
  kind,
  count,
  state,
  filterQuery,
  emptyAction,
  onClearFilters,
  onRetry,
  errorActions,
  accessRequests,
}: CollectionSurfaceProps & { kind: "table" | "grid"; count: number }) {
  return renderAsync({
    loading: state?.status === "loading" && <LoadingSkeleton preset={kind} label="Loading files" />,
    error: state?.status === "error" && (
      <ErrorState
        error={{ category: state.kind, retryAfterMs: state.retryAfterMs }}
        actions={{ ...(onRetry ? { retry: onRetry } : {}), ...errorActions }}
        accessRequests={accessRequests}
        loadingPreset={kind}
      >
        {state.actions}
      </ErrorState>
    ),
    empty:
      state?.status === "offline" && !state.cached ? (
        <EmptyState variant="not-available-offline" onRetry={onRetry} />
      ) : count === 0 ? (
        <EmptyState
          variant={filterQuery !== undefined ? "filtered-empty" : "first-use"}
          query={filterQuery ?? ""}
          primaryAction={filterQuery !== undefined ? undefined : emptyAction}
          onClearFilters={onClearFilters}
        />
      ) : null,
    children: null,
  });
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
