// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-music <MusicLibrary>
// pointed at the user's music library container. Both discovery and library reads
// receive pod-auth's `auth.fetch` explicitly; global fetch stays public.
//
// MUSIC-BASE RESOLUTION: <MusicLibrary base /> needs the music library CONTAINER
// (the data layer derives `tracks/`/`albums/`/`playlists/` under it), not a bare
// pod root. So after login we resolve `base` via the data layer's Type-Index
// discovery (`MusicStore.findTrackContainers` → the parent of a registered
// `tracks/` container), falling back to the conventional `${podRoot}music/` and
// surfacing a banner when no registration is found (see music-base.ts).

import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { MusicStore } from "@jeswr/pod-music";
import { MusicLibrary } from "@jeswr/pod-music/ui";
// SOLID-ELEMENTS (#67/#68/#70 D-parity rollout): the framework-agnostic W3C Web
// Components consumed through the `./react` (@lit/react) adapter. <Loading> is a Lit
// custom element (spinner + polite-live label, prefers-reduced-motion aware) wrapped
// by @lit/react's createComponent. It themes itself from the SAME app-shell OKLCH
// tokens as the rest of the chrome: its shadow-DOM styles read `--jeswr-*`, which fall
// back through the shadow boundary to app-shell's `--primary` / `--border` /
// `--muted-foreground` (set by styles.css and flipped by the `.dark` class), so it
// follows light/dark for free with no extra wiring. (COMPLEMENTS app-shell — it does
// not replace the React chrome components above.) Plain Vite/CSR React has no SSR step,
// so the client-only custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { useEffect, useState } from "react";
import { APP_NAME } from "./auth/pod-auth";
import { discoverMusicBase, type MusicBase } from "./music-base";

export function App() {
  const { session, logout, fetch } = useSession();
  // The resolved music base + how it was discovered; null while resolving.
  const [musicBase, setMusicBase] = useState<MusicBase | null>(null);

  // Resolve the music library container with the session's bounded fetch.
  useEffect(() => {
    if (!session) {
      setMusicBase(null);
      return;
    }
    let cancelled = false;
    // The store's own `base` is irrelevant to discovery (findTrackContainers reads
    // the type index off the WebID); seed it with the conventional path so the
    // constructor's container assertion passes.
    const store = new MusicStore({ base: `${session.podRoot}music/`, fetch });
    discoverMusicBase(store, session)
      .then((resolved) => {
        if (!cancelled) setMusicBase(resolved);
      })
      .catch(() => {
        // discoverMusicBase already falls back internally; this is belt-and-braces
        // so a thrown rejection can never strand the view with no base.
        if (!cancelled) {
          setMusicBase({ base: `${session.podRoot}music/`, isFallback: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, fetch]);

  return (
    <SessionGate
      appName="Pod Music"
      login={<AppLoginScreen />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
        <div className="app-shell">
          {/* The header uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountControl/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-music files against
          `jeswr/pod-music`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
          <header className="app-header">
            <span className="app-brand">Pod Music</span>
            <div className="app-header-actions">
              <FeedbackButton
                repo="jeswr/pod-music"
                appName="Pod Music"
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
              Your profile doesn't list a storage address, so Music can only show public music at{" "}
              <code>{session.podRoot}</code>.
            </p>
          ) : null}
          {musicBase?.isFallback ? (
            <p className="app-note" role="note">
              No <code>mo:Track</code> registration was found in your Type Index; using the
              conventional <code>{musicBase.base}</code> container.
            </p>
          ) : null}
          <main className="app-main">
            {musicBase ? (
              <MusicLibrary
                key={JSON.stringify([session.webId, musicBase.base])}
                base={musicBase.base}
                title="Your music library"
                fetch={fetch}
              />
            ) : (
              // SOLID-ELEMENTS: the host-level "finding your library" wait, now the themed
              // <jeswr-loading> spinner (via @lit/react) instead of a bare <p>. It owns
              // role="status" + aria-live; .app-loading keeps the muted colour wrapper for
              // layout parity.
              <p className="app-loading">
                <Loading label="Finding your music library…" />
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
      appName={APP_NAME}
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
