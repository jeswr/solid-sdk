// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// Drive's thin view-model adapter over the SDK role layer. Discovery, WAC/ACP parsing,
// inherited-ACL copying, owner lockout, conditional writes and RDF serialisation all
// live in @jeswr/pod-access/roles; this module only maps grants to the dialog's shape,
// keeps the dialog-specific guards the SDK does not have, and maps SDK refusals to UI copy.
import {
  type AgentRef,
  type GrantSnapshot,
  isRoleError,
  type ResourceKind,
  type Role,
  type RoleError,
  type RoleGrant,
  type RolesOptions,
  readGrants,
  readScopedGrants,
  removeGrant,
  type ScopedGrantSnapshot,
  setGrants,
  setScopedGrants,
} from "@jeswr/pod-access/roles";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { SharingError } from "./rdf";
import type { AccessOrigin, SharingRole, SharingSelection, SharingState } from "./types";
import {
  type AccessCapture,
  CHANGED_WHILE_SAVING,
  pinFetch,
  recordAccess,
  UNSUPPORTED_SYSTEM,
  usesEssModes,
  verifyAccess,
  verifyScopedAccess,
} from "./verify";

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
  /** A folder whose contents' effective access differs from the folder's own access. */
  readonly contentsDiffer: boolean;
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
/**
 * The pod accepted the change (`committed`) or the write's outcome is unknown, and the access
 * could not be reloaded to confirm it. Discard stale controls; retry only the read.
 */
export class SharingRefreshError extends Error {
  constructor(
    cause: unknown,
    readonly committed = true,
  ) {
    super(
      committed
        ? "Your sharing change was sent, but current access couldn't be reloaded to confirm it. Retry to verify access."
        : "The sharing write outcome is unknown. Retry to verify current access before making more changes.",
      { cause },
    );
  }
}
/** The reloaded access does not match the selection. `snapshot` is that reloaded access. */
export class SharingIncompleteError extends Error {
  constructor(
    readonly snapshot: SharingSnapshot,
    readonly unchanged: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Sharing wasn't saved as chosen for ${unchanged.join(", ")}. The current access is shown; review it and try again.`,
      options,
    );
  }
}

export const CONTENTS_DIFFER =
  "Items inside that have their own sharing won't change. Open an item's sharing to change it.";
const PARTIAL_SCOPE =
  "This folder has different sharing for the folder and its contents. Use a sharing tool that supports separate folder and contents permissions.";
const NOT_SAVED = "Permissions were not saved.";
const LOAD_MESSAGES: Partial<Record<RoleError["code"], string>> = {
  "partial-scope": PARTIAL_SCOPE,
  unsupported: "This item's sharing uses access rules that this dialog can't show.",
  scope: "This item's access document is outside your pod, so its sharing can't be shown.",
};
const SAVE_MESSAGES: Partial<Record<RoleError["code"], string>> = {
  "partial-scope": `${PARTIAL_SCOPE} ${NOT_SAVED}`,
  "owner-lockout": "You cannot remove your own owner access or Control",
  "inherited-grant": "Inherited access must be changed at its source",
  unsupported: `These permissions use access rules that this dialog can't change. ${NOT_SAVED}`,
  "precondition-required": `The pod didn't provide a version (ETag) for this item's access document, so sharing can't be changed safely. ${NOT_SAVED}`,
  scope: `This item's access document is outside your pod. ${NOT_SAVED}`,
  "comments-container-required": `Commenter is not available for this item yet. ${NOT_SAVED}`,
};

/**
 * Map an SDK load failure to the dialog's error copy; app refusals pass through. Inrupt ESS
 * shapes (a query-string ACR URL, or acp:* modes in a document the SDK could not read) are
 * named as an unsupported access system rather than an off-pod document or a transient error.
 */
export function loadError(error: unknown, documents: readonly AccessCapture[] = []): SharingError {
  if (error instanceof SharingError) return error;
  const ess = isRoleError(error)
    ? error.code === "scope" && error.url.includes("?")
    : usesEssModes(documents);
  const message = ess
    ? UNSUPPORTED_SYSTEM
    : isRoleError(error)
      ? LOAD_MESSAGES[error.code]
      : undefined;
  return new SharingError(message ?? "Couldn't load sharing. Try again.", { cause: error });
}
/**
 * Map an SDK save failure. Once the PUT began, an unclassified failure or a refused
 * (redirected) response leaves the outcome unknown; a non-success status is a refusal.
 */
