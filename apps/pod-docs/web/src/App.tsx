// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (the shared app-shell chrome) over the LOCAL @jeswr/pod-docs
// <DocumentBrowser> pointed at the user's pod. The browser gets pod-auth's
// `auth.fetch` explicitly; global fetch is never patched.
import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
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
import { CollectionBrowser } from "./CollectionBrowser";
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
  const { webId, session, logout, fetch, restoringSession, ready, error } = useSession();

  if (!webId || !session) {
    // Restoring a remembered session (or loading the signed-in profile) shows a brief wait
    // instead of the sign-in card.
    if (restoringSession || (!ready && !error) || (webId && !session)) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Docs</h1>
            <p className="login-sub">
              <Loading
                label={restoringSession ? "Restoring your session…" : "Loading your account…"}
              />
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
        <CollectionBrowser
          key={JSON.stringify([session.webId, session.podRoot])}
          podRoot={session.podRoot}
          webId={session.webId}
          fetch={fetch}
        />
      </main>
    </div>
  );
}
