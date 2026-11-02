// AUTHORED-BY Claude Opus 5.5
// Drive's thin view-model adapter over the SDK role layer. Discovery, WAC/ACP parsing,
// inherited-ACL copying, owner lockout, conditional writes and RDF serialisation all
// live in @jeswr/pod-access/roles; this module only maps grants to the dialog's shape,
// keeps the dialog-specific guards the SDK does not have, and maps SDK refusals to UI copy.
import {
  type GrantSnapshot,
  isRoleError,
  type Role,
  type RoleError,
  type RoleGrant,
  type RolesOptions,
  readGrants,
  setGrants,
} from "@jeswr/pod-access/roles";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { SharingError } from "./rdf";
import type { AccessOrigin, SharingRole, SharingSelection, SharingState } from "./types";

export interface SharingSession {
  readonly fetch: typeof globalThis.fetch;
  readonly storageUrl: string;
  readonly webId: string;
}
export interface SharingSnapshot {
  readonly resource: string;
  /** The SDK's opaque read token; every save is conditional on it. */
  readonly grants: GrantSnapshot;
  readonly state: SharingState;
  readonly canManage: boolean;
  /** Why an owner still cannot change sharing from this dialog. */
  readonly readOnly?: string;
}

const CONFLICT_RELOADED =
  "Sharing changed since you opened it. The current access is shown; review it and try again.";
const CONFLICT_RELOAD =
  "Sharing changed since you opened it. Reload to see the current access before making changes.";
/** A stale snapshot never overwrites newer access. `snapshot` is the fresh state, when readable. */
export class SharingConflictError extends Error {
  constructor(readonly snapshot?: SharingSnapshot) {
    super(snapshot ? CONFLICT_RELOADED : CONFLICT_RELOAD);
  }
}
/** The PUT committed or its response was lost. Discard stale controls; retry only the read. */
export class SharingRefreshError extends Error {
  constructor(
    cause: unknown,
    readonly committed = true,
  ) {
    super(
      committed
        ? "Sharing was saved, but current access couldn't be reloaded. Retry to verify access."
        : "The sharing write outcome is unknown. Retry to verify current access before making more changes.",
      { cause },
    );
  }
}

// SDK gap: role writes edit WAC acl:accessTo / ACP acp:accessControl only, so a folder
// grant would not reach its contents and a removal would leave descendant access behind.
// Decision: folders stay read-only in the dialog until the SDK can write member access.
export const FOLDER_READ_ONLY =
  "Folder sharing is read-only for now. Changes here would not reach the files and folders inside, so this dialog only shows who can access the folder itself. To change access to a file, share that file.";
const NOT_SAVED = "Permissions were not saved.";
const LOAD_MESSAGES: Partial<Record<RoleError["code"], string>> = {
  unsupported: "This item's sharing uses access rules that this dialog can't show.",
  scope: "This item's access document is outside your pod, so its sharing can't be shown.",
};
const SAVE_MESSAGES: Partial<Record<RoleError["code"], string>> = {
  "owner-lockout": "You cannot remove your own owner access or Control",
  "inherited-grant": "Inherited access must be changed at its source",
  unsupported: `These permissions use access rules that this dialog can't change. ${NOT_SAVED}`,
  "precondition-required": `The pod didn't provide a version (ETag) for this item's access document, so sharing can't be changed safely. ${NOT_SAVED}`,
  scope: `This item's access document is outside your pod. ${NOT_SAVED}`,
  "comments-container-required": `Commenter is not available for this item yet. ${NOT_SAVED}`,
};

/** Map an SDK load failure to the dialog's error copy; app refusals pass through. */
export function loadError(error: unknown): SharingError {
  if (error instanceof SharingError) return error;
  const message = isRoleError(error) ? LOAD_MESSAGES[error.code] : undefined;
  return new SharingError(message ?? "Couldn't load sharing. Try again.", { cause: error });
}
/** Map an SDK save failure. An unclassified failure after the PUT began has an unknown outcome. */
export function saveError(error: unknown, writing: boolean): Error {
  if (isRoleError(error))
    return new SharingError(
      SAVE_MESSAGES[error.code] ?? `Couldn't save sharing. ${NOT_SAVED} Try again.`,
      { cause: error },
    );
  if (writing) return new SharingRefreshError(error, false);
  return new SharingError(`Couldn't save sharing. ${NOT_SAVED} Try again.`, { cause: error });
}

const FROM_SDK: Record<Role, SharingRole> = {
  viewer: "viewer",
  commenter: "commenter",
  editor: "editor",
  manager: "owner",
};
const RANK: readonly SharingRole[] = ["viewer", "commenter", "editor", "owner"];
// ACP dialect: no `implementation` is passed, so the SDK applies its CSS default (managers
// hold resource acl:Control) and an Inrupt ESS pod is not recognised as owned. Both ESS
// shapes fail closed without writing: the SDK refuses ESS's query-string ACR URL
// (`?ext=acr`) as a `scope` error for every implementation, and rejects ESS acp:* modes
// under the CSS dialect. ESS support therefore needs SDK work first. Passing
// `implementation: "ess"` also needs a trusted signal, and none exists yet: the SDK treats
// the value as a caller assertion, storage capabilities report only the access model
// (WAC/ACP), and the ACP Link relation only selects ACP (this suite's CSS-dialect fixtures
// use it too). A wrong "ess" guess on a CSS-dialect server could write management in a
// vocabulary that server does not enforce.
function options(session: SharingSession, resource: string): RolesOptions {
  return {
    fetch: session.fetch,
    root: session.storageUrl,
    kind: resource.endsWith("/") ? "folder" : "resource",
  };
}
function origin(rows: readonly RoleGrant[]): AccessOrigin {
  return {
    inherited: rows.some((row) => row.inherited),
    explicit: rows.some((row) => !row.inherited),
    sources: [...new Set(rows.map((row) => row.source))].sort(),
  };
}
function highest(rows: readonly RoleGrant[]): SharingRole {
  return rows
    .map((row) => FROM_SDK[row.role])
    .sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0] as SharingRole;
}
function key(grant: RoleGrant): string {
  return grant.agent.type === "webid" ? grant.agent.id : grant.agent.type;
}

