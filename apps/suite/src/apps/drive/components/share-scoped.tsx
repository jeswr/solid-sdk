// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * The scope-aware sharing editor (sst-uo4.4): for a folder whose own access differs from the
 * access of the items inside it, show and change each scope, or make them match.
 */
import { Button } from "@jeswr/suite-ui";
import { useEffect, useId, useState } from "react";
import {
  applyScopedSharing,
  loadScopedSharing,
  type ScopedSharingSelection,
  type ScopedSharingSnapshot,
  SharingConflictError,
  type SharingSession,
} from "../lib/sharing/adapter";
import type { SharingRole, SharingState } from "../lib/sharing/types";

type Scope = "folder" | "contents";
const TITLES: Record<Scope, string> = { folder: "This folder", contents: "Items inside" };

/** Whether both scopes give everyone the same access, so the ordinary dialog applies again. */
export function scopesMatch(snapshot: ScopedSharingSnapshot): boolean {
  const roles = (state: SharingState) =>
    JSON.stringify([state.link, state.people.map((person) => [person.webId, person.role]).sort()]);
  return roles(snapshot.folder) === roles(snapshot.contents);
}

function RoleSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: SharingRole;
  disabled: boolean;
  onChange: (role: SharingRole) => void;
}) {
  const id = useId();
  return (
    <div className="su-stack su-small-gap">
      <label className="su-label" htmlFor={id}>
        {label}
      </label>
      <select
        className="su-input"
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as SharingRole)}
      >
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
        {value === "owner" && <option value="owner">Owner</option>}
      </select>
    </div>
  );
}

function ScopeSection({
  scope,
  state,
  webId,
  blocked,
  onChange,
}: {
  scope: Scope;
  state: SharingState;
  webId: string;
  blocked: boolean;
  onChange: (next: SharingState) => void;
}) {
  const generalId = useId();
  const title = TITLES[scope];
  const where = scope === "folder" ? "this folder" : "items inside";
  const person = (id: string, next?: SharingRole) =>
    onChange({
      ...state,
      people: state.people.flatMap((p) =>
        p.webId === id ? (next ? [{ ...p, role: next }] : []) : [p],
      ),
    });
  return (
    <section className="su-stack" aria-label={title}>
      <h3>{title}</h3>
      {!state.people.length && <p className="su-muted">No people have access.</p>}
      <ul className="su-stack drv-share-people">
        {state.people.map((p) => {
          const locked = blocked || p.inherited || p.role === "owner";
          return (
            <li className="drv-share-person su-stack su-small-gap" key={p.webId}>
              <strong className="su-account-id">
                {p.webId}
                {p.webId === webId ? " (you)" : ""}
              </strong>
              {p.inherited && (
                <p className="su-muted">
                  Inherited from {p.sources.join(", ")}. Change access at the source.
                </p>
              )}
              <div className="su-wrap">
                <RoleSelect
                  label={`Role for ${p.webId} on ${where}`}
                  value={p.role}
                  disabled={locked}
                  onChange={(next) => person(p.webId, next)}
                />
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-label={`Remove access for ${p.webId} on ${where}`}
                  onClick={() => person(p.webId)}
                >
                  Remove access
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <label className="su-label" htmlFor={generalId}>
        General access for {where}
      </label>
      <select
        className="su-input"
        id={generalId}
        value={state.link}
        disabled={blocked || state.general.inherited}
        onChange={(event) => {
          const link = event.target.value as SharingState["link"];
          onChange({ ...state, link, public: link === "none" ? "none" : "viewer" });
        }}
      >
        <option value="none">Restricted</option>
        <option value="viewer">Anyone can view</option>
        <option value="editor">Anyone can edit</option>
      </select>
      {state.general.inherited && (
        <p className="su-muted">
          Inherited from {state.general.sources.join(", ")}. Change general access at the source.
        </p>
      )}
    </section>
  );
}

export function ScopedSharing({
  session,
  resource,
  disabledReason,
  onSaved,
  onMatched,
}: {
  session: SharingSession;
  resource: string;
  disabledReason?: string | undefined;
  onSaved: () => void;
  /** Both scopes now match: the ordinary sharing dialog can take over. */
  onMatched: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ScopedSharingSnapshot>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reloads access
  useEffect(() => {
    let live = true;
    setSnapshot(undefined);
    setError("");
    loadScopedSharing(session, resource).then(
      (value) => live && setSnapshot(value),
      (reason: unknown) =>
        live && setError(reason instanceof Error ? reason.message : "Couldn't load sharing"),
    );
    return () => {
      live = false;
    };
  }, [session, resource, retry]);

  const save = async (selection: ScopedSharingSelection) => {
    if (!snapshot || saving || disabledReason) return;
    setSaving(true);
    setError("");
    try {
      const fresh = await applyScopedSharing(session, snapshot, selection);
      setAnnouncement("Sharing saved");
      onSaved();
      if (scopesMatch(fresh)) onMatched();
      else setSnapshot(fresh);
    } catch (reason) {
      // A conflict, a partly applied save or an unconfirmed one: show nothing stale.
      setSnapshot(undefined);
      // Anything but a refused-as-stale save may have changed access.
      if (!(reason instanceof SharingConflictError)) onSaved();
      setError(reason instanceof Error ? reason.message : "Couldn't save sharing");
    } finally {
      setSaving(false);
    }
  };

  const blocked = saving || !!disabledReason || !snapshot?.canManage;
  return (
    <div className="su-stack" aria-busy={saving}>
      <p role="note" className="su-muted">
        This folder and the items inside it are shared differently. Change each one here, or make
        them match.
      </p>
      {error && (
        <div className="su-error" role="alert">
          <p>{error}</p>
          {!snapshot && (
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Reload sharing
            </Button>
          )}
        </div>
      )}
      {!snapshot && !error && (
        <p className="su-muted" role="status">
          Loading sharing…
        </p>
      )}
      {snapshot && (
        <>
          {!snapshot.canManage && (
            <p className="su-muted" role="status">
              You can view access. Only an owner with Control can change sharing.
            </p>
          )}
          <div className="su-wrap">
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => void save({ folder: snapshot.folder, contents: snapshot.folder })}
            >
              Make items inside match this folder
            </Button>
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => void save({ folder: snapshot.contents, contents: snapshot.contents })}
            >
              Make this folder match items inside
            </Button>
          </div>
          {(["folder", "contents"] as const).map((scope) => (
            <ScopeSection
              key={scope}
              scope={scope}
              state={snapshot[scope]}
              webId={session.webId}
              blocked={blocked}
              onChange={(next) =>
                void save(
                  scope === "folder"
                    ? { folder: next, contents: snapshot.contents }
                    : { folder: snapshot.folder, contents: next },
                )
              }
            />
          ))}
        </>
      )}
      <p role="status" className="su-muted">
        {saving ? "Saving sharing…" : announcement}
      </p>
    </div>
  );
}
