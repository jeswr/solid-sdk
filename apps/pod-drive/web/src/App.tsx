// AUTHORED-BY Codex GPT-6.1-Sol

import { LoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AccountControl, ErrorBoundary, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
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
  const { logout, fetch } = useSession();
  return (
    <SessionGate
      appName="Pod Drive"
      login={<AppLoginScreen />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ webId, session }) => (
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
              <AccountControl
                webId={webId}
                displayName={session.displayName}
                avatarUrl={session.avatarUrl}
                onSignOut={logout}
              />
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
      )}
    </SessionGate>
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