/** Project SDK grants into the dialog view model. Principals it cannot show fail closed. */
export function toSharingState(grants: readonly RoleGrant[]): SharingState {
  const people = new Map<string, RoleGrant[]>();
  const anonymous: RoleGrant[] = [];
  for (const grant of grants) {
    if (grant.agent.type === "webid")
      people.set(key(grant), [...(people.get(key(grant)) ?? []), grant]);
    else if (grant.agent.type === "public") anonymous.push(grant);
    else
      throw new SharingError(
        "Sharing with groups, apps or all signed-in users can't be shown in this dialog",
      );
  }
  const general = anonymous.length ? highest(anonymous) : undefined;
  if (general === "commenter" || general === "owner")
    throw new SharingError("Anonymous permissions exceed the sharing model");
  return {
    people: [...people.keys()].sort().map((webId) => {
      const rows = people.get(webId) as RoleGrant[];
      return { webId, role: highest(rows), ...origin(rows) };
    }),
    link: general ?? "none",
    public: general ? "viewer" : "none",
    general: origin(anonymous),
  };
}

/** Read current access through the SDK role layer, bounded to the selected storage. */
export async function loadSharing(
  session: SharingSession,
  resource: string,
): Promise<SharingSnapshot> {
  let grants: GrantSnapshot;
  try {
    grants = await readGrants(resource, options(session, resource));
  } catch (error) {
    throw loadError(error);
  }
  const state = toSharingState(grants.grants);
  const owner = state.people.some((p) => p.webId === session.webId && p.role === "owner");
  const folder = resource.endsWith("/");
  return {
    resource,
    grants,
    state,
    canManage: owner && !folder,
    ...(owner && folder ? { readOnly: FOLDER_READ_ONLY } : {}),
  };
}

/**
 * Translate the dialog's full selection into SDK grants. Unchanged principals keep their
 * SDK rows verbatim (including inherited provenance). Dialog guards the SDK lacks: other
 * owners and inherited rows are immutable here, and WebIDs must be safe HTTP IRIs.
 * The caller's own owner row is left to the SDK's owner-lockout guard.
 */
export function toGrants(
  session: SharingSession,
  snapshot: SharingSnapshot,
  selection: SharingSelection,
): RoleGrant[] | undefined {
  const selected = new Map<string, SharingRole>();
  for (const person of selection.people) {
    if (safeHttpIri(person.webId) !== person.webId) throw new SharingError("Enter a valid WebID");
    if (selected.has(person.webId)) throw new SharingError("Duplicate person identifier");
    selected.set(person.webId, person.role);
  }
  const rows = (id: string) => snapshot.grants.grants.filter((grant) => key(grant) === id);
  const current = new Map(snapshot.state.people.map((person) => [person.webId, person]));
  const grants: RoleGrant[] = [];
  let changed = false;
  for (const webId of new Set([...current.keys(), ...selected.keys()])) {
    const before = current.get(webId);
    const role = selected.get(webId);
    if (before?.role === role) {
      grants.push(...rows(webId));
      continue;
    }
    if (webId !== session.webId) {
      if (before?.role === "owner") throw new SharingError("Owner rows are read-only");
      if (before?.inherited)
        throw new SharingError("Inherited access must be changed at its source");
    }
    changed = true;
    if (role)
      grants.push({
        agent: { type: "webid", id: webId },
        role: role === "owner" ? "manager" : role,
        inherited: false,
        source: "",
      });
  }
  // Anonymous Read has two presentations. Clear both to restrict access.
  const general =
    selection.link === "editor"
      ? "editor"
      : selection.link === "viewer" || selection.public === "viewer"
        ? "viewer"
        : "none";
  if (general === snapshot.state.link) grants.push(...rows("public"));
  else {
    if (snapshot.state.general.inherited)
      throw new SharingError("Inherited access must be changed at its source");
    changed = true;
    if (general !== "none")
      grants.push({ agent: { type: "public" }, role: general, inherited: false, source: "" });
  }
  return changed ? grants : undefined;
}

/** Apply a selection with `setGrants`, conditional on the snapshot the dialog showed. */
export async function applySharing(
  session: SharingSession,
  snapshot: SharingSnapshot,
  selection: SharingSelection,
): Promise<SharingSnapshot> {
  if (!snapshot.canManage)
    throw new SharingError(snapshot.readOnly ?? "Only an owner can change sharing");
  const grants = toGrants(session, snapshot, selection);
  if (!grants) return snapshot;
  let writing = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT") writing = true;
    return session.fetch(input, init);
  };
  let failure: unknown;
  try {
    const result = await setGrants([snapshot.resource], grants, {
      ...options({ ...session, fetch }, snapshot.resource),
      webId: session.webId,
      expected: snapshot.grants,
    });
    failure = result.failed[0]?.error;
  } catch (error) {
    failure = error;
  }
  if (failure !== undefined) {
    if (isRoleError(failure) && failure.code === "conflict")
      throw new SharingConflictError(
        await loadSharing(session, snapshot.resource).catch(() => undefined),
      );
    throw saveError(failure, writing);
  }
  try {
    return await loadSharing(session, snapshot.resource);
  } catch (cause) {
    throw new SharingRefreshError(cause);
  }
}
