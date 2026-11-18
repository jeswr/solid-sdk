// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the router-free host over the LOCAL @jeswr/pod-photos <PhotoGallery>.
// Both Type Index discovery and the gallery receive pod-auth's fetch explicitly;
// global fetch stays public.
//
// The gallery's `rootUrl` is the PHOTOS container. The host derives the pod root
// from the session (deriveSession — storages[0], else WebID origin) and then
// resolves the photos container under it via the library's read-only Type-Index
// discovery (resolvePhotosRoot — schema:Photograph instanceContainer, else
// ${podRoot}photos/). Discovery is async, so we show a brief "finding your
// photos…" state and surface a banner when either fallback is used.
import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
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
import { type PhotosRoot, resolvePhotosRoot } from "./photos-root";

export function App() {
  const { session, fetch, logout } = useSession();
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
    resolvePhotosRoot({ webId: session.webId, podRoot: session.podRoot, fetchImpl: fetch })
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
  }, [session, fetch]);

  return (
    <SessionGate
      appName="Pod Photos"
      login={<AppLoginScreen />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
        <div className="app-shell">
          {/* The header now uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountControl/> (account menu or extension-aware Sign out). The
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
              <AccountControl
                webId={webId}
                displayName={session.displayName}
                avatarUrl={session.avatarUrl}
                onSignOut={logout}
              />
            </div>
          </header>
          {session.podRootIsFallback ? (
            <p className="app-note" role="note">
              Your profile doesn't list a storage address, so Photos can only show public photos at{" "}
              {session.podRoot}.
            </p>
          ) : null}
          {photosRoot?.isFallback ? (
            <p className="app-note" role="note">
              No <code>schema:Photograph</code> container is registered in your Type Index; browsing
              the conventional <code>{photosRoot.rootUrl}</code> container.
            </p>
          ) : null}
          <main className="app-main">
            {photosRoot ? (
              <PhotoGallery
                key={JSON.stringify([session.webId, photosRoot.rootUrl])}
                rootUrl={photosRoot.rootUrl}
                fetch={fetch}
                title="Your photos"
              />
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
      )}
    </SessionGate>
  );
}

function AppLoginScreen() {
  return (
    <LoginScreen
      appName="Pod Photos"
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
