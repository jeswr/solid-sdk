// AUTHORED-BY Codex
/** Role mapping and conditional Solid sharing; the offline root API remains independent. */

export { grantsWithRoles, setGrants } from "./client.js";
export { isRoleError } from "./errors.js";
export { modesToRole, rolesToModes } from "./mapping.js";
export type {
  AgentRef,
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
