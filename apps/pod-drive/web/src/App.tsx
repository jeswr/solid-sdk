// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (WebID + logout) over the LOCAL @jeswr/pod-drive <FileBrowser>
// pointed at the user's pod ROOT. The browser receives NO `fetch` prop — it uses
// the ambient global fetch, which the SessionProvider patched via the
// @jeswr/solid-elements PROACTIVE auth-fetch (task #123), so every read carries the
// DPoP token automatically AND up front (the token is attached on the FIRST request
// to the pod origin — no per-resource 401-dance; see @jeswr/solid-elements/auth's
// installProactiveAuthFetch, wired in auth/SessionProvider.tsx).
//
// rootUrl = the pod ROOT (storages[0], else the WebID-origin fallback). Pod
// Drive's data layer (`listContainer`) GETs that container directly and lets the
// user descend the whole LDP container tree from there — it has NO Type-Index
// discovery step (unlike pod-docs's DocsStore), so the host hands it the pod root
// and the file tree starts there.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { FileBrowser } from "@jeswr/pod-drive/ui";
// SOLID-ELEMENTS (#115 / D-parity rollout #67/#68/#70): the framework-agnostic W3C
// Web Components consumed through the @lit/react adapter. <Loading> is a Lit custom
// element (spinner + polite-live label, prefers-reduced-motion aware) wrapped by
// @lit/react's createComponent. It themes itself from the SAME app-shell OKLCH
// tokens as the rest of the chrome: its shadow-DOM styles read `--jeswr-*`, which
// fall back through the shadow boundary to app-shell's `--primary` / `--border` /
// `--muted-foreground` (set by styles.css and flipped by the `.dark` class), so it
// follows light/dark for free with no extra wiring. (COMPLEMENTS app-shell — it does
// not replace the React chrome components below.) Plain Vite/CSR React has no SSR
// step, so the client-only custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

export function App() {
  const { webId, session, logout, autologinPending, restoringSession } = useSession();

  if (!webId || !session) {
    // Autologin (a Pod-Manager deep-link or a redirect return) is silently signing
    // the user in via a full-page redirect — show a brief restoring state rather than
    // the interactive login form, since there is no gesture to prompt for.
    if (autologinPending) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Drive</h1>
            {/* SOLID-ELEMENTS: the <jeswr-loading> spinner + label (via @lit/react)
                replaces the bare wait <p>. It carries its own role="status" +
                aria-live, so the label is announced; the .login-sub wrapper only
                keeps the existing spacing/typography (its redundant role="status"
                is dropped so the page has a single live region). */}
            <p className="login-sub">
              <Loading label="Signing you in…" />
            </p>
          </section>
        </main>
      );
    }
    // SILENT SESSION RESTORE (#69 P0): a returning user's session is being rebuilt from
    // a persisted DPoP-bound refresh token (no popup/redirect). Paint a brief restoring
    // state instead of the login form — only ever shown when there is actually a
    // remembered pointer to attempt, so a first-time user sees the login form with no
    // flash.
    if (restoringSession) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Drive</h1>
            {/* SOLID-ELEMENTS: same themed <jeswr-loading> for the silent
                session-restore (#69) wait, replacing the bare wait <p>. It owns
                role="status" + aria-live; .login-sub keeps the spacing/typography
                (its redundant role="status" is dropped so the page has a single
                live region). This does NOT touch the SessionProvider /
                session-restore logic — only the host-level wait STATE it paints. */}
            <p className="login-sub">
              <Loading label="Restoring your session…" />
            </p>
          </section>
        </main>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* The header now uses the shared @jeswr/app-shell chrome: a header-level
          <FeedbackButton/> (opens a themed dialog that files a GitHub issue against
          THIS app's own repo), a light/dark/system <ThemeToggle/>, and a real
          top-right <AccountMenu/> (avatar + display name, dropdown showing the WebID
          + Sign out) — replacing the old raw-WebID span + bare logout button. The
          session's WebID / profile name / avatar / logout wire straight into the
          props (the components are fully decoupled — everything is a prop).
          `app-header-actions` right-aligns the trio.

          FEEDBACK: `repo` is the only app-specific value — pod-drive files against
          `jeswr/pod-drive`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Drive</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo="jeswr/pod-drive"
            appName="Pod Drive"
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
