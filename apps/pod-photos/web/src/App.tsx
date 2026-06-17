// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-photos <PhotoGallery>
// pointed at the user's photos container. The gallery receives NO `fetch` prop —
// it uses the ambient global fetch, which the SessionProvider patched via the
// @jeswr/solid-elements PROACTIVE auth-fetch (task #123), so every read carries the
// DPoP token automatically AND up front (the token is attached on the FIRST request
// to the pod origin — no per-resource 401-dance; the gallery reads N photo resources,
// which previously paid N+1 wasted 401s. See auth/SessionProvider.tsx).
//
// The gallery's `rootUrl` is the PHOTOS container. The host derives the pod root
// from the session (deriveSession — storages[0], else WebID origin) and then
// resolves the photos container under it via the library's read-only Type-Index
// discovery (resolvePhotosRoot — schema:Photograph instanceContainer, else
// ${podRoot}photos/). Discovery is async, so we show a brief "finding your
// photos…" state and surface a banner when either fallback is used.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { PhotoGallery } from "@jeswr/pod-photos/ui";
// SOLID-ELEMENTS PILOT (#115): the framework-agnostic W3C Web Components consumed
// through the @lit/react adapter. <Loading> is a Lit custom element (spinner +
// polite-live label, prefers-reduced-motion aware) wrapped by @lit/react's
// createComponent. It themes itself from the SAME app-shell OKLCH tokens as the rest
// of the chrome: its shadow-DOM styles read `--jeswr-*`, which fall back through the
// shadow boundary to app-shell's `--primary` / `--border` / `--muted-foreground`
// (set by styles.css and flipped by the `.dark` class), so it follows light/dark for
// free with no extra wiring. (COMPLEMENTS app-shell — it does not replace the React
// chrome components above.) Plain Vite/CSR React has no SSR step, so the client-only
// custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";
import { type PhotosRoot, resolvePhotosRoot } from "./photos-root";

export function App() {
  const { webId, session, logout, autologinPending, restoring } = useSession();
  const [photosRoot, setPhotosRoot] = useState<PhotosRoot | null>(null);

  // Resolve the photos container under the derived pod root once a session
  // exists. Best-effort + cancellation-safe: a logout/identity change clears the
  // session, which resets photosRoot to null so a stale discovery can't render.
  useEffect(() => {
    if (!session) {
      setPhotosRoot(null);
      return;
    }
    let cancelled = false;
    setPhotosRoot(null);
    resolvePhotosRoot({ webId: session.webId, podRoot: session.podRoot })
      .then((root) => {
        if (!cancelled) setPhotosRoot(root);
      })
      .catch(() => {
        // resolvePhotosRoot already falls back internally; this catch is purely
        // defensive — never strand the gallery on a discovery error.
        if (!cancelled) {
          setPhotosRoot({ rootUrl: `${session.podRoot}photos/`, isFallback: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!webId || !session) {
    // A brief busy state instead of flashing the login form when the session is being
    // established WITHOUT a gesture:
    //  - `autologinPending` — a Pod-Manager deep-link / redirect return is signing the
    //    user in via a full-page redirect ("Signing you in…").
    //  - `restoring` — a returning user's session is being silently re-established from
    //    the persisted DPoP-bound refresh token (a refresh grant, no popup/iframe)
    //    after a closed-tab reopen ("Restoring your session…").
    // Fall through to the interactive login form ONLY when neither is in flight.
    if (autologinPending || restoring) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Photos</h1>
            {/* SOLID-ELEMENTS: the <jeswr-loading> spinner + label (via @lit/react).
                It carries its own role="status" + aria-live, so the label is
                announced; we keep the .login-sub wrapper only for the existing
                spacing/typography. */}
            <p className="login-sub">
              <Loading label={autologinPending ? "Signing you in…" : "Restoring your session…"} />
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* The header now uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountMenu/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-photos files against
          `jeswr/pod-photos`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Photos</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo="jeswr/pod-photos"
            appName="Pod Photos"
            appVersion={__APP_VERSION__}
            webId={webId}
          />
          <ThemeToggle />
          <AccountMenu
            webId={webId}
            displayName={session.displayName}
            avatarUrl={session.avatarUrl}
            onSignOut={logout}
          />
        </div>
      </header>
      {session.podRootIsFallback ? (
        <p className="app-note" role="note">
          Your profile advertises no <code>pim:storage</code>; using your WebID origin (
          <code>{session.podRoot}</code>) as the pod root.
        </p>
      ) : null}
      {photosRoot?.isFallback ? (
        <p className="app-note" role="note">
          No <code>schema:Photograph</code> container is registered in your Type Index; browsing the
          conventional <code>{photosRoot.rootUrl}</code> container.
        </p>
      ) : null}
      <main className="app-main">
        {photosRoot ? (
          // rootUrl only — no fetch prop: the global fetch is auth-patched, so the
          // gallery's `fetch?:` seam reads the pod with the DPoP token.
          <PhotoGallery rootUrl={photosRoot.rootUrl} title="Your photos" />
        ) : (
          // SOLID-ELEMENTS: the host-level "finding your photos" wait, now the themed
          // <jeswr-loading> spinner (via @lit/react) instead of a bare <output>. It
          // owns role="status" + aria-live; .app-loading keeps the muted colour
          // wrapper for layout parity.
          <p className="app-loading">
            <Loading label="Finding your photos…" />
          </p>
        )}
      </main>
    </div>
  );
}
