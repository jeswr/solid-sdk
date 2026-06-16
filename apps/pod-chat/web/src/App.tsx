// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-chat <ChatRooms>
// pointed at the user's pod. The view receives NO `fetch` prop — it uses the
// ambient global fetch, which the SessionProvider patched via reactive-auth's
// registerGlobally(), so every read/write carries the DPoP token automatically.
import { ChatRooms } from "@jeswr/pod-chat/ui";
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
            <h1>Pod Chat</h1>
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
        <span className="app-brand">Pod Chat</span>
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
        {/* podRoot + webId only — ChatStore derives the pod-chat/rooms/ +
            pod-chat/messages/ containers from the pod root (and registers them in
            the user's Type Index for cross-app discovery). No fetch prop: the
            global fetch is auth-patched. */}
        <ChatRooms podRoot={session.podRoot} webId={session.webId} title="Your chat" />
      </main>
    </div>
  );
}
