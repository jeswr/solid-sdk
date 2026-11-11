// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type RoleGrant, readGrants, removeGrant } from "@jeswr/pod-access/roles";
import type { SharedGroup } from "@jeswr/suite-groups";
import { Button, PeoplePicker, type SharingPerson, toast } from "@jeswr/suite-ui";
import { useEffect, useId, useState } from "react";
import { useNeedsConnection } from "../sync/requires-online";
import { type GroupsSession, groupDirectory } from "./client";

const profile = () => ({ loading: false });
/** Shared by every suite sharing dialog; group identity stays symbolic in the ACL. */
export function GroupSharing({
  session,
  url,
  disabled,
  onSaved,
  targets = [url],
}: {
  session: GroupsSession;
  url: string;
  disabled?: boolean;
  onSaved?(): void;
  targets?: string[] | undefined;
}) {
  const connection = useNeedsConnection();
  const [groups, setGroups] = useState<SharedGroup[]>([]);
  const [grants, setGrants] = useState<RoleGrant[]>([]);
  const [selected, setSelected] = useState<SharingPerson[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision reloads grants after a mutation.
  useEffect(() => {
    let live = true;
    setReady(false);
    void (async () => {
      const directory = await groupDirectory(session);
      const groups = await directory.list();
      const snapshot = await readGrants(url, {
        fetch: session.fetch,
        root: session.storageUrl,
        model: "wac",
        kind: url.endsWith("/") ? "folder" : "resource",
      });
      if (live) {
        setGroups(groups);
        setGrants(snapshot.grants.filter((grant) => grant.agent.type === "group"));
        setReady(true);
      }
    })().catch((error) => {
      if (live) setMessage(error instanceof Error ? error.message : "Groups couldn't be loaded");
    });
    return () => {
      live = false;
    };
  }, [session, url, revision]);
  async function save(remove?: string) {
    if (saving || !ready || disabled || connection.disabled) return;
    setSaving(true);
    setMessage("");
    try {
      const directory = await groupDirectory(session);
      if (remove) {
        for (const target of targets) {
          const result = await removeGrant(
            [target],
            { type: "group", id: remove },
            {
              fetch: session.fetch,
              root: session.storageUrl,
              webId: session.webId,
              model: "wac",
              kind: target.endsWith("/") ? "folder" : "resource",
            },
          );
          if (result.failed.length) throw result.failed[0]?.error;
        }
      } else
        for (const group of selected) {
          const results = await directory.share(group.webId, targets, role);
          if (results.some((result) => !result.delivered)) {
            const message = "Access saved. Some members could not receive a notification.";
            setMessage(message);
            toast.warning(message);
          }
        }
      setSelected([]);
      setQuery("");
      onSaved?.();
    } catch (error) {
      setMessage(
        `Group access couldn't be fully saved. Review Permissions before retrying. ${error instanceof Error ? error.message : "Try again."}`,
      );
    } finally {
      setSaving(false);
      setRevision((value) => value + 1);
    }
  }
  return (
    <section className="su-stack" aria-label="Group sharing">
      <h3>Groups</h3>
      {connection.disabled && <p role="status">{connection.reason}</p>}
      {message && <p role="status">{message}</p>}
      <fieldset disabled={!ready || saving || disabled || connection.disabled} className="su-stack">
        <legend className="sr-only">Share with a group</legend>
        <PeoplePicker
          label="Add groups"
          addLabel="Add group"
          contacts={{
            people: groups
              .filter(
                (group) =>
                  !grants.some(
                    (grant) => grant.agent.type === "group" && grant.agent.id === group.id,
                  ),
              )
              .map((group) => ({
                webId: group.id,
                displayName: `${group.name} · ${group.members.length} members`,
              })),
            state: { kind: "ready" },
          }}
          value={selected}
          onChange={setSelected}
          query={query}
          onQueryChange={setQuery}
          useProfile={profile}
        />
        <label htmlFor={id}>Group role</label>
        <select
          id={id}
          className="su-input"
          value={role}
          onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <Button
          disabled={
            !selected.length ||
            !selected.every((person) => groups.some((group) => group.id === person.webId))
          }
          onClick={() => void save()}
        >
          Share with group
        </Button>
      </fieldset>
      {grants.map((grant) => {
        if (grant.agent.type !== "group") return null;
        const groupId = grant.agent.id;
        const group = groups.find((group) => group.id === groupId);
        return (
          <div key={groupId} className="su-stack">
            <strong>
              {group?.name ?? groupId} · {grant.role}
            </strong>
            <details>
              <summary>{group?.members.length ?? "Unknown"} members</summary>
              <ul>
                {group?.members.map((member) => (
                  <li className="su-account-id" key={member}>
                    {member}
                  </li>
                ))}
              </ul>
            </details>
            <Button
              variant="ghost"
              disabled={disabled || saving || grant.inherited || connection.disabled}
              onClick={() => void save(groupId)}
            >
              Remove group access
            </Button>
          </div>
        );
      })}
      <a href="/settings/groups">Manage groups &amp; family</a>
    </section>
  );
}
