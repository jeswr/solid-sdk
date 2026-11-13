// AUTHORED-BY Claude Fable 5
// AUTHORED-BY GPT-6.1 Sol
// The auth provider mirrors pod-auth; the access views retain their { webId, fetch } session.

import { LoginScreen, SessionGate, useSession as useAuthSession } from "@jeswr/app-session/react";
import { AccountControl, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import { useEffect, useMemo, useState } from "react";
import { APP_NAME } from "../auth/pod-auth.js";
import { type Session, SessionProvider, useSession } from "../auth/SessionContext.js";
import { clearAgentDisplayCache } from "../lib/profile.js";
import { DashboardView } from "./DashboardView.jsx";
import { DataClassView } from "./DataClassView.jsx";
import { HistoryView } from "./HistoryView.jsx";
import { InboxView } from "./InboxView.jsx";
import { useAccessData } from "./useAccessData.js";

export type Tab = "dashboard" | "classes" | "inbox" | "history";

export function App() {
  const { webId, fetch, logout } = useAuthSession();
  // Access Manager discovers every advertised storage itself and preserves its public context.
  const session = useMemo<Session | null>(() => (webId ? { webId, fetch } : null), [webId, fetch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: discard cached profiles when the account or its transport changes.
  useEffect(() => clearAgentDisplayCache, [session]);
  return (
    <SessionGate
      appName={APP_NAME}
      login={
        <LoginScreen
          appName={APP_NAME}
          knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
          homeIdp={import.meta.env.VITE_HOME_IDP}
          homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
          dev={import.meta.env.DEV}
        />
      }
    >
      {({ webId }) => (
        <SessionProvider session={session}>
          <Shell key={webId} webId={webId} onSignOut={() => void logout()} />
        </SessionProvider>
      )}
    </SessionGate>
  );
}

export function Shell({
  webId,
  onSignOut,
  initialTab = "dashboard",
}: {
  webId: string;
  onSignOut: () => void;
  /** Starting tab (the ?demo deep-link seam); the real app always defaults. */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const session = useSession();
  const data = useAccessData(session);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Solid Access Manager</h1>
        <nav aria-label="Sections">
          <div role="tablist">
            {(
              [
                ["dashboard", "Shared"],
                ["classes", "Data classes"],
                ["inbox", "Requests"],
                ["history", "History"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
        <div className="header-actions">
          <FeedbackButton
            repo="jeswr/solid-access-manager"
            appName="Solid Access Manager"
            webId={webId}
          />
          <ThemeToggle />
          <AccountControl webId={webId} onSignOut={onSignOut} />
        </div>
      </header>

      {data.storages.length > 1 && !data.storageRoot ? (
        <main className="storage-picker">
          <h2>Choose a storage</h2>
          <p>Your profile advertises several storages — pick which one to manage:</p>
          <ul>
            {data.storages.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => data.setStorageRoot(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </main>
      ) : (
        <main>
          {data.error ? (
            <p role="alert" className="notice error">
              {data.error}
            </p>
          ) : null}
          {tab === "dashboard" ? (
            <DashboardView
              nodes={data.nodes}
              storageRoot={data.storageRoot}
              walking={data.walking}
              onChanged={data.refresh}
            />
          ) : tab === "classes" ? (
            <DataClassView
              nodes={data.nodes}
              registrations={data.registrations}
              storageRoot={data.storageRoot}
              walking={data.walking}
            />
          ) : tab === "inbox" ? (
            <InboxView
              inboxUrl={data.inboxUrl}
              storageRoot={data.storageRoot}
              registrations={data.registrations}
              nodes={data.nodes}
              onChanged={data.refresh}
            />
          ) : (
            <HistoryView storageRoot={data.storageRoot} onChanged={data.refresh} />
          )}
        </main>
      )}
    </div>
  );
}
