// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * The scope-aware sharing editor (sst-uo4.4): for a folder whose own access differs from the
 * access of the items inside it, show and change each scope, or make them match.
 */
import { Button } from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import {
  applyScopedSharing,
  CONTENTS_DIFFER,
  type GroupAccess,
  type GroupChoice,
  loadScopedSharing,
  ScopedSharingIncompleteError,
  type ScopedSharingSelection,
  type ScopedSharingSnapshot,
  SharingConflictError,
  SharingRefreshError,
  type SharingSession,
} from "../lib/sharing/adapter";
import type { SharingPerson, SharingRole, SharingState } from "../lib/sharing/types";

type Scope = "folder" | "contents";
const TITLES: Record<Scope, string> = { folder: "This folder", contents: "Items inside" };
const WHERE: Record<Scope, string> = { folder: "this folder", contents: "items inside" };
const OTHER: Record<Scope, Scope> = { folder: "contents", contents: "folder" };
const ROLE_LABELS: Record<SharingRole, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
  owner: "Owner",
};
const GENERAL_LABELS: Record<SharingState["link"], string> = {
  none: "Restricted",
  viewer: "Anyone with the link (Viewer)",
  editor: "Anyone with the link (Editor)",
};
const PUBLIC_WARNINGS: Record<Scope, string> = {
  folder:
    "Anyone can access this folder without signing in, and can see the names of the items inside. The link is public, not a secret.",
  contents:
    "Anyone can access everything inside this folder, including subfolders, without signing in. The link is public, not a secret.",
};

const groupRoles = (groups: readonly GroupAccess[]) =>
  groups.map((group) => [group.id, group.role]).sort();
/** Whether both scopes give everyone the same access, so the ordinary dialog applies again. */
export function scopesMatch(snapshot: ScopedSharingSnapshot): boolean {
  const roles = (state: SharingState, groups: readonly GroupAccess[]) =>
    JSON.stringify([
      state.link,
      state.people.map((person) => [person.webId, person.role]).sort(),
      groupRoles(groups),
    ]);
  return (
    roles(snapshot.folder, snapshot.groups.folder) ===
    roles(snapshot.contents, snapshot.groups.contents)
  );
}

/** What making one scope match the other would write, and what it must leave as it is. */
export interface MatchPlan {
  readonly selection: ScopedSharingSelection;
  /** One line per person, group or general access the match changes. */
  readonly changes: readonly string[];
  /** Access the match leaves as it is, and why. */
  readonly kept: readonly string[];
}
/**
 * Make the `to` scope match `from`, within what the per-scope controls allow: nobody else is
 * given Owner (Control), and other owners' and inherited rows on `to` stay as they are. Only
 * the signed-in owner's own row may change either way, as in the ordinary dialog.
 */
