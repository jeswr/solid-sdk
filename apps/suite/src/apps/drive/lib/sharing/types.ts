// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";

export type SharingRole = "viewer" | "commenter" | "editor" | "owner";
export type AccessMode = "Read" | "Write" | "Append" | "Control";

/** Already resolved by the caller. WAC: nearest effective ACL only; ACP: own + ancestors. */
export interface AccessDocument {
  model: "wac" | "acp";
  dataset: DatasetCore;
  source: string;
  governingResource: string;
  inherited: boolean;
}
export interface ResourceAccess {
  resource: string;
  documents: readonly AccessDocument[];
}
export interface SharingInput {
  access: ResourceAccess;
  /** Required to distinguish a commenter from a viewer (SDK assumption A-11). */
  comments?: ResourceAccess;
}
export interface AccessOrigin {
  inherited: boolean;
  explicit: boolean;
  sources: string[];
}
export interface SharingPerson extends AccessOrigin {
  webId: string;
  role: SharingRole;
}
export interface SharingState {
  people: SharingPerson[];
  /** Anonymous access; a URL is not a secret capability. */
  link: "none" | "viewer" | "editor";
  /** Also viewer when the anonymous link grant includes Read. */
  public: "none" | "viewer";
  general: AccessOrigin;
}
export interface SharingSelection {
  people: readonly { webId: string; role: SharingRole }[];
  link: SharingState["link"];
  public: SharingState["public"];
}
/** Semantic mode delta for the persistence adapter, NOT a document replacement.
 * The adapter must split shared authorizations/policies and retain unrelated scopes,
 * defaults, metadata and principals. No operation edits an ancestor document.
 * For ACP, policy management is Read+Write on the ACR itself, not acl:Control.
 */
export interface AuthorizationChange {
  model: AccessDocument["model"];
  source: string;
  resource: string;
  principal: { kind: "webid"; webId: string } | { kind: "public" };
  add: AccessMode[];
  remove: AccessMode[];
  inherited: false;
}
