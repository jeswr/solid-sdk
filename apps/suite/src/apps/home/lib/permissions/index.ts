// AUTHORED-BY Codex GPT-6.1-Sol

export { dpvPurposeLabel } from "@/shell/lib/dpv-labels";
export { aggregateHoldings, classifyAgent, modeLabel, roleForModes, roleLabel } from "./aggregate";
export { type ClientMetadata, isClientIdDocument, resolveClientName } from "./client";
export { readGrantRecords } from "./records";
export {
  AclConflictError,
  applyRevoke,
  LockoutError,
  PartialRevokeError,
  planRevoke,
  RestoreConflictError,
  type RestoreDelta,
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
