// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6

import { LoginScreen, SessionProvider, useSession } from "@jeswr/app-session/react";
import { AccountMenu } from "@jeswr/app-shell";
import { useEffect } from "react";
import type { ConnectionState, PodConnection } from "../auth/connections.js";
import { legacyCredentials } from "../auth/pod-auth.js";

export function ConnectionCard({
  connection,
  state,
  side,
  disabled,
}: {
  connection: PodConnection;
  state: ConnectionState;
  side: "source" | "target";
  disabled: boolean;
}) {
  return (
    <SessionProvider
      getPodAuth={connection.getPodAuth}
      appName="Pod Migrator"
      dev={import.meta.env.DEV}
      legacyCredentials={legacyCredentials[connection.id]}
    >
      <ConnectionContent connection={connection} state={state} side={side} disabled={disabled} />
    </SessionProvider>
  );
}

function ConnectionContent({
  connection,
  state,
  side,
  disabled,
}: {
  connection: PodConnection;
  state: ConnectionState;
  side: "source" | "target";
  disabled: boolean;
}) {
  const session = useSession();
  useEffect(() => {
    void connection.updateSession(session);
  }, [connection, session]);
  const title = side === "source" ? "Copy from" : "Copy to";
  const pending = state.status === "restoring" || state.status === "loading";
  return (
    <section
      className={`connection-card ${state.root ? "is-connected" : ""}`}
      aria-label={`${side} connection`}
    >
      <div className="card-top">
        <span className="eyebrow">{title}</span>
        <span className={`badge ${state.root ? "connected" : ""}`}>
          {state.root ? "Connected" : pending ? "Connecting…" : "Not connected"}
        </span>
      </div>
      <h3>{side === "source" ? "Source pod" : "Destination pod"}</h3>
      {state.webId && (
        <>
          <div className="account-line">
            <span className="muted">
              WebID <abbr title="Your public Solid account identifier">ⓘ</abbr>
            </span>
            <div className="account-menu-wrap" inert={disabled}>
              <AccountMenu
                webId={state.webId}
                displayName={`${side === "source" ? "Source" : "Target"} account`}
                onSignOut={() => {
                  void connection.logout();
                }}
              />
            </div>
          </div>
          <p className="identity">{state.webId}</p>
        </>
      )}
      {state.roots.length > 1 && (
        <label className="field">
          Choose storage
          <select
            value={state.root ?? ""}
            disabled={disabled || pending}
            onChange={(event) => {
              void connection.selectStorage(event.target.value);
            }}
          >
            <option value="" disabled>
              Select a storage location
            </option>
            {state.roots.map((root) => (
              <option value={root} key={root}>
                {root}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.root && (
        <div className="storage-location">
          <span className="muted">Storage location</span>
          <p>{state.root}</p>
          <span className="muted">Server type</span>
          <p>
            {state.implementation === "ess"
              ? "Enterprise Solid Server (ESS)"
              : state.implementation === "css"
                ? "Community Solid Server (CSS)"
                : state.implementation === "nss"
                  ? "Node Solid Server (NSS)"
                  : "Unknown"}
          </p>
        </div>
      )}
      {state.root &&
        side === "target" &&
        state.accessSystem === "acp" &&
        state.implementation !== "css" &&
        state.implementation !== "ess" && (
          <p className="notice" role="status">
            This pod uses ACP permissions, but its server type could not be confirmed. Migration
            into it is blocked to keep your permissions safe. Ask your provider to expose the
            X-Powered-By response header through CORS, then reconnect, or choose another target pod.
          </p>
        )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {pending && (
        <p role="status">
          {state.status === "restoring" ? "Restoring your sign-in…" : "Connecting to your account…"}
        </p>
      )}
      {!state.webId && (session.ready || session.startupFailed) && (
        <fieldset className="connection-sign-in" disabled={disabled}>
          <legend className="sr-only">
            {side === "source" ? "Source pod" : "Destination pod"} sign-in
          </legend>
          <LoginScreen
            appName={
              side === "source" ? "Pod Migrator · Source pod" : "Pod Migrator · Destination pod"
            }
            knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
            homeIdp={import.meta.env.VITE_HOME_IDP}
            homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
            dev={import.meta.env.DEV}
          />
        </fieldset>
      )}
      {state.webId && !pending && !state.root && state.status === "error" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void connection.readProfile();
          }}
        >
          Retry profile
        </button>
      )}
      <p className="connection-footnote">
        {side === "source"
          ? "Your source files stay in place."
          : "You’ll review every permission change first."}
      </p>
    </section>
  );
}
