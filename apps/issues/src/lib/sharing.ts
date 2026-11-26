// AUTHORED-BY Claude Opus 5.5
import {
  type AgentRef,
  addGrant,
  type GrantMutationOptions,
  isRoleError,
  type RoleError,
  readAccessModes,
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

/** Raised when a bulk change reached only some members; retrying finishes it. */
export class PartialSharingError extends Error {
  constructor(
    readonly failedUrls: readonly string[],
    action: "removed" | "lowered",
    options?: { cause?: unknown },
  ) {
    super(
      `Access was only partly ${action}: ${failedUrls.length} issue${failedUrls.length === 1 ? "" : "s"} could not be updated. Try again to finish it.`,
      options,
    );
    this.name = "PartialSharingError";
  }
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Members that hold their own ACL carrying any direct grant (of any mode set, even one that maps
 * to no role) for `webId`. Members that only inherit are skipped: their access comes from the tracker.
 */
async function copiesOf(
  url: string,
  ownerWebId: string,
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const snapshot = await readAccessModes(url, roleOptions(url, ownerWebId, fetchImpl));
  return (
    snapshot.governedBy === url &&
    snapshot.resource.some((p) => p.agent.type === "webid" && p.agent.id === webId)
  );
}

/**
 * Revoke a person's direct access on each member that holds a copy. Sharing a single issue gives
 * it its own ACL that copies the tracker's inheritable grants, so removing someone from the
 * tracker must also remove those copies. Every grant the person holds on the member's own ACL is
 * removed, whether or not it maps to a role. Call this BEFORE revoking the tracker so a partial
 * failure leaves the person visible (and the revoke retryable); it continues past individual
 * failures and then throws {@link PartialSharingError}.
 */
export async function revokeCopiedAccess(
  memberUrls: readonly string[],
  ownerWebId: string,
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const failed: string[] = [];
  let cause: unknown;
  for (const url of memberUrls) {
    try {
      await guard(url, async () => {
        if (!(await copiesOf(url, ownerWebId, webId, fetchImpl))) return;
        const options = roleOptions(url, ownerWebId, fetchImpl);
        throwIfFailed(await removeGrant([url], { type: "webid", id: webId }, options));
      });
    } catch (error) {
      failed.push(url);
      cause ??= error;
    }
  }
  if (failed.length) throw new PartialSharingError(failed, "removed", { cause });
}

/**
 * Lower a person's copied role on each member with its own ACL to at most `role`. Never widens:
 * a copy already at or below `role` is untouched, and a copy that maps to no role is removed
 * rather than rounded up. Call BEFORE lowering the tracker, with the same partial-failure rule
 * as {@link revokeCopiedAccess}.
 */
export async function lowerCopiedAccess(
  memberUrls: readonly string[],
  ownerWebId: string,
  webId: string,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const failed: string[] = [];
  let cause: unknown;
  for (const url of memberUrls) {
    try {
      await guard(url, async () => {
        if (!(await copiesOf(url, ownerWebId, webId, fetchImpl))) return;
        const options = roleOptions(url, ownerWebId, fetchImpl);
        const { grants } = await readGrants(url, options);
        const held = grants.find(
          (g) => !g.inherited && g.agent.type === "webid" && g.agent.id === webId,
        );
        if (!held) {
          // Direct grant with no role (e.g. Append only): remove it, never round it up.
          throwIfFailed(await removeGrant([url], { type: "webid", id: webId }, options));
        } else if (ROLE_RANK[roleForPodRole(held.role)] > ROLE_RANK[role]) {
          await setRole(url, ownerWebId, { type: "webid", id: webId }, role, fetchImpl);
        }
      });
    } catch (error) {
      failed.push(url);
      cause ??= error;
    }
  }
  if (failed.length) throw new PartialSharingError(failed, "lowered", { cause });
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
