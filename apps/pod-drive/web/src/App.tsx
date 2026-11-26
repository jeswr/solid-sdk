// AUTHORED-BY Codex GPT-6.1-Sol

import { EnvLoginScreen, SessionGate, useSession } from "@jeswr/app-session/react";
import { AppFrame, ErrorBoundary } from "@jeswr/app-shell";
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
      login={<EnvLoginScreen appName="Drive" env={import.meta.env} />}
      renderLoading={(label) => <Loading label={label} />}
    >
      {({ session }) => (
        <AppFrame
          appName="Pod Drive"
          feedback={{ repo: "jeswr/pod-drive", appVersion: __APP_VERSION__ }}
          session={session}
          onSignOut={logout}
          storageNote={{ product: "Drive", kind: "files" }}
        >
          <main className="app-main">
            <FileBrowser rootUrl={session.podRoot} fetch={fetch} title="Your files" />
          </main>
        </AppFrame>
      )}
    </SessionGate>
  );
}
