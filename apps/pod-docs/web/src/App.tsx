// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (the shared app-shell chrome) over the LOCAL @jeswr/pod-docs
// <DocumentBrowser> pointed at the user's pod. The browser receives NO `fetch`
// prop — it uses the ambient global fetch, which the SessionProvider patched via
// the @jeswr/solid-elements PROACTIVE auth-fetch seam (installProactiveAuthFetch,
// task #123), so every read/write PROACTIVELY carries the DPoP token on the FIRST
// request to an allowed origin — no per-resource 401-dance.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { DocumentBrowser } from "@jeswr/pod-docs/ui";
// SOLID-ELEMENTS (#115 / D-parity rollout #67/#68/#70): the framework-agnostic W3C
// Web Components consumed through the @lit/react adapter. <Loading> is a Lit custom
// element (spinner + polite-live label, prefers-reduced-motion aware) wrapped by
// @lit/react's createComponent. It themes itself from the SAME app-shell OKLCH
// tokens as the rest of the chrome: its shadow-DOM styles read `--jeswr-*`, which
// fall back through the shadow boundary to app-shell's `--primary` / `--border` /
// `--muted-foreground` (set by styles.css and flipped by the `.dark` class), so it
// follows light/dark for free with no extra wiring. (COMPLEMENTS app-shell — it does
// not replace the React chrome components above.) Plain Vite/CSR React has no SSR
// step, so the client-only custom elements need no mount-gating here.
import { Loading } from "@jeswr/solid-elements/react";
import { useSession } from "./auth/SessionProvider";
import { LoginScreen } from "./LoginScreen";

/**
 * The app-specific identity for the header <FeedbackButton/>, in ONE place so the
 * header wiring and the adoption test cannot drift: a filed issue must land on
 * THIS app's own repo. Exported so feedback-button.test.tsx asserts the SAME
 * values the header passes (and the generated issue URL targets jeswr/pod-docs).
 */
export const FEEDBACK_REPO = "jeswr/pod-docs";
export const FEEDBACK_APP_NAME = "Pod Docs";

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
            <h1>Pod Docs</h1>
            {/* SOLID-ELEMENTS: the <jeswr-loading> spinner + label (via @lit/react).
                It carries its own role="status" + aria-live, so the label is
                announced; the .login-sub wrapper only keeps the existing
                spacing/typography. */}
            <p className="login-sub">
              <Loading label="Signing you in…" />
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

          FEEDBACK: `repo` is the only app-specific value — pod-docs files against
          `jeswr/pod-docs`. `appVersion` is the build SHA injected by Vite
          (`__APP_VERSION__`), so a filed issue pins the deployed commit. `webId` is
          attached to diagnostics ONLY if the reporter ticks the consent box. `submit`
          is intentionally UNSET → the dialog uses the GitHub prefill page; the
          feedback-proxy hook is wired suite-wide later. */}
      <header className="app-header">
        <span className="app-brand">Pod Docs</span>
        <div className="app-header-actions">
          <FeedbackButton
            repo={FEEDBACK_REPO}
            appName={FEEDBACK_APP_NAME}
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
        {/* podRoot + webId only — DocsStore discovers the documents container via
            the Type Index (else falls back to ${podRoot}pod-docs/). No fetch prop:
            the global fetch is auth-patched. */}
        <DocumentBrowser podRoot={session.podRoot} webId={session.webId} title="Your documents" />
      </main>
    </div>
  );
}