export function matchPlan(snapshot: ScopedSharingSnapshot, from: Scope, webId: string): MatchPlan {
  const to = OTHER[from];
  const source = snapshot[from];
  const target = snapshot[to];
  const changes: string[] = [];
  const kept: string[] = [];
  const label = (role: SharingRole | undefined) => (role ? ROLE_LABELS[role] : "No access");
  const resolve = (
    name: string,
    before: { role: SharingRole; inherited: boolean } | undefined,
    wanted: SharingRole | undefined,
    self: boolean,
  ): SharingRole | undefined => {
    if (before?.role === wanted) return wanted;
    if (!self && before?.role === "owner") {
      kept.push(`${name} keeps Owner access on ${WHERE[to]}. Owner access can't be changed here.`);
      return before.role;
    }
    if (!self && before?.inherited) {
      kept.push(
        `${name} keeps inherited access on ${WHERE[to]}. Change inherited access at its source.`,
      );
      return before.role;
    }
    if (!self && wanted === "owner") {
      kept.push(
        `${name}'s Owner access on ${WHERE[from]} isn't copied. Owner access can't be given here.`,
      );
      if (before) return before.role;
      return undefined;
    }
    changes.push(`${name} on ${WHERE[to]}: ${label(before?.role)} → ${label(wanted)}`);
    return wanted;
  };

  const fromPeople = new Map(source.people.map((p) => [p.webId, p]));
  const toPeople = new Map(target.people.map((p) => [p.webId, p]));
  const people: SharingPerson[] = [];
  for (const id of [...new Set([...fromPeople.keys(), ...toPeople.keys()])].sort()) {
    const was = fromPeople.get(id);
    const before = toPeople.get(id);
    const role = resolve(`${id}${id === webId ? " (you)" : ""}`, before, was?.role, id === webId);
    if (!role) continue;
    if (was?.role === role) people.push(was);
    else if (before?.role === role) people.push(before);
  }

  let general = source;
  if (source.link !== target.link) {
    if (target.general.inherited) {
      kept.push(
        `General access on ${WHERE[to]} is inherited and stays ${GENERAL_LABELS[target.link]}. Change it at its source.`,
      );
      general = target;
    } else
      changes.push(
        `General access on ${WHERE[to]}: ${GENERAL_LABELS[target.link]} → ${GENERAL_LABELS[source.link]}`,
      );
  }

  const fromGroups = new Map(snapshot.groups[from].map((g) => [g.id, g]));
  const toGroups = new Map(snapshot.groups[to].map((g) => [g.id, g]));
  const groups: GroupChoice[] = [];
  for (const id of [...new Set([...fromGroups.keys(), ...toGroups.keys()])].sort()) {
    const role = resolve(`Group ${id}`, toGroups.get(id), fromGroups.get(id)?.role, false);
    if (role) groups.push({ id, role });
  }

  const matched: SharingState = {
    ...target,
    people,
    link: general.link,
    public: general.public,
    general: general.general,
  };
  const unchanged = snapshot.groups[from].map(({ id, role }) => ({ id, role }));
  const selection: ScopedSharingSelection =
    from === "folder"
      ? { folder: source, contents: matched, groups: { folder: unchanged, contents: groups } }
      : { folder: matched, contents: source, groups: { folder: groups, contents: unchanged } };
  return { selection, changes, kept };
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
  groups,
  webId,
  blocked,
  headingRef,
  onChange,
}: {
  scope: Scope;
  state: SharingState;
  groups: readonly GroupAccess[];
  webId: string;
  blocked: boolean;
  headingRef: (element: HTMLHeadingElement | null) => void;
  onChange: (next: SharingState) => void;
}) {
  const generalId = useId();
  const linkRoleId = useId();
  const headingId = useId();
  const noteId = useId();
  const groupsId = useId();
  const title = TITLES[scope];
  const where = WHERE[scope];
  const person = (id: string, next?: SharingRole) =>
    onChange({
      ...state,
      people: state.people.flatMap((p) =>
        p.webId === id ? (next ? [{ ...p, role: next }] : []) : [p],
      ),
    });
  return (
    <section className="su-stack" aria-labelledby={headingId}>
      {/* A focus target when the control that saved is gone. */}
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        {title}
      </h3>
      {scope === "contents" && (
        <p className="su-muted">
          Applies to everything inside this folder, including subfolders. {CONTENTS_DIFFER}
        </p>
      )}
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
      {groups.length > 0 && (
        <>
          <p className="su-label" id={groupsId}>
            Groups with access to {where}
          </p>
          <ul className="su-stack drv-share-people" aria-labelledby={groupsId}>
            {groups.map((group) => (
              <li className="drv-share-person su-stack su-small-gap" key={group.id}>
                <strong className="su-account-id">{group.id}</strong>
                <span>
                  {ROLE_LABELS[group.role]}
                  {group.inherited ? ` · Inherited from ${group.sources.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="su-muted">
            Group access can't be changed here. Make the scopes match to align it, then change it in
            the ordinary sharing dialog.
          </p>
        </>
      )}
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
          <p className="su-muted">{PUBLIC_WARNINGS[scope]}</p>
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

const MATCH_LABELS: Record<Scope, string> = {
  folder: "Make items inside match this folder",
  contents: "Make this folder match items inside",
};

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
  // The scope a "Make … match" preview is copying from; the plan is derived from `snapshot`.
  const [preview, setPreview] = useState<Scope>();
  // Bumped by every load, so a save that outlives its folder or account is dropped.
  const generation = useRef(0);
  // Where focus goes once a save settles: the control that saved, else a stable target.
  const restore = useRef<{ element: HTMLElement | null; scope?: Scope } | undefined>(undefined);
  const headings = useRef<Partial<Record<Scope, HTMLHeadingElement | null>>>({});
  const reload = useRef<HTMLButtonElement>(null);
  const intro = useRef<HTMLParagraphElement>(null);
  const triggers = useRef<Partial<Record<Scope, HTMLButtonElement | null>>>({});
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reloads access
  useEffect(() => {
    let live = true;
    generation.current += 1;
    setSnapshot(undefined);
    setError("");
    setAnnouncement("");
    setPreview(undefined);
    loadScopedSharing(session, resource).then(
      (value) => live && setSnapshot(value),
      (reason: unknown) =>
        live && setError(reason instanceof Error ? reason.message : "Couldn't load sharing"),
    );
    return () => {
      live = false;
    };
  }, [session, resource, retry]);

  useEffect(() => {
    if (saving) return;
    const target = restore.current;
    restore.current = undefined;
    if (!target) return;
    // Focus the user moved elsewhere during the save stays where they put it.
    const active = document.activeElement;
    if (active && active !== document.body && active.getAttribute("role") !== "dialog") return;
    const { element, scope } = target;
    const usable = (node: HTMLElement | null | undefined): node is HTMLElement =>
      !!node?.isConnected && !node.matches(":disabled");
    // The control that saved, else the reload a discarded snapshot needs, else its section.
    const next = [element, reload.current, scope && headings.current[scope], intro.current].find(
      usable,
    );
    next?.focus();
  }, [saving]);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  const show = (fresh: ScopedSharingSnapshot, message: string) => {
    if (scopesMatch(fresh)) {
      // This editor is about to unmount; the ordinary dialog places focus once it loads.
      restore.current = undefined;
      onMatched(message);
    } else setSnapshot(fresh);
    setAnnouncement(message);
  };
  const save = async (
    selection: ScopedSharingSelection,
    focus: { element: HTMLElement | null; scope?: Scope },
  ) => {
    if (!snapshot || saving || disabledReason) return;
    const started = generation.current;
    restore.current = focus;
    setSaving(true);
    onSavingChange(true);
    setError("");
    setAnnouncement("");
    try {
      const { snapshot: fresh, changed } = await applyScopedSharing(session, snapshot, selection);
      if (started !== generation.current) return;
      if (changed) onSaved();
      show(fresh, changed ? "Sharing saved" : "Sharing already up to date");
    } catch (reason) {
      if (started !== generation.current) return;
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
      // A dropped save leaves focus to the load that replaced it.
      if (started !== generation.current) restore.current = undefined;
      setSaving(false);
      onSavingChange(false);
    }
  };

  // The SDK keeps the caller's Control on both scopes, and owner rows are read-only here, so
  // without ownership of the items inside only aligning them to the folder can succeed: that
  // copies the caller's own Owner row from the folder to the items inside.
  const locked = saving || !!disabledReason || !snapshot?.canManage;
  const blocked = locked || !snapshot?.ownsContents;
  const matchBlocked: Record<Scope, boolean> = { folder: locked, contents: blocked };
  const plan = snapshot && preview ? matchPlan(snapshot, preview, session.webId) : undefined;
  const groupsDiffer =
    !!snapshot &&
    JSON.stringify(groupRoles(snapshot.groups.folder)) !==
      JSON.stringify(groupRoles(snapshot.groups.contents));
  return (
    <div className="su-stack" aria-busy={saving}>
      <p role="note" className="su-muted" ref={intro} tabIndex={-1}>
        This folder and the items inside it are shared differently. Change each one here, or make
        them match.
      </p>
      {error && (
        <div className="su-error" role="alert">
          <p>{error}</p>
          {!snapshot && (
            <Button ref={reload} variant="outline" onClick={() => setRetry((n) => n + 1)}>
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
              You don't own the items inside this folder. You can make them match this folder, which
              also gives you Owner access to them, or ask an owner of those items.
            </p>
          )}
          {groupsDiffer && <p className="su-muted">Group access differs between the scopes.</p>}
          <div className="su-wrap">
            {(["folder", "contents"] as const).map((from) => (
              <Button
                key={from}
                ref={(element: HTMLButtonElement | null) => {
                  triggers.current[from] = element;
                }}
                variant="outline"
                disabled={matchBlocked[from]}
                aria-expanded={preview === from}
                aria-controls={preview === from ? previewId : undefined}
                onClick={() => !matchBlocked[from] && setPreview(from)}
              >
                {MATCH_LABELS[from]}
              </Button>
            ))}
          </div>
          {plan && preview && (
            <section className="su-stack" id={previewId} aria-labelledby={`${previewId}-title`}>
              <h3 id={`${previewId}-title`} ref={previewHeading} tabIndex={-1}>
                {MATCH_LABELS[preview]}?
              </h3>
              {plan.changes.length ? (
                <ul className="su-stack">
                  {plan.changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="su-muted">Nothing can be changed this way.</p>
              )}
              {plan.kept.length > 0 && (
                <ul className="su-stack su-muted">
                  {plan.kept.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="su-wrap">
                {plan.changes.length > 0 && (
                  <Button
                    disabled={matchBlocked[preview]}
                    onClick={() => {
                      const from = preview;
                      setPreview(undefined);
                      void save(plan.selection, { element: triggers.current[from] ?? null });
                    }}
                  >
                    Apply changes
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    const from = preview;
                    setPreview(undefined);
                    triggers.current[from]?.focus();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </section>
          )}
          {(["folder", "contents"] as const).map((scope) => (
            <ScopeSection
              key={scope}
              scope={scope}
              state={snapshot[scope]}
              groups={snapshot.groups[scope]}
              webId={session.webId}
              blocked={blocked}
              headingRef={(element) => {
                headings.current[scope] = element;
              }}
              onChange={(next) =>
                void save(
                  scope === "folder"
                    ? { folder: next, contents: snapshot.contents }
                    : { folder: snapshot.folder, contents: next },
                  {
                    element:
                      document.activeElement instanceof HTMLElement ? document.activeElement : null,
                    scope,
                  },
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
