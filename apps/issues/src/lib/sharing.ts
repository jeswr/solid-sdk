// AUTHORED-BY Claude Opus 5.5
import {
  type AgentRef,
  addGrant,
  type GrantMutationOptions,
  isRoleError,
  type RoleError,
  readGrants,
  removeGrant,
  type SetGrantsResult,
  setGrants,
} from "@jeswr/pod-access/roles";
import { podRoleFor, type Role, roleForPodRole } from "./roles";

/**
 * Sharing for Issues, delegated entirely to `@jeswr/pod-access/roles`
 * (bead sst-35ov). pod-access discovers the advertised ACL/ACR, works on both
 * WAC and ACP, refuses edits that would lock the owner out, and persists every
 * change with an If-Match / If-None-Match: * precondition. This module only maps
 * the app's roles and principals onto it and turns its refusals into
 * {@link SharingError}s the UI can show.
 */

/** A person/group's assigned role on a resource (the named view of their grant). */
export interface RoleAssignment {
  /** WebID (agent) or group IRI. */
  subject: string;
  kind: "agent" | "group";
  role: Role;
}

/** Why pod-access refused to read or change a resource's sharing. */
export type SharingErrorCode = RoleError["code"];

const MESSAGES: Record<SharingErrorCode, string> = {
  conflict: "Sharing for this item changed since it was loaded. Reload and try again.",
  "owner-lockout": "That change would remove your own control of this item, so it was not made.",
  unsupported:
    "This item's access rules use a feature this app cannot edit safely, so nothing was changed.",
  "partial-scope":
    "This folder's access rules differ between the folder and its contents, so they cannot be edited here.",
  "inherited-grant":
    "This access is inherited from a parent folder. Change it on that folder instead.",
  "precondition-required":
    "The pod did not return a version for this item's access rules, so it cannot be changed safely.",
  "invalid-response": "The pod returned access rules this app could not read.",
  scope: "This item's access rules point outside the pod, so they cannot be edited here.",
  "comments-container-required": "This role needs a comments container, which Issues does not use.",
};

/** A refusal from the pod-access role layer, carrying a message fit for the UI. */
export class SharingError extends Error {
  constructor(
    readonly url: string,
    readonly code: SharingErrorCode,
    options?: { cause?: unknown },
  ) {
    super(MESSAGES[code], options);
    this.name = "SharingError";
  }
}

/** Map a pod-access refusal to a {@link SharingError}; other errors pass through. */
function toSharingError(error: unknown, url: string): unknown {
  if (error instanceof SharingError || !isRoleError(error)) return error;
  return new SharingError(error.url || url, error.code, { cause: error });
}

/** A mutation reports per-URL refusals in `failed` instead of throwing; surface the first. */
function throwIfFailed(result: SetGrantsResult): void {
  const failure = result.failed[0];
  if (failure) throw toSharingError(failure.error, failure.url);
}

function roleOptions(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): GrantMutationOptions {
  return {
    // Resolve the global at call time so the auth-patched fetch is always used.
    fetch: fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
    // The signed-in owner: pod-access refuses any change that drops their control.
    webId: ownerWebId,
    // A container share cascades to its members (acl:default / acp:memberAccessControl).
    kind: resourceUrl.endsWith("/") ? "folder" : "resource",
  };
}

function sameAgent(a: AgentRef, b: AgentRef): boolean {
  return a.type === b.type && ("id" in a ? a.id : "") === ("id" in b ? b.id : "");
}

async function guard<T>(url: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toSharingError(error, url);
  }
}

/**
 * List the people and groups a resource is shared with directly, as named roles.
 * The owner, public/authenticated grants, and access inherited from a parent
 * folder are not listed; grants that match no role are omitted by pod-access
 * (never rounded up).
 */
export function listRoleAssignments(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): Promise<RoleAssignment[]> {
  return guard(resourceUrl, async () => {
    const snapshot = await readGrants(resourceUrl, roleOptions(resourceUrl, ownerWebId, fetchImpl));
    const out: RoleAssignment[] = [];
    for (const grant of snapshot.grants) {
      if (grant.inherited) continue;
      const role = roleForPodRole(grant.role);
      if (grant.agent.type === "webid" && grant.agent.id !== ownerWebId) {
        out.push({ subject: grant.agent.id, kind: "agent", role });
      } else if (grant.agent.type === "group") {
        out.push({ subject: grant.agent.id, kind: "group", role });
      }
    }
    return out;
  });
}

/**
 * Set one principal's role on a resource, replacing any direct role it had
 * (raising or lowering it). Other grants are left as pod-access read them, and
 * the write is conditional on the snapshot it was planned from.
 */
function setRole(
  resourceUrl: string,
  ownerWebId: string,
  agent: AgentRef,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return guard(resourceUrl, async () => {
    const options = roleOptions(resourceUrl, ownerWebId, fetchImpl);
    const snapshot = await readGrants(resourceUrl, options);
    const others = snapshot.grants.filter((g) => g.inherited || !sameAgent(g.agent, agent));
    const result = await setGrants(
      [resourceUrl],
      [...others, { agent, role: podRoleFor(role), inherited: false, source: "" }],
      { ...options, expected: snapshot },
    );
    throwIfFailed(result);
  });
}

/** Assign a named role to a person (WebID) on a resource (F7). */
export function assignRole(
  resourceUrl: string,
  ownerWebId: string,
  webId: string,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return setRole(resourceUrl, ownerWebId, { type: "webid", id: webId }, role, fetchImpl);
}

/** Assign a named role to a group (WAC acl:agentGroup) on a resource (F7). */
export function assignGroupRole(
  resourceUrl: string,
  ownerWebId: string,
  groupIri: string,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return setRole(resourceUrl, ownerWebId, { type: "group", id: groupIri }, role, fetchImpl);
}

/**
 * Revoke a person's direct access on a resource. Idempotent when they have
 * none; access inherited from a parent folder is refused (`inherited-grant`).
 */
export function revokeAccess(
  resourceUrl: string,
  ownerWebId: string,
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return guard(resourceUrl, async () => {
    const options = roleOptions(resourceUrl, ownerWebId, fetchImpl);
    throwIfFailed(await removeGrant([resourceUrl], { type: "webid", id: webId }, options));
  });
}

/** Make a resource publicly readable, keeping the owner's control and all other grants. */
export function grantPublicRead(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return guard(resourceUrl, async () => {
    const options = roleOptions(resourceUrl, ownerWebId, fetchImpl);
    throwIfFailed(
      await addGrant(
        [resourceUrl],
        { agent: { type: "public" }, role: "viewer", inherited: false, source: "" },
        options,
      ),
    );
  });
}
