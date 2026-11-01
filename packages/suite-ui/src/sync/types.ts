// AUTHORED-BY Codex GPT-6.1-Sol
export type CapabilityKey =
  | "realtimeCollab"
  | "liveUpdates"
  | "serverSearch"
  | "accessRequests"
  | "versioning"
  | "trash"
  | "publicLinks"
  | "grantExpiry"
  | "grantPurpose"
  | "authenticatedAgentGrants"
  | "move"
  | "notifyAgents"
  | "selfRegistration";
export type Capabilities = Partial<Record<CapabilityKey, boolean>>;
export interface OutboxItem {
  id: string;
  label: string;
  where: string;
  queuedAt: Date;
  state: "pending" | "failed";
  error?: string;
}
export interface SyncConflict {
  id: string;
  name: string;
  where: string;
  summary: string;
  changedAt: Date;
}
export interface SyncSnapshot {
  online: boolean;
  reconnecting: boolean;
  pending: readonly OutboxItem[];
  conflicts: readonly SyncConflict[];
  lastSyncedAt?: Date;
}
export type SyncStatusKind = "hidden" | "offline" | "reconnecting" | "waiting" | "conflict";
