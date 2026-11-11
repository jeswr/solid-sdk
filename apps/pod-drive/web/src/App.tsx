// AUTHORED-BY Codex GPT-6.1-Sol

import { LoginScreen, useSession } from "@jeswr/app-session/react";
import {
  AccountMenu,
  Button,
  ErrorBoundary,
  FeedbackButton,
  ThemeToggle,
  useSolidExtensionPresent,
} from "@jeswr/app-shell";
import { FileBrowser } from "@jeswr/pod-drive/ui";
import { Loading } from "@jeswr/solid-elements/react";

export function App() {
  const { webId } = useSession();
  return (
    <ErrorBoundary resetKey={webId}>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const { webId, session, logout, fetch, restoringSession, ready, error } = useSession();
  const extensionPresent = useSolidExtensionPresent();
  if (!webId || !session) {
    if (restoringSession || (!ready && !error) || (webId && !session)) {
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>Pod Drive</h1>
            <p className="login-sub">
              <Loading
                label={restoringSession ? "Restoring your session…" : "Loading your account…"}
              />
            </p>
          </section>
        </main>
      );
    }
    return <AppLoginScreen />;
  }
  return (
    <div className="app-shell">
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
          {/* The extension owns the profile menu. Drive still owns its session and logout. */}
          {extensionPresent ? (
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          ) : (
            <AccountMenu
              webId={webId}
              displayName={session.displayName}
              avatarUrl={session.avatarUrl}
              onSignOut={logout}
            />
          )}
        </div>
      </header>
      {session.podRootIsFallback && (
        <p className="app-note" role="note">
          Your profile doesn't list a storage address, so Drive can only show public files at{" "}
          {session.podRoot}.
        </p>
      )}
      <main className="app-main">
        <FileBrowser rootUrl={session.podRoot} fetch={fetch} title="Your files" />
      </main>
    </div>
  );
}

function AppLoginScreen() {
  return (
    <LoginScreen
      appName="Drive"
      knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
      homeIdp={import.meta.env.VITE_HOME_IDP}
      homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
      dev={import.meta.env.DEV}
    />
  );
}
