// AUTHORED-BY Claude Opus 5.5
/**
 * Per-resource sharing — the read/write model behind the Sharing panel.
 *
 * All access-control I/O goes through `@jeswr/pod-access/roles`: discovery
 * (`Link: rel="acl"`), WAC and ACP parsing, inheritance, conditional writes
 * (`If-Match` / `If-None-Match: *`, no silent 412 retry), materialisation of
 * inherited WAC rules on the first change, and the caller-lockout preflight.
 * This module only maps that role model onto the panel's plain-language levels
 * and turns its typed refusals into copy the UI can show.
 *
 * What the role model deliberately cannot express (and so the panel does not
 * offer): append-only or other partial mode sets (never shown, never rounded
 * up — an edit that would drop one is refused), `acl:origin` restrictions or
 * other conditional rules (the read is refused), folders whose own access
 * differs between the folder and its contents (`partial-scope`), and removing
 * inherited access from a single item (`inherited-grant`: change it on the
 * folder). Refusals are fail-closed and reach the UI as {@link SharingError}.
 */
import {
  type AgentRef,
  addGrant,
  type GrantMutationOptions,
  type GrantSnapshot,
  isRoleError,
  type Role,
  type RoleGrant,
  readGrants,
  removeGrant,
  type SetGrantsResult,
  setGrants,
} from "@jeswr/pod-access/roles";
import { NotAuthenticatedError, SharingError, type SharingErrorCode } from "./errors.js";

/** The levels the panel offers: pod-access roles without the comments role. */
export type AccessLevel = Exclude<Role, "commenter">;

/** Who a row is about. `app` (an ACP client matcher) is shown read-only. */
export type SubjectKind = "agent" | "group" | "public" | "authenticated" | "app";

/** A subject the panel can address: a who + how-it-is-named. */
export interface AccessSubject {
  kind: SubjectKind;
  /** WebID, group IRI or app client id; empty for public / authenticated. */
  id: string;
}

/** Where a row's access is set relative to the resource being shared. */
export type AccessSource = "direct" | "inherited";

/** One row in the "who has access" view for a resource. */
export interface AccessEntry {
  subject: AccessSubject;
  /** The subject's effective role on the resource. */
  level: AccessLevel;
  /** `direct` when the resource's own access document grants it. */
  source: AccessSource;
  /** The access document that grants it (an ancestor's when inherited). */
  sourceUrl: string;
}

/** The effective-access read model for one resource. */
export interface ResourceAccess {
  resourceUrl: string;
  /** True when every row comes from an ancestor (no access set here yet). */
  inherited: boolean;
  /** One row per subject, highest level first. */
  entries: AccessEntry[];
  /**
   * The pod-access read token. Edits pass it as `expected`, so a change made
   * elsewhere since this read is refused as a `conflict`, never overwritten.
   */
  snapshot: GrantSnapshot;
}

/** The per-resource sharing backend the panel talks to. */
export interface ResourceSharingBackend {
  read(resourceUrl: string): Promise<ResourceAccess>;
  /**
   * Set one subject's level. Adding or raising touches only that subject
   * (`addGrant`); lowering is a full-set edit conditional on `access.snapshot`.
   */
  setAccess(access: ResourceAccess, subject: AccessSubject, level: AccessLevel): Promise<void>;
  /** Remove one subject's access set on this resource. */
  removeAccess(access: ResourceAccess, subject: AccessSubject): Promise<void>;
}

// ─── Subject ⇄ AgentRef ───────────────────────────────────────────────────────

/** Stable key per subject; public/authenticated are singletons. */
export function subjectKey(s: AccessSubject): string {
  return s.kind === "public" || s.kind === "authenticated" ? s.kind : `${s.kind}|${s.id}`;
}

function subjectOf(agent: AgentRef): AccessSubject {
  switch (agent.type) {
    case "webid":
      return { kind: "agent", id: agent.id };
    case "group":
      return { kind: "group", id: agent.id };
    case "app":
      return { kind: "app", id: agent.id };
    case "public":
    case "authenticated":
      return { kind: agent.type, id: "" };
  }
}

