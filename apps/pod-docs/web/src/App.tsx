// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// App — the host shell's router-free root: logged out → <LoginScreen>; logged in
// → a thin header (the shared app-shell chrome) over the LOCAL @jeswr/pod-docs
// <DocumentBrowser> pointed at the user's pod. The browser gets pod-auth's
// `auth.fetch` explicitly; global fetch is never patched.

import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
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
import { CollectionBrowser } from "./CollectionBrowser";

/**
 * The app-specific identity for the header <FeedbackButton/>, in ONE place so the
 * header wiring and the adoption test cannot drift: a filed issue must land on
 * THIS app's own repo. Exported so feedback-button.test.tsx asserts the SAME
 * values the header passes (and the generated issue URL targets jeswr/pod-docs).
 */
export const FEEDBACK_REPO = "jeswr/pod-docs";
export const FEEDBACK_APP_NAME = "Pod Docs";

export function App() {
  const { logout, fetch } = useSession();

  return (
    <SessionGate
      appName="Pod Docs"
      login={<AppLoginScreen />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
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
              <AccountControl
                webId={webId}
                displayName={session.displayName}
                avatarUrl={session.avatarUrl}
                onSignOut={logout}
              />
            </div>
          </header>
          {session.podRootIsFallback ? (
            <p className="app-note" role="note">
              Your profile doesn't list a storage address, so Docs can only show public documents at{" "}
              {session.podRoot}.
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
      )}
    </SessionGate>
  );
}

function AppLoginScreen() {
  return (
    <LoginScreen
      appName="Pod Docs"
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
