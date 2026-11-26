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

import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame, AppMain, useSessionResource } from "@jeswr/app-shell";
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
import { APP_NAME } from "./auth/pod-auth";
import { discoverMusicBase, type MusicBase } from "./music-base";

export function App() {
  const { session, logout, fetch } = useSession();
  // The resolved music base + how it was discovered; null while resolving. The store's own
  // `base` is irrelevant to discovery (findTrackContainers reads the type index off the
  // WebID); seed it with the conventional path so the constructor's container assertion passes.
  const musicBase: MusicBase | null = useSessionResource(
    session,
    (s) => discoverMusicBase(new MusicStore({ base: `${s.podRoot}music/`, fetch }), s),
    (s) => ({ base: `${s.podRoot}music/`, isFallback: true }),
    [fetch],
  );

  return (
    <SessionGate
      appName="Pod Music"
      login={<EnvLoginScreen appName={APP_NAME} env={import.meta.env} />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName="Pod Music"
          feedback={{ repo: "jeswr/pod-music", appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Music", kind: "music", podRootAsCode: true }}
        >
          <AppMain
            value={musicBase}
            loading={<Loading label="Finding your music library…" />}
            notice={<FallbackNote musicBase={musicBase} />}
          >
            {(musicBase) => (
              <MusicLibrary
                key={JSON.stringify([session.webId, musicBase.base])}
                base={musicBase.base}
                title="Your music library"
                fetch={fetch}
              />
            )}
          </AppMain>
        </AppFrame>
      )}
    </SessionGate>
  );
}

function FallbackNote({ musicBase }: { musicBase: MusicBase | null }) {
  return musicBase?.isFallback ? (
    <p className="app-note" role="note">
      No <code>mo:Track</code> registration was found in your Type Index; using the conventional{" "}
      <code>{musicBase.base}</code> container.
    </p>
  ) : null;
}
