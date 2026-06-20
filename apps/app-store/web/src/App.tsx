// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the Solid App Store root. Unlike the pod-apps, the store renders its FULL
// catalog whether or not you are logged in (it is a public directory): logging in
// only teaches it your WebID so the Launch buttons can carry it (silent SSO into the
// target app). So there is NO logged-out gate around the grid — the header swaps a
// "Sign in" control for the AccountMenu, and the Launch buttons upgrade from a plain
// "Open" link to a WebID-carrying "Launch" once a session exists.
//
// The store is itself a Solid app (it consumes the same auth seam as the pod-apps —
// SessionProvider + silent session restore), but it is the LAUNCHER, never a launch
// TARGET, so it never handles an inbound `#autologin/` deep-link of its own.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { Loading } from "@jeswr/solid-elements/react";
import { useMemo, useState } from "react";
import appsData from "../data/apps.json";
import { useSession } from "./auth/SessionProvider";
import { CatalogView } from "./components/CatalogView";
import { SignInDialog } from "./components/SignInDialog";
import { StoreGrid } from "./components/StoreGrid";
import { type AppEntry, isLive } from "./lib/catalog";

const APPS = appsData as AppEntry[];

/** Whether the URL fragment requests the human catalog (LD) view. */
function isCatalogRoute(): boolean {
  return typeof window !== "undefined" && window.location.hash.replace(/^#/, "") === "/catalog";
}

export function App() {
  const { webId, session, logout, login, loggingIn, error, ready, restoringSession } = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  // Read once at mount; the catalog route is a static deep-link, not a live router.
  const catalogRoute = useMemo(() => isCatalogRoute(), []);

  return (
    <div className="store">
      <header className="store-header">
        <a className="store-brand" href="#/">
          <span className="store-brand-mark" aria-hidden="true">
            ◆
          </span>
          Solid App Store
        </a>
        <div className="store-header-actions">
          <FeedbackButton
            repo="jeswr/solid-app-store"
            appName="Solid App Store"
            appVersion={__APP_VERSION__}
            webId={webId ?? undefined}
          />
          <ThemeToggle />
          {webId && session ? (
            <AccountMenu
              webId={webId}
              displayName={session.displayName}
              avatarUrl={session.avatarUrl}
              onSignOut={logout}
            />
          ) : restoringSession ? (
            // Silent session restore in flight — show a small inline spinner where the
            // account control will appear, rather than flashing the Sign-in button.
            <span className="store-restoring">
              <Loading label="Restoring your session…" />
            </span>
          ) : (
            <button
              type="button"
              className="store-signin"
              onClick={() => setSignInOpen(true)}
              disabled={!ready}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {catalogRoute ? (
        <CatalogView apps={APPS} />
      ) : (
        <main className="store-main">
          <section className="store-hero">
            <h1>Discover the Solid app suite</h1>
            <p>
              Every app stores your data in your own Solid pod. Sign in once and{" "}
              <strong>Launch</strong> any app already logged in — your session is re-established
              securely at your identity provider, and only your public WebID ever travels in a link.
            </p>
            {!webId ? (
              <p className="store-hero-cta">
                <button
                  type="button"
                  className="store-cta"
                  onClick={() => setSignInOpen(true)}
                  disabled={!ready}
                >
                  {ready ? "Sign in to launch apps" : "Loading…"}
                </button>
                <a className="store-cta-secondary" href="#/catalog">
                  View the catalog as Linked Data
                </a>
              </p>
            ) : null}
          </section>

          <StoreGrid apps={APPS} webId={webId} />

          <footer className="store-footer">
            <p>
              {APPS.filter(isLive).length} apps live · {APPS.length} in the suite ·{" "}
              <a href="#/catalog">Catalog (Linked Data)</a> ·{" "}
              <a
                href="https://github.com/jeswr/solid-app-store"
                target="_blank"
                rel="noopener noreferrer"
              >
                Source
              </a>
            </p>
          </footer>
        </main>
      )}

      <SignInDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        login={login}
        loggingIn={loggingIn}
        ready={ready}
        error={error}
      />
    </div>
  );
}
