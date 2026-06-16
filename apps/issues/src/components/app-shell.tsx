// AUTHORED-BY Claude Opus 4.8
"use client";

// Vendored from solid-pod-manager src/components/app-shell.tsx
// Source hash tracked in vendor-lock.json; run scripts/check-pm-drift.mjs to detect drift.

import { Suspense, useState } from "react";
import { Loader2, Menu } from "lucide-react";
import { FeedbackButton } from "@jeswr/app-shell";
import { useSolidSession } from "@/lib/session-context";
import { LoginScreen } from "@/components/login-screen";
import { SidebarNav, BottomNav } from "@/components/sidebar-nav";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// Build version baked in at build time (next.config.ts) — attached to feedback
// diagnostics so a reported issue carries which build it came from.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

/**
 * The authenticated app frame: persistent sidebar on desktop, a slide-in
 * drawer + bottom bar on mobile (responsive at 375/768/1280). Gates the whole
 * app on the Solid session — the user's own data is never behind a wall, so the
 * gate is purely "are you signed in", nothing more.
 *
 * Note: the PM shell uses `usePathname` inside SidebarNav / BottomNav, which
 * requires a Suspense boundary in the Next.js App Router.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, profile } = useSolidSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // "initialising" = booting the auth manager; "restoring" = a silent
  // refresh-grant restore of a prior session (pss-203m); "autologin" = a
  // Pod-Manager `#autologin/<webid>` full-page redirect being initiated or
  // completed. All three show a brief spinner rather than flashing the login
  // screen, so a returning / deep-linked user lands on their page without
  // seeing (or interacting with) the login form.
  if (status === "initialising" || status === "restoring" || status === "autologin") {
    const message =
      status === "restoring"
        ? "Restoring your session…"
        : status === "autologin"
          ? "Signing you in…"
          : "Loading…";
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          {message}
        </span>
      </div>
    );
  }

  if (status !== "logged-in") {
    return <LoginScreen />;
  }

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <Suspense>
            <SidebarNav />
          </Suspense>
        </div>
        <div className="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
          Your issues stay in your pod.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
          {/* Mobile menu trigger */}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-16 items-center px-5">
                <Brand />
              </div>
              <div className="px-3 py-2">
                <Suspense>
                  <SidebarNav onNavigate={() => setDrawerOpen(false)} />
                </Suspense>
              </div>
            </SheetContent>
          </Sheet>

          <div className="md:hidden">
            <Brand />
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* Report issue / feedback / help → a GitHub issue on this app's repo.
                `submit` unset → GitHub prefill mode (opens the new-issue page). The
                WebID is attached ONLY if the reporter ticks the in-dialog consent. */}
            <FeedbackButton
              repo="jeswr/solid-issues"
              appName="Solid Issues"
              appVersion={APP_VERSION}
              webId={profile?.webId}
            />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        {/* Page content — bottom padding clears the mobile bottom bar. */}
        <main id="main" className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <Suspense>
        <BottomNav />
      </Suspense>
    </div>
  );
}
