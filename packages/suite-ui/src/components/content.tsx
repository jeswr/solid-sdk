// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { type ErrorCategory, errorStateCopy } from "./async-copy.js";
import { EmptyState } from "./empty-state.js";
import { ErrorState } from "./error-state.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { renderAsync } from "./render-async.js";

/** Defense at the presentation boundary: identifiers belong only in technical details. */
export function plainText(value: string): string {
  return value.replace(/(?:https?:\/\/|urn:|mailto:|tel:)[^\s<>"']+/gi, "Linked item");
}

export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    /* Invalid addresses are never interactive. */
  }
  return undefined;
}

export const surfaceErrors = Object.fromEntries(
  Object.entries(errorStateCopy).map(([category, copy]) => [category, copy.title]),
) as Record<ErrorCategory, string>;

export type SurfaceState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "empty"; query?: string; onAction?: () => void }
  | { status: "error"; category: keyof typeof surfaceErrors; onRetry?: () => void };

export function SurfaceFeedback({
  state,
  empty = "No items yet",
  action = "Add an item",
}: {
  state?: SurfaceState;
  empty?: string;
  action?: string;
}): ReactNode {
  return renderAsync({
    loading: state?.status === "loading" && <LoadingSkeleton preset="detail" />,
    error: state?.status === "error" && (
      <ErrorState
        error={state.category}
        actions={state.onRetry ? { retry: state.onRetry } : undefined}
        loadingPreset="detail"
      />
    ),
    empty: state?.status === "empty" && (
      <EmptyState
        variant={state.query !== undefined ? "filtered-empty" : "first-use"}
        title={state.query === undefined ? empty : `No results for '${plainText(state.query)}'`}
        body={
          state.query === undefined
            ? "Add an item to get started."
            : "Try another search or clear your filters."
        }
        query={plainText(state.query ?? "")}
        onClearFilters={state.onAction}
        primaryAction={
          state.query === undefined && state.onAction ? (
            <button type="button" className="suite-async-action" onClick={state.onAction}>
              {action}
            </button>
          ) : undefined
        }
      />
    ),
    children: null,
  });
}

export function formatBytes(bytes: number, locale = "en"): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const unit = Math.min(4, Math.floor(Math.log10(Math.max(1, size)) / 3));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / 1000 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