export function saveError(error: unknown, writing: boolean): Error {
  if (writing && (!isRoleError(error) || error.code === "scope"))
    return new SharingRefreshError(error, false);
  if (isRoleError(error))
    return new SharingError(
      SAVE_MESSAGES[error.code] ?? `Couldn't save sharing. ${NOT_SAVED} Try again.`,
      { cause: error },
    );
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
function kind(resource: string): ResourceKind {
  return resource.endsWith("/") ? "folder" : "resource";
}
function options(session: SharingSession, resource: string): RolesOptions {
  return { fetch: session.fetch, root: session.storageUrl, kind: kind(resource) };
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

/**
 * Read current access through the SDK role layer, bounded to the selected storage. The access
 * documents the SDK read are re-checked by `verifyAccess`, so access the role projection
 * dropped fails closed instead of being shown as narrower than it is.
 */
export async function loadSharing(
  session: SharingSession,
  resource: string,
): Promise<SharingSnapshot> {
  return (await readSharing(session, resource)).snapshot;
}
/** Read through a recording fetch; a refused read is mapped with the documents it saw. */
async function recorded<T>(
  session: SharingSession,
  resource: string,
  read: (url: string, options: RolesOptions) => Promise<T>,
): Promise<{ recorder: ReturnType<typeof recordAccess>; grants: T }> {
  const recorder = recordAccess(session.fetch);
  try {
    return {
      recorder,
      grants: await read(resource, options({ ...session, fetch: recorder.fetch }, resource)),
    };
  } catch (error) {
    throw loadError(error, await recorder.documents(resource).catch(() => []));
  }
}
/** `loadSharing`, plus the access documents' validators for binding a follow-up write. */
async function readSharing(
  session: SharingSession,
  resource: string,
): Promise<{ snapshot: SharingSnapshot; pins: ReadonlyMap<string, string> }> {
  const { recorder, grants } = await recorded(session, resource, readGrants);
  const state = toSharingState(grants.grants);
  const { contentsDiffer } = await verifyAccess(
    resource,
    kind(resource),
    () => recorder.documents(resource),
    grants.grants,
  );
  const owner = state.people.some((p) => p.webId === session.webId && p.role === "owner");
  return {
    snapshot: {
      resource,
      grants,
      state,
      canManage: owner,
      contentsDiffer,
    },
    pins: recorder.validators(),
  };
}

/** The anonymous role a selection asks for. Anonymous Read has two presentations. */
function generalChoice(selection: SharingSelection): SharingState["link"] {
  return selection.link === "editor"
    ? "editor"
    : selection.link === "viewer" || selection.public === "viewer"
      ? "viewer"
      : "none";
}
/** Principals whose access in `state` is not what `selection` asked for. */
function unmet(state: SharingState, selection: SharingSelection): string[] {
  const wanted = new Map(selection.people.map((person) => [person.webId, person.role]));
  const actual = new Map(state.people.map((person) => [person.webId, person.role]));
  const people = [...new Set([...wanted.keys(), ...actual.keys()])]
    .filter((webId) => wanted.get(webId) !== actual.get(webId))
    .sort();
  return generalChoice(selection) === state.link ? people : [...people, "general access"];
}
/**
 * Whether `state` is exactly the selection except for principals still awaiting removal,
 * each still at the access the dialog showed. Anything else is a concurrent change.
 */
function onlyPending(
  state: SharingState,
  shown: SharingState,
  selection: SharingSelection,
  pending: readonly AgentRef[],
): boolean {
  return unmet(state, selection).every((id) => {
    if (id === "general access")
      return pending.some((agent) => agent.type === "public") && state.link === shown.link;
    const role = (people: SharingState["people"]) =>
      people.find((person) => person.webId === id)?.role;
    return (
      pending.some((agent) => agent.type === "webid" && agent.id === id) &&
      role(state.people) === role(shown.people)
    );
  });
}

export interface SharingPlan {
  /** The full grant set for `setGrants`; removed principals are omitted. */
  readonly grants: RoleGrant[];
  /** Principals the selection removes, applied again with `removeGrant` (see `applySharing`). */
  readonly removals: AgentRef[];
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
): SharingPlan | undefined {
  const selected = new Map<string, SharingRole>();
  for (const person of selection.people) {
    if (safeHttpIri(person.webId) !== person.webId) throw new SharingError("Enter a valid WebID");
    if (selected.has(person.webId)) throw new SharingError("Duplicate person identifier");
    selected.set(person.webId, person.role);
  }
  const rows = (id: string) => snapshot.grants.grants.filter((grant) => key(grant) === id);
  const current = new Map(snapshot.state.people.map((person) => [person.webId, person]));
  const grants: RoleGrant[] = [];
  const removals: AgentRef[] = [];
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
    else removals.push({ type: "webid", id: webId });
  }
  // Clearing both anonymous presentations restricts access.
  const general = generalChoice(selection);
  if (general === snapshot.state.link) grants.push(...rows("public"));
  else {
    if (snapshot.state.general.inherited)
      throw new SharingError("Inherited access must be changed at its source");
    changed = true;
    if (general !== "none")
      grants.push({ agent: { type: "public" }, role: general, inherited: false, source: "" });
    else removals.push({ type: "public" });
  }
  return changed ? { grants, removals } : undefined;
}

/**
 * Apply a selection, conditional on the snapshot the dialog showed, and report success only
 * when the reloaded access matches the selection (`SharingIncompleteError` otherwise).
 *
 * SDK gap: `setGrants` seeds a WAC ACL's rows copied from an inherited default
 * (materializedFrom) before the caller's grants, so omitting such a principal never removes
 * it. After the conditional `setGrants`, each removed principal therefore also goes through
 * `removeGrant`, which deletes that principal from the own document and is a no-op when the
 * principal is already gone.
 */
export async function applySharing(
  session: SharingSession,
  snapshot: SharingSnapshot,
  selection: SharingSelection,
): Promise<SharingSnapshot> {
  if (!snapshot.canManage)
    throw new SharingError(snapshot.readOnly ?? "Only an owner can change sharing");
  const plan = toGrants(session, snapshot, selection);
  if (!plan) return snapshot;
  let writing = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT") writing = true;
    return session.fetch(input, init);
  };
  const mutation = { ...options({ ...session, fetch }, snapshot.resource), webId: session.webId };
  let failure: unknown;
  try {
    const result = await setGrants([snapshot.resource], plan.grants, {
      ...mutation,
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
  // From here on part of the selection may already be stored, so every failure is reported
  // against the reloaded access rather than as "not saved".
  // SDK gap: removeGrant takes no expected snapshot. Each removal is therefore bound to a
  // fresh read that must equal the selection plus the removals still to come; the pinned
  // fetch then refuses the removal if any access document changed since that read, and the
  // SDK's If-Match covers the rest. A concurrent change stops the removals.
  const failures: unknown[] = [];
  for (const [index, agent] of plan.removals.entries()) {
    try {
      const { snapshot: current, pins } = await readSharing(session, snapshot.resource);
      if (!onlyPending(current.state, snapshot.state, selection, plan.removals.slice(index))) {
        failures.push(new SharingError(CHANGED_WHILE_SAVING));
        break;
      }
      const gone =
        agent.type === "webid"
          ? !current.state.people.some((person) => person.webId === agent.id)
          : current.state.link === "none";
      if (gone) continue;
      const result = await removeGrant([snapshot.resource], agent, {
        ...mutation,
        fetch: pinFetch(fetch, pins),
      });
      failures.push(...result.failed.map((failed) => failed.error));
      if (result.failed.length) break;
    } catch (error) {
      failures.push(error);
      break;
    }
  }
  let fresh: SharingSnapshot;
  try {
    fresh = await loadSharing(session, snapshot.resource);
  } catch (cause) {
    throw new SharingRefreshError(cause, writing && !failures.length);
  }
  const unchanged = unmet(fresh.state, selection);
  if (unchanged.length)
    throw new SharingIncompleteError(
      fresh,
      unchanged,
      failures.length ? { cause: failures[0] } : undefined,
    );
  return fresh;
}

/** Whether a load failed only because the folder's own and contents access differ. */
export function isPartialScope(error: unknown): boolean {
  const cause = error instanceof SharingError ? error.cause : error;
  return isRoleError(cause) && cause.code === "partial-scope";
}

/** A folder's access shown separately for the folder itself and for the items inside it. */
export interface ScopedSharingSnapshot {
  readonly resource: string;
  readonly grants: ScopedGrantSnapshot;
  readonly folder: SharingState;
  readonly contents: SharingState;
  /** The user owns the folder itself. */
  readonly canManage: boolean;
  /** The user also owns the items inside; without it only aligning them to the folder works. */
  readonly ownsContents: boolean;
}
export interface ScopedSharingSelection {
  readonly folder: SharingSelection;
  readonly contents: SharingSelection;
}
/** A per-scope save the pod took, but whose reloaded access differs from what was chosen. */
export class ScopedSharingIncompleteError extends Error {
  constructor(
    readonly snapshot: ScopedSharingSnapshot,
    readonly unchanged: readonly string[],
  ) {
    super(
      `Sharing wasn't saved as chosen for ${unchanged.join(", ")}. The current access is shown; review it and try again.`,
    );
  }
}

/** Read a folder's access per scope; access the projection dropped fails closed. */
export async function loadScopedSharing(
  session: SharingSession,
  resource: string,
): Promise<ScopedSharingSnapshot> {
  const { recorder, grants } = await recorded(session, resource, readScopedGrants);
  const folder = toSharingState(grants.folder);
  const contents = toSharingState(grants.contents);
  await verifyScopedAccess(
    resource,
    () => recorder.documents(resource),
    grants.folder,
    grants.contents,
  );
  const owns = (state: SharingState) =>
    state.people.some((p) => p.webId === session.webId && p.role === "owner");
  return {
    resource,
    grants,
    folder,
    contents,
    canManage: owns(folder),
    ownsContents: owns(contents),
  };
}

/** The full grant set for one scope: unchanged rows verbatim, changed ones re-planned. */
function scopeGrants(
  session: SharingSession,
  snapshot: ScopedSharingSnapshot,
  scope: "folder" | "contents",
  selection: SharingSelection,
): RoleGrant[] {
  const view: SharingSnapshot = {
    resource: snapshot.resource,
    grants: {
      url: snapshot.resource,
      grants: snapshot.grants[scope],
      version: snapshot.grants.version,
    },
    state: snapshot[scope],
    canManage: snapshot.canManage,
    contentsDiffer: true,
  };
  const plan = toGrants(session, view, selection);
  // setScopedGrants takes the full set, so an omitted principal is removed directly. An
  // unchanged scope is still sent: its raw modes may differ from its roles (Write without
  // Append, say), and the SDK rewrites only rules whose modes differ from the roles given.
  return plan ? plan.grants : snapshot.grants[scope];
}

/**
 * Apply a per-scope selection in one conditional write, and report success only when the
 * reloaded access matches both scopes. `changed` is whether anything was written.
 */
export async function applyScopedSharing(
  session: SharingSession,
  snapshot: ScopedSharingSnapshot,
  selection: ScopedSharingSelection,
): Promise<{ snapshot: ScopedSharingSnapshot; changed: boolean }> {
  if (!snapshot.canManage) throw new SharingError("Only an owner can change sharing");
  const folder = scopeGrants(session, snapshot, "folder", selection.folder);
  const contents = scopeGrants(session, snapshot, "contents", selection.contents);
  let writing = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT") writing = true;
    return session.fetch(input, init);
  };
  let failure: unknown;
  try {
    const result = await setScopedGrants(
      snapshot.resource,
      { folder, contents },
      {
        ...options({ ...session, fetch }, snapshot.resource),
        webId: session.webId,
        expected: snapshot.grants,
      },
    );
    failure = result.failed[0]?.error;
  } catch (error) {
    failure = error;
  }
  if (failure !== undefined) {
    if (isRoleError(failure) && failure.code === "conflict") throw new SharingConflictError();
    // Once a write was sent, its outcome is unknown whatever the error says.
    if (writing) throw new SharingRefreshError(failure, false);
    throw saveError(failure, false);
  }
  // Nothing to write: the snapshot passed the version check, so it is still current.
  if (!writing) return { snapshot, changed: false };
  let fresh: ScopedSharingSnapshot;
  try {
    fresh = await loadScopedSharing(session, snapshot.resource);
  } catch (cause) {
    throw new SharingRefreshError(cause);
  }
  const unchanged = [
    ...unmet(fresh.folder, selection.folder).map((id) => `${id} (this folder)`),
    ...unmet(fresh.contents, selection.contents).map((id) => `${id} (items inside)`),
  ];
  if (unchanged.length) throw new ScopedSharingIncompleteError(fresh, unchanged);
  return { snapshot: fresh, changed: true };
}
