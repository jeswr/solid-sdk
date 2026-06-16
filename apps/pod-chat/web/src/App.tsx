// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a @jeswr/app-shell header (FeedbackButton + ThemeToggle + AccountMenu) over
// the LOCAL @jeswr/pod-chat <ChatRooms> pointed at the user's pod. The view
// receives NO `fetch` prop — it uses the ambient global fetch, which the
// SessionProvider patched via reactive-auth's registerGlobally(), so every
// read/write carries the DPoP token automatically.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { ChatRooms } from "@jeswr/pod-chat/ui";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout, autologinPending, restoring } = useSession();

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
    // SILENT SESSION RESTORE (cross-app UX invariant #1): a returning user who only
    // closed the tab is having their session silently re-established from the
    // persisted DPoP-bound refresh token (a token-endpoint fetch, no popup). Show a
    // brief "Restoring…" state rather than flashing the login form; we fall through
    // to <LoginScreen> only when the restore resolves to a genuine login fall-back.
    if (restoring) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Chat</h1>
            <p className="login-sub" role="status">
              Restoring your session…
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* The header uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountMenu/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-chat files against
          `jeswr/pod-chat`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Chat</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo="jeswr/pod-chat"
            appName="Pod Chat"
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
