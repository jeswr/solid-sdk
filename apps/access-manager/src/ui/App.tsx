// AUTHORED-BY Claude Fable 5
//
// App root: logged out → <jeswr-login-panel> (suite login + silent session
// restore); logged in → the @jeswr/app-shell chrome (theme / account menu /
// feedback) over the four access-management views. The LoginController is
// injected from main.tsx so this component is testable with a mock controller.

import { AccountMenu, FeedbackButton, ThemeToggle } from "@jeswr/app-shell";
import type { LoginController, SessionChangeDetail } from "@jeswr/solid-elements";
import { LoginPanel } from "@jeswr/solid-elements/react";
import { useMemo, useState } from "react";
import { type Session, SessionProvider, useSession } from "../auth/SessionContext.js";
import { DashboardView } from "./DashboardView.jsx";
import { DataClassView } from "./DataClassView.jsx";
import { HistoryView } from "./HistoryView.jsx";
import { InboxView } from "./InboxView.jsx";
import { useAccessData } from "./useAccessData.js";

export type Tab = "dashboard" | "classes" | "inbox" | "history";

export function App({ controller }: { controller: LoginController }) {
  const [webId, setWebId] = useState<string | null>(null);

  const session: Session | null = useMemo(
    () => (webId ? { webId, fetch: controller.authenticatedFetch } : null),
    [webId, controller],
  );

  const onSessionChange = (event: CustomEvent<SessionChangeDetail>) => {
    setWebId(event.detail.loggedIn ? event.detail.webId : null);
  };

  if (!session) {
    return (
      <main className="login-screen">
        <h1>Solid Access Manager</h1>
        <p className="tagline">
          See, review, grant and revoke access to your pod — in plain terms.
        </p>
        <LoginPanel controller={controller} onSessionChange={onSessionChange} />
      </main>
    );
  }

  return (
    <SessionProvider session={session}>
      <Shell
        webId={session.webId}
        onSignOut={() => void controller.logout().then(() => setWebId(null))}
      />
    </SessionProvider>
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
          <AccountMenu webId={webId} onSignOut={onSignOut} />
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
