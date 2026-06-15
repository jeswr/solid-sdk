// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-docs <DocumentBrowser>
// pointed at the user's pod. The browser receives NO `fetch` prop — it uses the
// ambient global fetch, which the SessionProvider patched via reactive-auth's
// registerGlobally(), so every read/write carries the DPoP token automatically.
import { DocumentBrowser } from "@jeswr/pod-docs/ui";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout } = useSession();

  if (!webId || !session) {
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">Pod Docs</span>
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
      <main className="app-main">
        {/* podRoot + webId only — DocsStore discovers the documents container via
            the Type Index (else falls back to ${podRoot}pod-docs/). No fetch prop:
            the global fetch is auth-patched. */}
        <DocumentBrowser podRoot={session.podRoot} webId={session.webId} title="Your documents" />
      </main>
    </div>
  );
}
