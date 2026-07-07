// AUTHORED-BY Claude Fable 5
"use client";

import { usePathname } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { ErrorBoundary } from "@jeswr/app-shell";
import { Button } from "@/components/ui/button";

/**
 * Wraps the routed page content in the suite-shared <ErrorBoundary> (cross-app
 * error-handling parity). A render/lifecycle error in any page is caught and
 * replaced with a themed fallback instead of white-screening the whole app.
 * `resetKey={pathname}` recovers on navigation: moving to another route clears
 * a caught error and re-renders — a broken page never traps the user.
 *
 * Placed around only `{children}` (INSIDE <Providers>, AFTER <AppHeader />), so
 * the app chrome stays outside the boundary and remains usable when a page
 * throws. The fallback is built from this app's own tokens + <Button> rather
 * than app-shell's default <ErrorState>, which resolves against app-shell's
 * private `--as-*` token CSS this template deliberately does not import (one
 * token home — see app/globals.css).
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
          className="mx-auto my-16 flex max-w-prose flex-col items-center justify-center gap-3 rounded-lg border border-border p-8 text-center"
        >
          <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
          <div className="flex flex-col gap-1">
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
