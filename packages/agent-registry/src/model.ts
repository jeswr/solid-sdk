// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

/** Pod binding state. Inventory claims never establish a connected state. */
export type BindingState = "none" | "setup-required" | "connected" | "error" | "disabled";
/** Owner switches describe restrictions, never a mandate or provider grant. */
export interface Restrictions {
  read: boolean;
  triage: boolean;
  draft: boolean;
  send: boolean;
}
/** Deny every operation until the owner supplies independent authorisation. */
export const DENY_ALL: Readonly<Restrictions> = Object.freeze({
  read: false,
  triage: false,
  draft: false,
  send: false,
});
/** Conflict evidence contains hashes only; it never resolves competing identities. */
export interface IdentityConflict {
  kind: "identity-mismatch" | "provider-mismatch";
  handleHashes: string[];
}
/** Privacy-safe settings connection and RDF account view. No raw identifiers or free-text notes. */
export interface Account {
  id: string;
  channel: string;
  provider: string;
  organisation: string;
  channelHandles: string[];
  credentialRefs: string[];
  bindingState: BindingState;
  restrictions: Restrictions;
  identityConflicts: IdentityConflict[];
  inventory: {
    setupStatus: string;
    observedAt?: string;
    lastTested?: string;
  };
}
/** Read-only communication policy evidence ported from the pilot settings model. */
export interface WorkflowPolicy {
  defaultAllowed: string[];
  requiresCurrentInstruction: string[];
  requiresFreshExplicitInstruction: string[];
}
/** Account settings only; scheduling and hosted triage belong to other packages. */
export interface Settings {
  version: 1;
  connections: Account[];
  workflowPolicy: WorkflowPolicy | null;
}
/** Construct an empty, default-deny settings model. */
export function emptySettings(): Settings {
  return { version: 1, connections: [], workflowPolicy: null };
}
/** Coarse grouping retained from the pilot, including the Telegram control channel. */
export function channelGroup(channel: string): "email" | "chat" | "calendar" | "other" {
  if (channel === "email" || channel === "calendar") return channel;
  return [
    "slack",
    "whatsapp",
    "signal",
    "matrix",
    "matrix_bot",
    "microsoft_teams",
    "discord",
    "phone_messages",
    "telegram",
  ].includes(channel)
    ? "chat"
    : "other";
}
