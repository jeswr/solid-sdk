// AUTHORED-BY Codex GPT-6.1-Sol
export { aggregateHoldings, classifyAgent, modeLabel, roleForModes, roleLabel } from "./aggregate";
export { type ClientMetadata, resolveClientName } from "./client";
export { dpvPurposeLabel } from "./dpvLabels";
export { readGrantRecords } from "./records";
export {
  AclConflictError,
  applyRevoke,
  LockoutError,
  PartialRevokeError,
  planRevoke,
  type RevokeChange,
  type RevokePlan,
} from "./revoke";
export type {
  AgentKind,
  AgentRow,
  GrantRecord,
  GrantRecordIndex,
  ModeId,
  PermissionLine,
  PermissionResource,
  PermissionsSnapshot,
  RoleId,
  WalkedAccess,
} from "./types";
export { UnsupportedAccessError } from "./vocab";
export { type LoadPermissionsOptions, loadPermissions } from "./walk";
