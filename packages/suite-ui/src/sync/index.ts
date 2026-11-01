// AUTHORED-BY Codex GPT-6.1-Sol
export {
  CapabilityGate,
  type CapabilityGateProps,
  CapabilityProvider,
  useCapabilities,
  useRequiresOnline,
} from "./capability-gate.js";
export {
  ConflictDialog,
  type ConflictDialogProps,
  type ConflictStrategy,
} from "./conflict-dialog.js";
export { OfflinePill, type OfflinePillProps, SyncStatus } from "./offline-pill.js";
export { syncStatus } from "./status.js";
export { SyncSheet, type SyncSheetProps } from "./sync-sheet.js";
export type {
  Capabilities,
  CapabilityKey,
  OutboxItem,
  SyncConflict,
  SyncSnapshot,
  SyncStatusKind,
} from "./types.js";
