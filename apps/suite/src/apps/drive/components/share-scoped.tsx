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
  ScopedSharingIncompleteError,
  type ScopedSharingSelection,
  type ScopedSharingSnapshot,
  SharingConflictError,
  SharingRefreshError,
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
  describedBy,
  onChange,
}: {
  label: string;
  value: SharingRole;
  disabled: boolean;
  describedBy: string | undefined;
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
        aria-describedby={describedBy}
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
  const linkRoleId = useId();
  const headingId = useId();
  const noteId = useId();
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
    <section className="su-stack" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {!state.people.length && <p className="su-muted">No people have access.</p>}
      <ul className="su-stack drv-share-people">
        {state.people.map((p, index) => {
          const locked = blocked || p.inherited || p.role === "owner";
          // Say why a row can't be changed; a save in progress explains itself.
          const why = p.inherited || p.role === "owner" ? `${noteId}-${index}` : undefined;
          return (
            <li className="drv-share-person su-stack su-small-gap" key={p.webId}>
              <strong className="su-account-id">
                {p.webId}
                {p.webId === webId ? " (you)" : ""}
              </strong>
              {why && (
                <p className="su-muted" id={why}>
                  {p.inherited
                    ? `Inherited from ${p.sources.join(", ")}. Change access at the source.`
                    : "Owner access can't be changed here."}
                </p>
              )}
              <div className="su-wrap">
                <RoleSelect
                  label={`Role for ${p.webId} on ${where}`}
                  value={p.role}
                  disabled={locked}
                  describedBy={why}
                  onChange={(next) => person(p.webId, next)}
                />
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-describedby={why}
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
      {/* Like the ordinary dialog: going public starts as viewer; editor is a second choice. */}
      <select
        className="su-input"
        id={generalId}
        value={state.link === "none" ? "restricted" : "anyone"}
        disabled={blocked || state.general.inherited}
        onChange={(event) => {
          const open = event.target.value === "anyone";
          onChange({ ...state, link: open ? "viewer" : "none", public: open ? "viewer" : "none" });
        }}
      >
        <option value="restricted">Restricted</option>
        <option value="anyone">Anyone with the link</option>
      </select>
      {state.link !== "none" && (
        <>
          <label className="su-label" htmlFor={linkRoleId}>
            Link role for {where}
          </label>
          <select
            className="su-input"
            id={linkRoleId}
            value={state.link}
            disabled={blocked || state.general.inherited}
            onChange={(event) =>
              onChange({
                ...state,
                link: event.target.value as "viewer" | "editor",
                public: "viewer",
              })
            }
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
          <p className="su-muted">
            Anyone can access {where} without signing in. The link is public, not a secret.
          </p>
        </>
      )}
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
  onSavingChange,
}: {
  session: SharingSession;
  resource: string;
  disabledReason?: string | undefined;
  onSaved: () => void;
  /** Both scopes now match: the ordinary sharing dialog can take over and announce `message`. */
  onMatched: (message: string) => void;
  /** Lets the dialog keep every dismissal route closed while a save is in flight. */
  onSavingChange: (saving: boolean) => void;
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
    setAnnouncement("");
    loadScopedSharing(session, resource).then(
      (value) => live && setSnapshot(value),
      (reason: unknown) =>
        live && setError(reason instanceof Error ? reason.message : "Couldn't load sharing"),
    );
    return () => {
      live = false;
    };
  }, [session, resource, retry]);

  const show = (fresh: ScopedSharingSnapshot, message: string) => {
    if (scopesMatch(fresh)) onMatched(message);
    else setSnapshot(fresh);
    setAnnouncement(message);
  };
  const save = async (selection: ScopedSharingSelection) => {
    if (!snapshot || saving || disabledReason) return;
    setSaving(true);
    onSavingChange(true);
    setError("");
    setAnnouncement("");
    try {
      const { snapshot: fresh, changed } = await applyScopedSharing(session, snapshot, selection);
      if (changed) onSaved();
      show(fresh, changed ? "Sharing saved" : "Sharing already up to date");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save sharing");
      if (reason instanceof ScopedSharingIncompleteError) {
        // Part of the selection may be stored: show the reloaded access, never "saved".
        onSaved();
        show(reason.snapshot, "Sharing not saved as chosen");
      } else if (reason instanceof SharingRefreshError) {
        setSnapshot(undefined);
        onSaved();
        setAnnouncement(reason.committed ? "Sharing not confirmed" : "Sharing outcome unknown");
      } else if (reason instanceof SharingConflictError) {
        setSnapshot(undefined);
        setAnnouncement("Sharing not saved");
      } else {
        // Refused before any request: nothing changed, so keep the current controls.
        setAnnouncement("Sharing not saved");
      }
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  // The SDK keeps the caller's Control on both scopes, and owner rows are read-only here, so
  // without ownership of the items inside no save can succeed.
  const blocked = saving || !!disabledReason || !snapshot?.canManage || !snapshot.ownsContents;
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
          {snapshot.canManage && !snapshot.ownsContents && (
            <p className="su-muted" role="status">
              You don't own the items inside this folder, so its sharing can't be changed here. Ask
              an owner of those items.
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
