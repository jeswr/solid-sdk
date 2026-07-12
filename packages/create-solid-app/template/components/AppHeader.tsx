"use client";
// AppHeader — the suite-standard top bar, baked into every create-solid-app
// scaffold. It drops in the SHARED @jeswr/app-shell controls so a new app is
// born with the same chrome as the rest of the Solid suite (Pod Manager,
// solid-issues, the pod-* apps):
//
//   • <ThemeToggle/>   — light / dark / system switch (resolves against the
//                         suite OKLCH tokens; the no-flash <head> script lives in
//                         app/layout.tsx and the <ThemeProvider> in providers).
//   • <AccountMenu/>   — avatar + WebID + Sign out, wired to this app's auth via
//                         useSolidAuth(). DECOUPLED: app-shell's AccountMenu takes
//                         everything as props, so we pass the session data + an
//                         onSignOut callback (no app-specific coupling in the lib).
//   • <FeedbackButton/>— report a bug / give feedback / get help → a GitHub issue
//                         on THIS app's own repo (FEEDBACK_REPO). The signed-in
//                         WebID is passed but attached only if the reporter ticks
//                         the consent box in the dialog (default OFF).
//
// The controls only make sense once authenticated (AccountMenu needs a session),
// so the whole right-hand cluster renders when `webId` is set; the ThemeToggle
// + FeedbackButton are always available.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { useSolidAuth } from "@/components/solid/SolidAuthProvider";
import { APP_NAME, FEEDBACK_REPO } from "@/lib/app-shell-config";
import { APP_VERSION } from "@/lib/app-version";

export function AppHeader() {
  const { webId, profile, logout } = useSolidAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
      <span className="font-semibold tracking-tight">{APP_NAME}</span>
      <div className="ml-auto flex items-center gap-1">
        {/* Shared suite feedback control: files to THIS app's repo in GitHub
            prefill mode. WebID is attached only on explicit consent. */}
        <FeedbackButton
          repo={FEEDBACK_REPO}
          appName={APP_NAME}
          appVersion={APP_VERSION}
          webId={webId}
        />
        <ThemeToggle />
        {/* The account control needs a session — show it once signed in. */}
        {webId ? (
          <AccountMenu
            webId={webId}
            displayName={profile?.name ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
            onSignOut={logout}
          />
        ) : null}
      </div>
    </header>
  );
}
