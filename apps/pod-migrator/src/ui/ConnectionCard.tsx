// AUTHORED-BY Codex GPT-6
import { AccountMenu } from "@jeswr/app-shell";
import { useState } from "react";
import type { ConnectionState, PodConnection } from "../auth/connections.js";

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
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"webid" | "issuer">("webid");
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
      <h3>{side === "source" ? "Source pod" : "Target pod"}</h3>
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
            onChange={(event) => connection.selectStorage(event.target.value)}
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
        </div>
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
      {!state.root && !pending && !state.webId && (
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connection.login(value, kind);
          }}
        >
          <label className="field">
            Sign in with
            <select
              disabled={disabled}
              value={kind}
              onChange={(event) => setKind(event.target.value as "webid" | "issuer")}
            >
              <option value="webid">My WebID</option>
              <option value="issuer">My identity provider</option>
            </select>
          </label>
          <label className="field">
            {kind === "webid" ? "WebID URL" : "Identity provider URL"}
            <input
              type="url"
              required
              disabled={disabled}
              value={value}
              autoComplete="url"
              placeholder={
                kind === "webid" ? "https://you.example/profile/card#me" : "https://login.example"
              }
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={disabled || !value.trim()}>
            Sign in to {side}
          </button>
          <p className="muted quick-pick-label">Or choose a provider</p>
          <div className="quick-picks">
            {[
              ["Inrupt PodSpaces", "https://login.inrupt.com"],
              ["solidcommunity.net", "https://solidcommunity.net"],
            ].map(([label, issuer]) => (
              <button
                key={issuer}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (issuer) void connection.login(issuer, "issuer");
                }}
              >
                {label}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </form>
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
