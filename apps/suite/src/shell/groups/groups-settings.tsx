// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  type DeletionReview,
  GROUP_PRIVACY,
  type GroupDirectory,
  type GroupFolder,
  type SharedGroup,
  type UnverifiedFolder,
} from "@jeswr/suite-groups";
import { Button, Input, Label, PeoplePicker, type SharingPerson } from "@jeswr/suite-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContactsModel } from "@/apps/contacts/lib/model/book";
import { discoverContacts } from "@/apps/contacts/lib/model/discovery";
import { useAccounts } from "../session/accounts-provider";
import { useNeedsConnection } from "../sync/requires-online";
import { groupDirectory } from "./client";
import { familySpaces } from "./family-spaces";
import { RESOLVED, UnverifiedNotice } from "./unverified-notice";

const profile = () => ({ loading: false });
export function GroupsSettings() {
  const { active, fetch, isActiveAccount } = useAccounts();
  const session = useMemo(
    () =>
      active && {
        fetch: (async (input, init) => {
          if (!isActiveAccount(active.id)) throw new Error("Group session changed");
          const response = await fetch(input, init);
          if (!isActiveAccount(active.id)) throw new Error("Group session changed");
          return response;
        }) as typeof fetch,
        webId: active.webId,
        storageUrl: active.storageUrl,
      },
    [active, fetch, isActiveAccount],
  );
  return session ? <GroupsPanel key={`${active?.id}:${session.webId}`} session={session} /> : null;
}
function GroupsPanel({
  session,
}: {
  session: { fetch: typeof fetch; webId: string; storageUrl: string };
}) {
  const connection = useNeedsConnection();
  const [directory, setDirectory] = useState<GroupDirectory>();
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<SharedGroup[]>([]);
  const [unverified, setUnverified] = useState<UnverifiedFolder[]>([]);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<SharingPerson[]>([]);
  const [contacts, setContacts] = useState<SharingPerson[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [resolved, setResolved] = useState("");
  // Bumped after the owner resolves an unverified folder, to move focus to the outcome.
  const [outcome, setOutcome] = useState(0);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [review, setReview] = useState<DeletionReview>();
  const [family, setFamily] = useState(false);
  const [spaces, setSpaces] = useState<string[]>([]);
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [contactError, setContactError] = useState("");
  useEffect(() => {
    let live = true;
    void groupDirectory(session)
      .then(async (directory) => {
        // The directory is kept even when listing is refused, so the owner can resolve a
        // folder changed outside the suite.
        if (live) setDirectory(directory);
        const pending = await directory.unverified();
        if (live) setUnverified(pending);
        const groups = await directory.list();
        if (live) {
          setGroups(groups);
          setReady(true);
        }
      })
      .catch((error) => {
        if (live) setMessage(error.message);
      });
    void (async () => {
      const model = new ContactsModel(session.fetch, session.storageUrl);
      const found = await discoverContacts(
        model,
        new URL("settings/privateTypeIndex.ttl", session.storageUrl).href,
      );
      const people: SharingPerson[] = found.flat
        .filter((item) => item.data.webId)
        .map((item) => ({ webId: item.data.webId as string, displayName: item.data.name }));
      for (const bookUrl of new Set([model.bookUrl, ...found.books])) {
        const book = await model.loadAddressBook(bookUrl);
        const index = await model.loadPeople(book);
        for (const person of index.data) {
          const contact = await model.loadContact(person.id);
          if (contact.data.webId)
            people.push({ webId: contact.data.webId, displayName: contact.data.name });
        }
      }
      if (live) setContacts([...new Map(people.map((person) => [person.webId, person])).values()]);
    })().catch(() => {
      if (live)
        setContactError("Contacts could not be loaded. You can still add members by WebID.");
    });
    return () => {
      live = false;
    };
  }, [session]);
  useEffect(() => {
    if (outcome) (alertRef.current ?? statusRef.current)?.focus();
  }, [outcome]);
  /** The owner's decision on an unverified folder; focus then moves to what happened. */
  async function resolve(folder: GroupFolder, decision: "keep" | "discard") {
    setResolved("");
    let done = false;
    await act(async (directory) => {
      await directory.verifyFolder(folder, decision);
      done = true;
    });
    if (done) setResolved(RESOLVED[folder][decision]);
    setOutcome((count) => count + 1);
  }
  /** A Family group's name when it is a listed (trusted) group, otherwise its address. */
  const familyName = (id: string) => groups.find((group) => group.id === id)?.name ?? id;
  async function act(action: (directory: GroupDirectory) => Promise<unknown>) {
    if (!directory || writing.current || connection.disabled) return;
    writing.current = true;
    setBusy(true);
    setMessage("");
    const refresh = async () => {
      setUnverified(await directory.unverified());
      setGroups(await directory.list());
      setReady(true);
    };
    try {
      await action(directory);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The group change could not be saved");
      try {
        await refresh();
      } catch {
        /* Keep the last confirmed list while storage is unavailable. */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header>
        <h2>Share with your groups</h2>
        <p>Share with your family, team or club from any app.</p>
      </header>
      <p>{GROUP_PRIVACY}</p>
      <p>
        Removing a member ends access through that group when the server next checks it. Other
        grants and downloaded copies remain.
      </p>
      {message && (
        <p ref={alertRef} role="alert" tabIndex={-1}>
          {message}
        </p>
      )}
      {resolved && (
        <p ref={statusRef} role="status" tabIndex={-1}>
          {resolved}
        </p>
      )}
      {busy && <p role="status">Saving groups…</p>}
      {connection.disabled && <p role="status">{connection.reason}</p>}
      {unverified.map((folder) => (
        <UnverifiedNotice
          key={folder.folder}
          folder={folder}
          busy={busy || connection.disabled}
          family={familyName}
          resolve={(decision) => void resolve(folder.folder, decision)}
        />
      ))}
      <section aria-label="Create group">
        <h2>{family ? "Set up Family" : "Create a group"}</h2>
        <fieldset disabled={!ready || busy || connection.disabled}>
          <Label htmlFor="group-name">Group name</Label>
          <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} />
          <PeoplePicker
            contacts={{ people: contacts, state: { kind: "ready" } }}
            value={members}
            onChange={setMembers}
            query={query}
            onQueryChange={setQuery}
            useProfile={profile}
          />
          {contactError && <p role="status">{contactError}</p>}
          <p>Family setup options</p>
          <p>Choose optional spaces for Create Family or Finish Family setup below.</p>
          {[
            ["calendar", "Family calendar"],
            ["photos", "Family photo album"],
            ["tasks", "Family task list"],
          ].map(([key, label]) => (
            <label key={key} className="settings-toggle">
              <input
                type="checkbox"
                checked={spaces.includes(key as string)}
                onChange={(event) =>
                  setSpaces((before) =>
                    event.target.checked
                      ? [...before, key as string]
                      : before.filter((value) => value !== key),
                  )
                }
              />
              {label}
            </label>
          ))}
          <label htmlFor="family-role">Members can</label>
          <select
            id="family-role"
            value={role}
            onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
          >
            <option value="viewer">Read shared spaces</option>
            <option value="editor">Read and write shared spaces</option>
          </select>
          <p>
            Each member receives one inbox invitation attempt after setup. Failed delivery does not
            undo access.
          </p>
          <div className="settings-choice-row">
            <Button
              disabled={!name.trim()}
              onClick={() =>
                void act(async (directory) => {
                  const group = await directory.create(
                    name,
                    members.map((member) => member.webId),
                  );
                  setName("");
                  setMembers([]);
                  setQuery("");
                  if (family) {
                    const results = await directory.setupFamily(
                      group.id,
                      familySpaces(session, spaces, role),
                    );
                    if (results.some((result) => !result.delivered))
                      setMessage("Family created. Some invitations could not be delivered.");
                  }
                  setFamily(false);
                })
              }
            >
              {family ? "Create Family" : "Create group"}
            </Button>
            {!groups.some((group) => group.family) && (
              <Button
                variant="outline"
                onClick={() => {
                  setFamily(true);
                  setName("Family");
                }}
              >
                Set up Family
              </Button>
            )}
          </div>
        </fieldset>
      </section>
      <section aria-label="Your groups">
        <h2>Your groups</h2>
        {!groups.length && <p>No shareable groups yet.</p>}
        {groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            contacts={contacts}
            busy={busy || connection.disabled}
            act={act}
            onDelete={() =>
              void act(async (directory) => {
                setReview(await directory.grants(group.id));
              })
            }
            setup={async (directory) => {
              const results = await directory.setupFamily(
                group.id,
                familySpaces(session, spaces, role),
              );
              if (results.some((result) => !result.delivered))
                setMessage("Family saved. Some invitations could not be delivered.");
            }}
          />
        ))}
      </section>
      {review && (
        <section aria-label="Delete group review">
          <h2>Delete group?</h2>
          <p>
            These group grants will be removed before the group is deleted. Shared files and spaces
            stay in your pod.
          </p>
          <ul>
            {review.resources.map((url) => (
              <li className="su-account-id" key={url}>
                {url}
              </li>
            ))}
          </ul>
          {!review.resources.length && <p>No group grants were found in your pod.</p>}
          <p>
            Grants on other people's pods cannot be discovered here. Deleting this group also
            prevents those servers from resolving its membership.
          </p>
          <div className="settings-choice-row">
            <Button
              disabled={busy || connection.disabled}
              variant="destructive"
              onClick={() =>
                void act(async (directory) => {
                  await directory.delete(review);
                  setReview(undefined);
                })
              }
            >
              Remove grants and delete group
            </Button>
            <Button
              disabled={busy || connection.disabled}
              variant="outline"
              onClick={() => setReview(undefined)}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
function GroupCard({
  group,
  contacts,
  busy,
  act,
  onDelete,
  setup,
}: {
  group: SharedGroup;
  contacts: SharingPerson[];
  busy: boolean;
  act(action: (directory: GroupDirectory) => Promise<unknown>): Promise<void>;
  onDelete(): void;
  setup(directory: GroupDirectory): Promise<unknown>;
}) {
  const [name, setName] = useState(group.name);
  const [members, setMembers] = useState<SharingPerson[]>([]);
  const [query, setQuery] = useState("");
  return (
    <section aria-label={group.name}>
      <h3>
        {group.name}
        {group.family ? " · Family group" : ""}
      </h3>
      <fieldset disabled={busy}>
        <Label htmlFor={`rename-${group.id}`}>Group name for {group.name}</Label>
        <Input
          id={`rename-${group.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!name.trim() || name === group.name}
          onClick={() => void act((directory) => directory.rename(group.id, name))}
        >
          Rename
        </Button>
        <details>
          <summary>{group.members.length} members</summary>
          <ul>
            {group.members.map((member) => (
              <li key={member} className="su-account-id">
                {contacts.find((person) => person.webId === member)?.displayName ?? member}{" "}
                <Button
                  variant="ghost"
                  aria-label={`Remove ${member} from ${group.name}`}
                  onClick={() => void act((directory) => directory.removeMember(group.id, member))}
                >
                  Remove member
                </Button>
              </li>
            ))}
          </ul>
        </details>
        <PeoplePicker
          contacts={{
            people: contacts.filter((person) => !group.members.includes(person.webId)),
            state: { kind: "ready" },
          }}
          value={members}
          onChange={setMembers}
          query={query}
          onQueryChange={setQuery}
          useProfile={profile}
        />
        <Button
          disabled={!members.length}
          onClick={() =>
            void act(async (directory) => {
              for (const member of members) await directory.addMember(group.id, member.webId);
              setMembers([]);
              setQuery("");
            })
          }
        >
          Add members to {group.name}
        </Button>
        <div className="settings-choice-row">
          <Button variant="outline" onClick={() => void act(setup)}>
            {group.family ? "Finish Family setup / invite new members" : "Make Family group"}
          </Button>
          <Button variant="destructive" onClick={onDelete}>
            Delete {group.name}
          </Button>
        </div>
      </fieldset>
    </section>
  );
}
