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
import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame, AppMain, useSessionResource } from "@jeswr/app-shell";
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
import { type PhotosRoot, resolvePhotosRoot } from "./photos-root";

export function App() {
  const { session, fetch, logout } = useSession();
  // Resolve the photos container under the derived pod root once a session exists. A
  // logout/identity change resets it to null so a stale discovery can't render; the
  // fallback is the conventional container, never stranding the gallery on an error.
  const photosRoot: PhotosRoot | null = useSessionResource(
    session,
    (s) => resolvePhotosRoot({ webId: s.webId, podRoot: s.podRoot, fetchImpl: fetch }),
    (s) => ({ rootUrl: `${s.podRoot}photos/`, isFallback: true }),
    [fetch],
  );

  return (
    <SessionGate
      appName="Pod Photos"
      login={<EnvLoginScreen appName="Pod Photos" env={import.meta.env} />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName="Pod Photos"
          feedback={{ repo: "jeswr/pod-photos", appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Photos", kind: "photos" }}
        >
          <AppMain
            value={photosRoot}
            loading={<Loading label="Finding your photos…" />}
            notice={<FallbackNote photosRoot={photosRoot} />}
          >
            {(photosRoot) => (
              <PhotoGallery
                key={JSON.stringify([session.webId, photosRoot.rootUrl])}
                rootUrl={photosRoot.rootUrl}
                fetch={fetch}
                title="Your photos"
              />
            )}
          </AppMain>
        </AppFrame>
      )}
    </SessionGate>
  );
}

function FallbackNote({ photosRoot }: { photosRoot: PhotosRoot | null }) {
  return photosRoot?.isFallback ? (
    <p className="app-note" role="note">
      No <code>schema:Photograph</code> container is registered in your Type Index; browsing the
      conventional <code>{photosRoot.rootUrl}</code> container.
    </p>
  ) : null;
}
