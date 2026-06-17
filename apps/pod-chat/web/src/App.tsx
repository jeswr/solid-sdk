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
// SOLID-ELEMENTS (#67/#68/#70 D-parity rollout): the framework-agnostic W3C Web
// Component <jeswr-loading> — a Lit custom element (spinner + polite-live label,
// prefers-reduced-motion aware). We import the package BARE entry for its
// registration side-effect (`customElements.define("jeswr-loading", …)`), then render
// the element DIRECTLY with `label` as a DOM ATTRIBUTE (typed in custom-elements.d.ts).
//
// WHY the raw element, not the @lit/react `Loading` wrapper: the wrapper forwards
// `label` as a PROPERTY, and @lit/react classifies props at createComponent-time —
// before Lit finalises the element class — so under React 19 the `label` property can
// silently fail to land, dropping the VISIBLE + ANNOUNCED status copy (verified: the
// wrapper renders no label text and the aria-label falls back to "Loading"). The Lit
// reactive `label` property auto-observes the lowercased `label` ATTRIBUTE, and the
// attribute path is environment-independent + verified — so it reliably shows AND
// announces the message. (Upstream follow-up: make the wrapper reflect `label`.)
//
// The element themes itself from the SAME app-shell OKLCH tokens as the rest of the
// chrome: its shadow-DOM styles read `--jeswr-*`, which fall back through the shadow
// boundary to app-shell's `--primary` / `--border` / `--muted-foreground` (set by
// styles.css, flipped by `.dark`), so it follows light/dark for free. (COMPLEMENTS
// app-shell — it does not replace the React chrome above.) Plain Vite/CSR React has
// no SSR step, so the client-only custom element needs no mount-gating here.
import "@jeswr/solid-elements";
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
            {/* SOLID-ELEMENTS: the <jeswr-loading> spinner + label. It carries its own
                role="status" + aria-live (in its shadow root), so the label is
                announced; we keep the .login-sub wrapper only for the existing
                spacing/typography (the redundant role="status" is dropped). `label` is
                passed as a DOM attribute — see the import note. */}
            <p className="login-sub">
              <jeswr-loading label="Signing you in…" />
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
            {/* SOLID-ELEMENTS: the <jeswr-loading> spinner + label, replacing the bare
                <p role="status">. The element owns role="status" + aria-live in its
                shadow root; .login-sub stays for spacing parity. `label` is a DOM
                attribute (see the import note). */}
            <p className="login-sub">
              <jeswr-loading label="Restoring your session…" />
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
