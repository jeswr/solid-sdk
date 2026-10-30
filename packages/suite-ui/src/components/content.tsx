// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";

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

export const surfaceErrors = {
  reauth: "Sign in again to continue",
  forbidden: "You don't have access to this",
  "not-found": "This item isn't here any more",
  conflict: "This item has changed. Review the latest version before continuing.",
  "name-taken": "A file with this name already exists",
  quota: "Your pod is full",
  "too-large": "This file is too large for your storage",
  offline: "Not available offline",
  unreachable: "Can't reach your storage",
  unsupported: "Not available on this storage",
  unknown: "Something went wrong",
} as const;

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
  if (!state || state.status === "ready") return null;
  if (state.status === "loading")
    return (
      <div role="status" className="suite-feedback" aria-label="Loading">
        <span className="suite-sr-only">Loading…</span>
        <span className="suite-skeleton" aria-hidden="true" />
        <span className="suite-skeleton" aria-hidden="true" />
        <span className="suite-skeleton" aria-hidden="true" />
      </div>
    );
  if (state.status === "error")
    return (
      <div role="alert" className="suite-feedback">
        <p>{surfaceErrors[state.category]}</p>
        {state.onRetry && (
          <button type="button" onClick={state.onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <div role="status" className="suite-feedback">
      <p>{state.query ? `No results for '${plainText(state.query)}'` : empty}</p>
      {state.onAction && (
        <button type="button" onClick={state.onAction}>
          {state.query ? "Clear filters" : action}
        </button>
      )}
    </div>
  );
}

export function formatBytes(bytes: number, locale = "en"): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const unit = Math.min(4, Math.floor(Math.log10(Math.max(1, size)) / 3));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / 1000 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
