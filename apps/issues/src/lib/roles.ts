// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Claude Opus 5.5
import type { Role as PodRole } from "@jeswr/pod-access/roles";

/**
 * F7 — permission roles.
 *
 * A small set of NAMED role presets. The role MODEL is pure data (this module);
 * each preset names the `@jeswr/pod-access/roles` role it is stored as, and
 * applying it to a person/group goes through `sharing.ts`, which delegates every
 * ACL/ACR read and write to pod-access — never a hand-built ACL triple
 * (AGENTS.md §Access control / decisions/0001).
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
  /** The pod-access role this preset is stored as (the SINGLE source of the role map). */
  podRole: PodRole;
  /** The app-level capabilities the role unlocks. */
  capabilities: Capability[];
}

/**
 * The role → pod-access role map. This is the load-bearing definition: every
 * other helper derives from it. On a WAC/CSS pod pod-access stores these as:
 *
 * - `viewer`  → `viewer`  → acl:Read
 * - `editor`  → `editor`  → acl:Read + acl:Write (+ acl:Append, which Write already implies)
 * - `admin`   → `manager` → acl:Read + acl:Write + acl:Append + acl:Control
 *
 * pod-access's `commenter` role needs a separate comments container; Issues keeps
 * comments in the issue document, so commenting requires Write and is folded into
 * `editor`. `commenter` is never assigned by this app.
 */
export const ROLE_PRESETS: Record<Role, RolePreset> = {
  viewer: {
    role: "viewer",
    label: "Viewer",
    description: "Can read issues but not change them.",
    podRole: "viewer",
    capabilities: ["read"],
  },
  editor: {
    role: "editor",
    label: "Editor",
    description: "Can read, comment on, and edit issues.",
    podRole: "editor",
    capabilities: ["read", "comment", "edit"],
  },
  admin: {
    role: "admin",
    label: "Admin",
    description: "Full control, including managing who else has access.",
    podRole: "manager",
    capabilities: ["read", "comment", "edit", "share"],
  },
};

/** All role presets, coarse→fine (viewer → editor → admin). */
export const ROLES: RolePreset[] = [ROLE_PRESETS.viewer, ROLE_PRESETS.editor, ROLE_PRESETS.admin];

/** The pod-access role a named app role is stored as. */
export function podRoleFor(role: Role): PodRole {
  return ROLE_PRESETS[role].podRole;
}

/**
 * The app role an existing pod-access role is shown as (the inverse of
 * {@link podRoleFor}), for surfacing a grant read back from the pod.
 *
 * `commenter` (Read plus Append on a comments container this app does not use)
 * confers no edit access to issues, so it is shown as `viewer` — a grant is never
 * displayed as more access than it confers.
 */
export function roleForPodRole(role: PodRole): Role {
  switch (role) {
    case "manager":
      return "admin";
    case "editor":
      return "editor";
    default:
      return "viewer";
  }
}

/** The app-level capabilities a named role unlocks. */
export function capabilitiesForRole(role: Role): Capability[] {
  return [...ROLE_PRESETS[role].capabilities];
}

/** Whether a role unlocks a given capability. */
export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_PRESETS[role].capabilities.includes(capability);
}
