// AUTHORED-BY Claude Fable 5
"use client";

import { usePathname } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { ErrorBoundary } from "@jeswr/app-shell";
import { Button } from "@/components/ui/button";

/**
 * Wraps the routed page content in the suite-shared <ErrorBoundary> (cross-app
 * parity #72/#73). A render/lifecycle error in any page is caught and replaced
 * with a themed panel instead of white-screening the whole app.
 * `resetKey={pathname}` recovers on navigation: moving to another route clears
 * a caught error and re-renders — a broken page never traps the user.
 *
 * Placed INSIDE <AppShell> around only `{children}`, so the app chrome
 * (sidebar / nav) stays outside the boundary and remains usable when a page
 * throws. The fallback is built from THIS app's own tokens + Button (rather than
 * app-shell's default <ErrorState>) so it is themed by Solid Issues' token set —
 * app-shell's default fallback resolves against its private `--as-*` token CSS,
 * which we deliberately don't import (one token home).
 *
 * PRIVACY BY DEFAULT: the copy is intentionally generic — raw error internals /
 * stack text are never rendered (they belong in telemetry via the boundary's
 * `onError` seam, not the UI).
 */
export function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={({ reset }) => (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border p-8 text-center"
        >
          <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
          <div className="flex max-w-prose flex-col gap-1">
            <p className="text-sm font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Please try again.
            </p>
          </div>
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
