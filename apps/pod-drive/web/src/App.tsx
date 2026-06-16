// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-drive <FileBrowser>
// pointed at the user's pod ROOT. The browser receives NO `fetch` prop — it uses
// the ambient global fetch, which the SessionProvider patched via reactive-auth's
// registerGlobally(), so every read carries the DPoP token automatically.
//
// rootUrl = the pod ROOT (storages[0], else the WebID-origin fallback). Pod
// Drive's data layer (`listContainer`) GETs that container directly and lets the
// user descend the whole LDP container tree from there — it has NO Type-Index
// discovery step (unlike pod-docs's DocsStore), so the host hands it the pod root
// and the file tree starts there.
import { FileBrowser } from "@jeswr/pod-drive/ui";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout, autologinPending } = useSession();

  if (!webId || !session) {
    // Autologin (a Pod-Manager deep-link or a redirect return) is silently signing
    // the user in via a full-page redirect — show a brief restoring state rather than
    // the interactive login form, since there is no gesture to prompt for.
    if (autologinPending) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Drive</h1>
            <p className="login-sub" role="status">
              Signing you in…
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">Pod Drive</span>
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
          <code>{session.podRoot}</code>) as the drive root.
        </p>
      ) : null}
      <main className="app-main">
        {/* rootUrl = the pod root. No fetch prop: the global fetch is auth-patched
            so reads of the (private) container tree carry the DPoP token. */}
        <FileBrowser rootUrl={session.podRoot} title="Your files" />
      </main>
    </div>
  );
}
