// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Upload } from "lucide-react";
import type { Ref } from "react";
export type SurfaceError =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "name-taken"
  | "quota"
  | "too-large"
  | "offline"
  | "unreachable"
  | "unsupported"
  | "unknown";
export const surfaceErrorCopy: Record<SurfaceError, string> = {
  reauth: "Sign in to continue",
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
export type SurfaceState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "filtered-empty"; query: string }
  | { status: "error"; error: SurfaceError };

export function SurfaceFeedback({
  state,
  onAction,
  emptyTitle = "No uploads yet",
  emptyBody = "Upload files to get started",
  actionLabel = "Upload a file",
  ref,
  tabIndex,
}: {
  state: SurfaceState;
  onAction?: (() => void) | undefined;
  emptyTitle?: string;
  emptyBody?: string;
  actionLabel?: string;
  ref?: Ref<HTMLDivElement>;
  tabIndex?: number;
}) {
  if (state.status === "ready") return null;
  if (state.status === "loading")
    return (
      <div ref={ref} tabIndex={tabIndex} className="su-feedback" role="status" aria-label="Loading">
        <span className="su-skeleton su-skeleton-title" />
        <span className="su-skeleton" />
        <span className="su-skeleton" />
        <span className="su-sr-only">Loading…</span>
      </div>
    );
  const error = state.status === "error";
  const filtered = state.status === "filtered-empty";
  return (
    <div ref={ref} tabIndex={tabIndex} className="su-feedback" role={error ? "alert" : "status"}>
      {!error && !filtered && (
        <span className="su-empty-tile">
          <Upload size={24} strokeWidth={1.5} aria-hidden="true" />
        </span>
      )}
      <p className="su-title">
        {error
          ? surfaceErrorCopy[state.error]
          : filtered
            ? `No results for '${state.query}'`
            : emptyTitle}
      </p>
      {!error && !filtered && <p className="su-muted">{emptyBody}</p>}
      {onAction && (
        <button className="su-button" type="button" onClick={onAction}>
          {error
            ? state.error === "reauth"
              ? "Sign in"
              : "Retry"
            : filtered
              ? "Clear filters"
              : actionLabel}
        </button>
      )}
    </div>
  );
}