function agentOf(subject: AccessSubject): AgentRef {
  switch (subject.kind) {
    case "agent":
      return { type: "webid", id: subject.id };
    case "group":
      return { type: "group", id: subject.id };
    case "app":
      return { type: "app", id: subject.id };
    case "public":
    case "authenticated":
      return { type: subject.kind };
  }
}

/** Without a comments container no row is a commenter; never round one up. */
function levelOf(role: Role): AccessLevel {
  return role === "commenter" ? "viewer" : role;
}

const LEVEL_RANK: Record<AccessLevel, number> = { manager: 0, editor: 1, viewer: 2 };
const KIND_RANK: Record<SubjectKind, number> = {
  agent: 0,
  group: 1,
  app: 2,
  authenticated: 3,
  public: 4,
};

/** Project a pod-access snapshot onto one row per subject. */
export function toResourceAccess(resourceUrl: string, snapshot: GrantSnapshot): ResourceAccess {
  const bySubject = new Map<string, AccessEntry>();
  for (const grant of snapshot.grants) {
    const subject = subjectOf(grant.agent);
    const key = subjectKey(subject);
    const existing = bySubject.get(key);
    // pod-access reports the principal's effective role on every contributing
    // source; prefer the direct row so `source` says where it can be edited.
    if (existing && (existing.source === "direct" || grant.inherited)) continue;
    bySubject.set(key, {
      subject,
      level: levelOf(grant.role),
      source: grant.inherited ? "inherited" : "direct",
      sourceUrl: grant.source,
    });
  }
  const entries = [...bySubject.values()].sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      KIND_RANK[a.subject.kind] - KIND_RANK[b.subject.kind] ||
      a.subject.id.localeCompare(b.subject.id),
  );
  return {
    resourceUrl,
    inherited: entries.length > 0 && entries.every((e) => e.source === "inherited"),
    entries,
    snapshot,
  };
}

// ─── Self-lockout guard ─────────────────────────────────────────────────────

/**
 * Would `change` take Owner (manager) away from the signed-in user? The panel
 * checks this before offering a change; pod-access independently refuses any
 * write that leaves the caller without Control (`owner-lockout`).
 */
export function wouldLockOutOwner(
  access: ResourceAccess,
  ownerWebId: string,
  change: { subject: AccessSubject; level: AccessLevel } | { subject: AccessSubject; remove: true },
): boolean {
  const owner = subjectKey({ kind: "agent", id: ownerWebId });
  if (subjectKey(change.subject) !== owner) return false;
  const current = access.entries.find((e) => subjectKey(e.subject) === owner);
  if (current?.level !== "manager") return false;
  return "remove" in change || change.level !== "manager";
}

// ─── Errors ─────────────────────────────────────────────────────────────────

const MESSAGES: Record<SharingErrorCode, string> = {
  "owner-lockout": "That would remove your own ability to manage this. Keep yourself as Owner.",
  conflict:
    "The access settings changed while you were editing. The latest settings are shown — try again.",
  "inherited-grant":
    "This access comes from the folder this item is in. Change or remove it on that folder.",
  "partial-scope":
    "This folder's access is set differently for the folder and for what's inside it, so it can't be shown or changed here safely.",
  unsupported:
    "These access settings use rules this panel can't show or change safely (for example app-origin or conditional rules).",
  "precondition-required":
    "The pod didn't provide a version tag for the access settings, so they can't be changed safely.",
  scope: "These access settings live outside your pod, so they can't be changed here.",
  "invalid-response":
    "The pod refused the request or answered unexpectedly. You may not have permission to manage sharing here.",
  "comments-container-required": "Comment access isn't available for this item.",
  failed: "Couldn't reach the access settings. Check your connection and try again.",
};

/** Wrap any sharing failure as a {@link SharingError} with plain-language copy. */
export function toSharingError(error: unknown): SharingError {
  if (error instanceof SharingError) return error;
  const code: SharingErrorCode = isRoleError(error) ? error.code : "failed";
  return new SharingError(code, MESSAGES[code], { cause: error });
}

/** A single-URL batch either applied or carries its refusal; surface the latter. */
function settle(result: SetGrantsResult): void {
  const failure = result.failed[0];
  if (failure) throw toSharingError(failure.error);
}

// ─── Backend ────────────────────────────────────────────────────────────────

