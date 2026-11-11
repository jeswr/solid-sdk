// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
/** Role mapping and conditional Solid sharing; the offline root API remains independent. */

export { addGrant, grantsWithRoles, readGrants, removeGrant, setGrants } from "./client.js";
export { isRoleError } from "./errors.js";
export { modesToRole, rolesToModes } from "./mapping.js";
export type {
  MovePreservingAccessError,
  MovePreservingAccessOptions,
  MovePreservingAccessResult,
} from "./move.js";
export { movePreservingAccess } from "./move.js";
export type {
  AgentRef,
  GrantMutationOptions,
  GrantSnapshot,
  ResourceKind,
  Role,
  RoleContext,
  RoleError,
  RoleGrant,
  RoleModes,
  RolesOptions,
  SetGrantsOptions,
  SetGrantsResult,
} from "./types.js";
