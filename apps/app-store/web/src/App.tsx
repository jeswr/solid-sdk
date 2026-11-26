// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6
//
// App — the Solid App Store root. Unlike the pod-apps, the store renders its FULL
// catalog whether or not you are logged in (it is a public directory): signing in
// supplies the public WebID carried by Launch links into the target app's sign-in.
// There is no signed-out gate around the grid — the header swaps a
// "Sign in" control for the AccountControl, and the Launch buttons upgrade from a plain
// "Open" link to a WebID-carrying "Launch" once a session exists.
//
// One shared pod-auth core owns sign-in and restore. This catalog reads no pod data;
// global fetch stays public. Inbound account links are suggestions requiring a click.
import { useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { Loading } from "@jeswr/solid-elements/react";
import { useEffect, useState } from "react";
import appsData from "../data/apps.json";
import { CatalogView } from "./components/CatalogView";
import { SignInDialog } from "./components/SignInDialog";
import { StoreGrid } from "./components/StoreGrid";
import { type AppEntry, isLive } from "./lib/catalog";
import { isCatalogRoute } from "./lib/catalog-route";

const APPS = appsData as AppEntry[];

export function App() {
  const { webId, session, logout, error, ready, restoringSession } = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  useEffect(() => {
    if (webId && session) setSignInOpen(false);
  }, [webId, session]);
  // Track the catalog route LIVE — re-render on #/catalog ⇄ #/ and on back/forward,
  // rather than reading once at mount (so the in-app catalog links actually navigate).
  const [catalogRoute, setCatalogRoute] = useState(isCatalogRoute);
  useEffect(() => {
    const sync = () => setCatalogRoute(isCatalogRoute());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

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
            <AccountControl
              webId={webId}
              displayName={session.displayName}
              avatarUrl={session.avatarUrl}
              onSignOut={logout}
            />
          ) : restoringSession || (webId && !session) ? (
            // Silent session restore in flight — show a small inline spinner where the
            // account control will appear, rather than flashing the Sign-in button.
            <span className="store-restoring">
              <Loading
                label={restoringSession ? "Restoring your session…" : "Loading your account…"}
              />
            </span>
          ) : (
            <button
              type="button"
              className="store-signin"
              onClick={() => setSignInOpen(true)}
              disabled={!ready && !error}
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
              <strong>Launch</strong> any app with your account ready to choose. Only your public
              WebID ever travels in a link; the destination handles its own secure sign-in.
            </p>
            {!webId ? (
              <p className="store-hero-cta">
                <button
                  type="button"
                  className="store-cta"
                  onClick={() => setSignInOpen(true)}
                  disabled={!ready && !error}
                >
                  {ready || error ? "Sign in to launch apps" : "Loading…"}
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

      {error && !signInOpen ? (
        <p className="store-auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
