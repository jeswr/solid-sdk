// AUTHORED-BY Claude Fable 5
//
// ErrorState — the suite's shared themed error panel: icon + title + friendly
// message + an optional Retry button. `role="alert"` so its appearance is
// announced to assistive tech. Reusable STANDALONE (a failed data fetch, an
// empty-but-broken view) and used as <ErrorBoundary>'s default fallback.
//
// Matches the shell's visual language (EmptyState/LoadingState in the apps):
// centred column, bordered rounded panel, muted secondary text — themed through
// the shell-PRIVATE `as-` token utilities (CSS isolation, #80), never `dark:`
// utilities, so it follows the ThemeProvider's `.dark` class via the `--as-*`
// custom-property mirror.
//
// PRIVACY / SAFETY BY DEFAULT: the default copy is intentionally generic. Do
// not pass raw `Error#message` / stack text into `message` — keep diagnostics
// in telemetry (see ErrorBoundary's `onError`), not the UI.

import { RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./primitives.js";

export interface ErrorStateProps {
  /** Panel heading. Default: "Something went wrong". */
  title?: string | undefined;
  /**
   * Friendly, human-readable line under the title. Default: a generic retry
   * suggestion. Never pass raw error internals/stack text here.
   */
  message?: string | undefined;
  /** When provided, renders a Retry button wired to it (e.g. refetch / reset). */
  onRetry?: (() => void) | undefined;
  /** Retry button label. Default: "Try again". */
  retryLabel?: string | undefined;
  /** Extra classes for placement/sizing; appended LAST so the caller wins. */
  className?: string | undefined;
}

/** Themed error panel (icon + title + message + optional Retry), `role="alert"`. */
export function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again.",
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-as-border p-8 text-center",
        className,
      )}
    >
      <TriangleAlert className="size-8 text-as-destructive" aria-hidden="true" />
      <div className="flex max-w-prose flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-as-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
