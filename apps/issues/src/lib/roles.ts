// AUTHORED-BY Claude Opus 4.8
import {
  type Access,
  type Grants,
  setAccess,
  setGroupAccess,
  listGrants,
} from "./sharing";

/**
 * F7 — permission roles.
 *
 * A small set of NAMED role presets that map to WAC mode bundles. The role MODEL
 * is pure data (this module); applying a role to a person/group goes through the
 * existing WAC accessors in `sharing.ts` ({@link setAccess}/{@link setGroupAccess})
 * — never a hand-built ACL triple (AGENTS.md §Access control / decisions/0001).
 *
 * Out of scope (per the bead): field-level permissions and server-administered
 * enterprise role schemes. These three presets cover the common Jira/Monday case
 * (viewer / member-editor / project-admin).
 */

/** The named issue-tracker roles, coarse→fine in capability. */
export type Role = "viewer" | "editor" | "admin";

/** A capability a role grants — the app-level verbs a role unlocks. */
export type Capability = "read" | "comment" | "edit" | "share";

export interface RolePreset {
  role: Role;
  label: string;
  description: string;
  /** The WAC access bundle this role grants (the SINGLE source of the role→WAC map). */
  access: Access;
  /** The app-level capabilities the role unlocks (derived view of `access`). */
  capabilities: Capability[];
}

const access = (read: boolean, write: boolean, control: boolean): Access => ({ read, write, control });

/**
 * The role → WAC-mode-bundle map. This is the load-bearing definition: every
 * other helper derives from it.
 *
 * - `viewer`  → acl:Read                          (read-only)
 * - `editor`  → acl:Read + acl:Write              (read + write/comment; a "member")
 * - `admin`   → acl:Read + acl:Write + acl:Control (full control, incl. the ACL/sharing)
 *
 * WAC has no append-only "comment" mode in this app's subset — commenting writes
 * the issue document, so it requires acl:Write (folded into the `editor` role).
 */
export const ROLE_PRESETS: Record<Role, RolePreset> = {
  viewer: {
    role: "viewer",
    label: "Viewer",
    description: "Can read issues but not change them.",
    access: access(true, false, false),
    capabilities: ["read"],
  },
  editor: {
    role: "editor",
    label: "Editor",
    description: "Can read, comment on, and edit issues.",
    access: access(true, true, false),
    capabilities: ["read", "comment", "edit"],
  },
  admin: {
    role: "admin",
    label: "Admin",
    description: "Full control, including managing who else has access.",
    access: access(true, true, true),
    capabilities: ["read", "comment", "edit", "share"],
  },
};

/** All role presets, coarse→fine (viewer → editor → admin). */
export const ROLES: RolePreset[] = [ROLE_PRESETS.viewer, ROLE_PRESETS.editor, ROLE_PRESETS.admin];

/** The WAC access bundle a named role grants. */
export function accessForRole(role: Role): Access {
  return { ...ROLE_PRESETS[role].access };
}

/** The app-level capabilities a named role unlocks. */
export function capabilitiesForRole(role: Role): Capability[] {
  return [...ROLE_PRESETS[role].capabilities];
}

/** Whether a role unlocks a given capability. */
export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_PRESETS[role].capabilities.includes(capability);
}

/**
 * Infer the named role a WAC access bundle corresponds to (the inverse of
 * {@link accessForRole}), for surfacing an existing grant as a role in the UI.
 *
 * - control (with read+write) ⇒ admin
 * - write   (with read)       ⇒ editor
 * - read only                 ⇒ viewer
 * - no read at all            ⇒ undefined (not a recognised grant; e.g. revoked)
 *
 * Capabilities only escalate WITH read access — a control/write grant that somehow
 * lacks read is degraded to the highest role its actual modes support, never
 * promoted, so an unusual ACL can't be read as more access than it confers.
 */
export function roleForAccess(a: Access): Role | undefined {
  if (a.control && a.read && a.write) return "admin";
  if (a.write && a.read) return "editor";
  if (a.read) return "viewer";
  return undefined;
}

/**
 * Assign a named role to a person on a resource (F7), via the WAC accessor — the
 * role is just a labelled mode bundle, so this delegates to {@link setAccess} with
 * the role's access. The owner is always preserved (sharing.ts rebuilds the ACL
 * with the owner retaining control).
 */
export function assignRole(
  resourceUrl: string,
  ownerWebId: string,
  webId: string,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return setAccess(resourceUrl, ownerWebId, webId, accessForRole(role), fetchImpl);
}

/** Assign a named role to a GROUP on a resource (F7), via the WAC group accessor. */
export function assignGroupRole(
  resourceUrl: string,
  ownerWebId: string,
  groupIri: string,
  role: Role,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return setGroupAccess(resourceUrl, ownerWebId, groupIri, accessForRole(role), fetchImpl);
}

/** A person/group's assigned role on a resource (the named view of their grant). */
export interface RoleAssignment {
  /** WebID (agent) or group IRI. */
  subject: string;
  kind: "agent" | "group";
  role: Role;
}

/**
 * List the role assignments on a resource (F7): read the WAC grants (excluding the
 * owner) and map each to its named role. Grants that map to no role (e.g. a bare
 * write-without-read) are omitted. Built on the existing {@link listGrants}.
 */
export async function listRoleAssignments(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): Promise<RoleAssignment[]> {
  const grants: Grants = await listGrants(resourceUrl, ownerWebId, fetchImpl);
  const out: RoleAssignment[] = [];
  for (const a of grants.agents) {
    const role = roleForAccess(a.access);
    if (role) out.push({ subject: a.webId, kind: "agent", role });
  }
  for (const g of grants.groups) {
    const role = roleForAccess(g.access);
    if (role) out.push({ subject: g.groupIri, kind: "group", role });
  }
  return out;
}
