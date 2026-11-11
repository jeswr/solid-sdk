// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PeoplePicker,
  type SharingPerson as PickerPerson,
} from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { DriveItem } from "../lib/client/client";
import {
  applySharing,
  CONTENTS_DIFFER,
  loadSharing,
  SharingConflictError,
  SharingIncompleteError,
  SharingRefreshError,
  type SharingSession,
  type SharingSnapshot,
} from "../lib/sharing/adapter";
import type { SharingRole, SharingSelection, SharingState } from "../lib/sharing/types";

const profile = () => ({ loading: false });
const COMMENT_REASON = "Commenter is not available for this item yet. Choose Viewer or Editor.";

function Roles({
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
        <option value="commenter" disabled title={COMMENT_REASON}>
          Commenter
        </option>
        <option value="editor">Editor</option>
        {value === "owner" && <option value="owner">Owner</option>}
      </select>
    </div>
  );
}

export function ShareDialog({
  item,
  session,
  link,
  onClose,
  onSaved,
  onCloseAutoFocus,
  notice,
  disabledReason,
}: {
  item: Pick<DriveItem, "name" | "url">;
  session: SharingSession;
  link: string;
  onClose: () => void;
  onSaved: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  notice?: string;
  disabledReason?: string | undefined;
}) {
  const [snapshot, setSnapshot] = useState<SharingSnapshot>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<PickerPerson[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<SharingRole>("viewer");
  const [announcement, setAnnouncement] = useState("");
  const [retry, setRetry] = useState(0);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const generalId = useId();
  const generalRoleId = useId();
  const lockId = useId();
  const commentId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately reloads access documents
  useEffect(() => {
    let live = true;
    setLoading(true);
    setSnapshot(undefined);
    setError("");
    loadSharing(session, item.url).then(
      (value) => {
        if (live) {
          setSnapshot(value);
          setLoading(false);
          setAnnouncement("");
        }
      },
      (reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : "Couldn't load sharing");
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [session, item.url, retry]);

  useEffect(() => {
    if (saving) return;
    const previous = focusAfterSave.current;
    focusAfterSave.current = null;
    if (
      !previous ||
      (document.activeElement !== document.body &&
        document.activeElement?.getAttribute("role") !== "dialog")
    )
      return;
    // Disabling the saving control can strand focus on the modal container.
    // A successful add clears its selection and leaves Share disabled; a removal
    // deletes its trigger. Done remains available in both cases.
    // Done is always rendered while the dialog is open.
    const target =
      previous.isConnected && !previous.matches(":disabled")
        ? previous
        : (done.current as HTMLButtonElement);
    target.focus();
  }, [saving]);

  const save = async (selection: SharingSelection) => {
    if (!snapshot || saving || disabledReason) return;
    focusAfterSave.current = document.activeElement as HTMLElement | null;
    setSaving(true);
    setError("");
    try {
      setSnapshot(await applySharing(session, snapshot, selection));
      setPeople([]);
      setQuery("");
      setAnnouncement("Sharing saved");
      onSaved();
    } catch (reason) {
      if (reason instanceof SharingConflictError) setSnapshot(reason.snapshot);
      // Part of the selection may be stored: show the reloaded access, never "saved".
      if (reason instanceof SharingIncompleteError) {
        setSnapshot(reason.snapshot);
        setPeople([]);
        setQuery("");
        setAnnouncement("Sharing not saved as chosen");
        onSaved();
      }
      if (reason instanceof SharingRefreshError) {
        setSnapshot(undefined);
        setPeople([]);
        setQuery("");
        setAnnouncement(reason.committed ? "Sharing not confirmed" : "Sharing outcome unknown");
        onSaved();
      }
      setError(reason instanceof Error ? reason.message : "Couldn't save sharing");
    } finally {
      setSaving(false);
    }
  };
  const state = snapshot?.state;
  const blocked = loading || saving || !!disabledReason || !snapshot?.canManage;
  // Every dismissal route (Done, close button, Escape and outside interaction) shares this guard.
  const close = () => {
    if (!saving) onClose();
  };
  const updatePerson = (peopleState: SharingState, webId: string, next?: SharingRole) => {
    void save({
      ...peopleState,
      people: peopleState.people.flatMap((p) =>
        p.webId === webId ? (next ? [{ webId, role: next }] : []) : [p],
      ),
    });
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        className="drv-share-dialog"
        aria-modal="true"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <DialogHeader>
          <DialogTitle>Share “{item.name}”</DialogTitle>
          <DialogDescription>Choose who can access this item.</DialogDescription>
        </DialogHeader>
        {notice && (
          <p role="note" className="su-muted">
            {notice}
          </p>
        )}
        {disabledReason && (
          <p role="status" className="su-muted">
            {disabledReason}
          </p>
        )}
        {loading && (
          <p className="su-muted" role="status">
            Loading sharing…
          </p>
        )}
        {error && (
          <div className="su-error" role="alert">
            <p>{error}</p>
            {!snapshot && (
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </Button>
            )}
          </div>
        )}
        {!loading && state && (
          <div className="su-stack" aria-busy={saving}>
            {!snapshot.canManage && (
              <p className="su-muted" role="status">
                {snapshot.readOnly ??
                  "You can view access. Only an owner with Control can change sharing."}
              </p>
            )}
            {(snapshot.contentsDiffer || snapshot.resource.endsWith("/")) && (
              <p className="su-muted" role="note">
                {CONTENTS_DIFFER}
              </p>
            )}
            <p className="su-muted" id={lockId}>
              Owner access is locked so you cannot remove your own Control or owner access.
            </p>
            <fieldset disabled={blocked} className="drv-share-add" aria-describedby={commentId}>
              <legend className="sr-only">Add people</legend>
              <PeoplePicker
                contacts={{ people: [], state: { kind: "ready" } }}
                value={people}
                onChange={setPeople}
                query={query}
                onQueryChange={setQuery}
                useProfile={profile}
              />
              <div className="su-wrap">
                <Roles
                  label="Role for added people"
                  value={role}
                  disabled={blocked}
                  onChange={setRole}
                />
                <Button
                  disabled={blocked || !people.length}
                  onClick={() =>
                    void save({
                      ...state,
                      people: [
                        ...state.people,
                        ...people
                          .filter(
                            (p) => !state.people.some((existing) => existing.webId === p.webId),
                          )
                          .map((p) => ({ webId: p.webId, role })),
                      ],
                    })
                  }
                >
                  Share
                </Button>
              </div>
              <p className="su-muted" id={commentId}>
                {COMMENT_REASON}
              </p>
            </fieldset>
            <section className="su-stack" aria-label="People with access">
              <h3>People with access</h3>
              {!state.people.length && <p className="su-muted">No people have access.</p>}
              <ul className="su-stack drv-share-people">
                {state.people.map((person) => (
                  <li className="drv-share-person su-stack su-small-gap" key={person.webId}>
                    <strong className="su-account-id">
                      {person.webId}
                      {person.webId === session.webId ? " (you)" : ""}
                    </strong>
                    {person.inherited && (
                      <p className="su-muted">
                        Inherited from {person.sources.join(", ")}. Change access at the source;
                        stopping inheritance is not supported here.
                      </p>
                    )}
                    <div
                      className="su-wrap"
                      aria-describedby={person.role === "owner" ? lockId : undefined}
                    >
                      <Roles
                        label={`Role for ${person.webId}`}
                        value={person.role}
                        disabled={blocked || person.inherited || person.role === "owner"}
                        onChange={(next) => updatePerson(state, person.webId, next)}
                      />
                      <Button
                        variant="ghost"
                        disabled={blocked || person.inherited || person.role === "owner"}
                        aria-label={`Remove access for ${person.webId}`}
                        onClick={() => updatePerson(state, person.webId)}
                      >
                        Remove access
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="su-stack" aria-label="General access">
              <h3>General access</h3>
              <label className="su-label" htmlFor={generalId}>
                Who can access
              </label>
              <select
                className="su-input"
                id={generalId}
                value={state.link === "none" ? "restricted" : "anyone"}
                disabled={blocked || state.general.inherited}
                onChange={(event) =>
                  void save({
                    ...state,
                    link: event.target.value === "restricted" ? "none" : "viewer",
                    public: event.target.value === "restricted" ? "none" : "viewer",
                  })
                }
              >
                <option value="restricted">Restricted</option>
                <option value="anyone">Anyone with the link</option>
              </select>
              {state.link !== "none" && (
                <>
                  <label className="su-label" htmlFor={generalRoleId}>
                    Link role
                  </label>
                  <select
                    className="su-input"
                    id={generalRoleId}
                    value={state.link}
                    disabled={blocked || state.general.inherited}
                    onChange={(event) =>
                      void save({
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
                    Anyone can access this item without signing in. The link is public, not a
                    secret.
                  </p>
                </>
              )}
              {state.general.inherited && (
                <p className="su-muted">
                  Inherited from {state.general.sources.join(", ")}. Change general access at the
                  source.
                </p>
              )}
            </section>
            <p className="su-muted">
              Access end dates aren't available in this sharing dialog. Access continues until you
              remove it.
            </p>
          </div>
        )}
        <p role="status" className="su-muted">
          {saving ? "Saving sharing…" : announcement}
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(new URL(link, window.location.href).href).then(
                () => setAnnouncement("Link copied"),
                () => setError("Couldn't copy the link. Try again."),
              );
            }}
          >
            Copy link
          </Button>
          <Button ref={done} disabled={saving} onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
