// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Upload } from "lucide-react";
import type { Ref } from "react";
import { type ErrorCategory, errorStateCopy } from "./async-copy.js";
import { EmptyState } from "./empty-state.js";
import { ErrorState } from "./error-state.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { renderAsync } from "./render-async.js";
export type SurfaceError = ErrorCategory;
export const surfaceErrorCopy = Object.fromEntries(
  Object.entries(errorStateCopy).map(([category, copy]) => [category, copy.title]),
) as Record<ErrorCategory, string>;

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
    return <LoadingSkeleton ref={ref} tabIndex={tabIndex} preset="detail" label="Loading" />;
  return (
    <div ref={ref} tabIndex={tabIndex}>
      {renderAsync({
        error: state.status === "error" && (
          <ErrorState
            error={state.error}
            actions={onAction ? { retry: onAction, signIn: onAction } : undefined}
            loadingPreset="detail"
          >
            {onAction && !["reauth", "offline", "unreachable"].includes(state.error) && (
              <button type="button" className="suite-async-action" onClick={onAction}>
                Retry
              </button>
            )}
          </ErrorState>
        ),
        empty:
          state.status === "empty" ? (
            <EmptyState
              title={emptyTitle}
              body={emptyBody}
              icon={<Upload size={24} strokeWidth={1.5} aria-hidden="true" />}
              primaryAction={
                onAction && (
                  <button type="button" className="suite-async-action" onClick={onAction}>
                    {actionLabel}
                  </button>
                )
              }
            />
          ) : state.status === "filtered-empty" ? (
            <EmptyState variant="filtered-empty" query={state.query} onClearFilters={onAction} />
          ) : null,
        children: null,
      })}
    </div>
  );
}