/** {@link ResourceSharingBackend} over `@jeswr/pod-access/roles`. */
export class RoleResourceSharingBackend implements ResourceSharingBackend {
  /**
   * @param ownerWebId - the signed-in user's WebID (the lockout-protected caller).
   * @param fetchImpl - the session's authenticated `podFetch`.
   * @param podRoot - the active storage root; bounds ancestor discovery.
   */
  constructor(
    private readonly ownerWebId: string,
    private readonly fetchImpl: typeof fetch,
    private readonly podRoot?: string,
  ) {
    if (!ownerWebId) throw new NotAuthenticatedError();
  }

  private options(resourceUrl: string): GrantMutationOptions {
    return {
      fetch: this.fetchImpl,
      webId: this.ownerWebId,
      // A folder's level covers the folder and everything inside it.
      kind: resourceUrl.endsWith("/") ? "folder" : "resource",
      ...(this.podRoot && resourceUrl.startsWith(this.podRoot) ? { root: this.podRoot } : {}),
    };
  }

  async read(resourceUrl: string): Promise<ResourceAccess> {
    try {
      return toResourceAccess(
        resourceUrl,
        await readGrants(resourceUrl, this.options(resourceUrl)),
      );
    } catch (error) {
      throw toSharingError(error);
    }
  }

  async setAccess(
    access: ResourceAccess,
    subject: AccessSubject,
    level: AccessLevel,
  ): Promise<void> {
    if (wouldLockOutOwner(access, this.ownerWebId, { subject, level })) {
      throw new SharingError("owner-lockout", MESSAGES["owner-lockout"]);
    }
    const key = subjectKey(subject);
    const grant: RoleGrant = {
      agent: agentOf(subject),
      role: level,
      inherited: false,
      source: "",
    };
    const current = access.entries.find((e) => subjectKey(e.subject) === key);
    const options = this.options(access.resourceUrl);
    try {
      if (!current || LEVEL_RANK[level] < LEVEL_RANK[current.level]) {
        // Add/raise only this subject; every other grant (including partial
        // ones the panel cannot show) is kept exactly as it is.
        settle(await addGrant([access.resourceUrl], grant, options));
        return;
      }
      // Lowering: a full-set edit against the snapshot the user saw. Other rows
      // pass back unchanged (pod-access keeps their exact modes), inherited rows
      // only validate their source, and a change made elsewhere since the read
      // is refused as a conflict. pod-access also refuses (`unsupported`) when
      // the edit would silently drop a partial grant it cannot represent.
      const grants = access.snapshot.grants.filter(
        (g) => g.inherited || subjectKey(subjectOf(g.agent)) !== key,
      );
      grants.push(grant);
      settle(
        await setGrants([access.resourceUrl], grants, { ...options, expected: access.snapshot }),
      );
    } catch (error) {
      throw toSharingError(error);
    }
  }

  async removeAccess(access: ResourceAccess, subject: AccessSubject): Promise<void> {
    if (wouldLockOutOwner(access, this.ownerWebId, { subject, remove: true })) {
      throw new SharingError("owner-lockout", MESSAGES["owner-lockout"]);
    }
    try {
      settle(
        await removeGrant([access.resourceUrl], agentOf(subject), this.options(access.resourceUrl)),
      );
    } catch (error) {
      throw toSharingError(error);
    }
  }
}

// ─── Copy ───────────────────────────────────────────────────────────────────

/** Plain-language label per level — access-control jargon never reaches the UI. */
export const LEVEL_LABEL: Record<AccessLevel, string> = {
  viewer: "Can view",
  editor: "Can edit",
  manager: "Owner",
};

/** A one-line description of what a level lets the subject do. */
export const LEVEL_DESCRIPTION: Record<AccessLevel, string> = {
  viewer: "Read this, but not change it.",
  editor: "Read and make changes.",
  manager: "Full control, including who else can access it.",
};

/** Plain-language label per subject kind, for the "who" column. */
export function subjectLabel(subject: AccessSubject): string {
  switch (subject.kind) {
    case "public":
      return "Anyone on the web";
    case "authenticated":
      return "Anyone signed in";
    case "group":
      return "A group";
    case "app":
      return "An app";
    case "agent":
      return subject.id;
  }
}
