// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import type { Mode, PodImplementation } from "../types.js";

/** Application roles, ordered by the permissions they require. */
export type Role = "viewer" | "commenter" | "editor" | "manager";
/** Resource semantics determine whether editing requires Write or Append. */
export type ResourceKind = "resource" | "folder" | "document" | "chatroom";
/** Protocol-neutral identity; app identities map to ACP client matchers. */
export type AgentRef =
  | { type: "webid"; id: string }
  | { type: "public" }
  | { type: "authenticated" }
  | { type: "group"; id: string }
  | { type: "app"; id: string };
/** One role and its governing access document. Inherited rows are read-only. */
export interface RoleGrant {
  agent: AgentRef;
  role: Role;
  expiresAt?: Date;
  purpose?: string;
  inherited: boolean;
  source: string;
}
declare const grantVersion: unique symbol;
/** Opaque JSON-serialisable read token. Preserve it verbatim; do not construct or parse it. */
export interface GrantSnapshot {
  readonly url: string;
  grants: RoleGrant[];
  readonly version: string & { readonly [grantVersion]: true };
}
/** Separate permission targets: resource body, comments container, and own ACR. */
export interface RoleModes {
  resource: readonly Mode[];
  comments: readonly Mode[];
  acr: readonly Mode[];
}
/** Mapping context; WAC is the default. */
export interface RoleContext {
  model?: "wac" | "acp";
  commentsContainer?: string;
}
/** All HTTP uses the caller's guarded, authenticated fetch. */
export interface RolesOptions extends RoleContext {
  fetch: typeof globalThis.fetch;
  kind?: ResourceKind;
  /** Bounds ancestor discovery. Defaults to the resource's origin root. */
  root?: string;
  /** Trusted server assertion. Defaults to CSS; NSS enables defaultForNew. */
  implementation?: PodImplementation;
}
/** Notification delivery is deferred to SDK-APP-07; these values are only recorded. */
export interface GrantMutationOptions extends RolesOptions {
  webId: string;
  notify?: boolean;
  message?: string;
}
/** Optional read-modify-write baseline; a version map must cover every selected URL. */
export interface SetGrantsOptions extends GrantMutationOptions {
  expected?: GrantSnapshot | Readonly<Record<string, GrantSnapshot["version"]>>;
}
/** A batch is not atomic. A failed URL may have earlier successful auxiliary writes. */
export interface SetGrantsResult {
  applied: string[];
  failed: { url: string; error: unknown }[];
  notification: { requested: boolean; message?: string; delivered: false };
}
/** Typed refusals without an exported mutable error prototype. */
export interface RoleError extends Error {
  code:
    | "comments-container-required"
    | "unsupported"
    | "invalid-response"
    | "scope"
    | "conflict"
    | "precondition-required"
    | "owner-lockout"
    | "inherited-grant";
  url: string;
  feature: "accessControl";
}
