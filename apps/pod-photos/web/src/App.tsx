// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-photos <PhotoGallery>
// pointed at the user's photos container. The gallery receives NO `fetch` prop —
// it uses the ambient global fetch, which the SessionProvider patched via
// reactive-auth's registerGlobally(), so every read carries the DPoP token
// automatically.
//
// The gallery's `rootUrl` is the PHOTOS container. The host derives the pod root
// from the session (deriveSession — storages[0], else WebID origin) and then
// resolves the photos container under it via the library's read-only Type-Index
// discovery (resolvePhotosRoot — schema:Photograph instanceContainer, else
// ${podRoot}photos/). Discovery is async, so we show a brief "finding your
// photos…" state and surface a banner when either fallback is used.
import { PhotoGallery } from "@jeswr/pod-photos/ui";
import { useEffect, useState } from "react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";
import { type PhotosRoot, resolvePhotosRoot } from "./photos-root";

export function App() {
  const { webId, session, logout } = useSession();
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
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">Pod Photos</span>
        <span className="app-webid" title={webId}>
          {webId}
        </span>
        <button type="button" className="app-logout" onClick={logout}>
          Log out
        </button>
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
          <output className="app-loading">Finding your photos…</output>
        )}
      </main>
    </div>
  );
}
