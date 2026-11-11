// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type {
  AccessSystem,
  EffectivePolicy,
  Mode,
  PodImplementation,
  Subject,
} from "@jeswr/pod-access";
import type { DatasetCore } from "@rdfjs/types";
import type { Classification } from "../model/domains";

export type AgentKind = "person" | "group" | "app" | "public" | "authenticated";
export type RoleId = "viewer" | "commenter" | "editor" | "manager";
export type ModeId = Mode;
export interface PermissionResource {
  url: string;
  isContainer: boolean;
  modes: ModeId[];
  inherited: boolean;
  inheritedFrom?: string;
  source: string;
  node: string;
  /** Retained for safe writes, including origin-constrained WAC clauses. */
  subject?: Subject;
  /** Original policy conjunction retained for display and precise revocation. */
  clause?: Subject[];
  /** Canonical principal expression and modes for matching parser-local WAC nodes. */
  signature?: string;
  /** Original authorization graph, including metadata, for exact WAC matching. */
  authorization?: string;
  system?: AccessSystem;
  /** Trusted discovery dialect retained for WAC revoke revalidation. */
  implementation?: PodImplementation;
  scope?: "resource" | "members";
}
export interface PermissionLine {
  key: string;
  dataType: { id: string; label: string } | undefined;
  domainId: string;
  resources: PermissionResource[];
  role: RoleId;
  modes: ModeId[];
  expiresAt?: string;
  purpose?: { iri?: string; label: string };
  /** Conjunctive policy metadata; unknown condition enforcement never hides exposure. */
  conditions?: Subject[];
  conditionEnforcement?: "ignored" | "unknown";
  inherited: boolean;
}
export interface AgentRow {
  members?: string[];
  key: string;
  kind: AgentKind;
  id: string;
  name?: string;
  since?: string;
  lastChanged?: string;
  lines: PermissionLine[];
}
export interface PermissionsSnapshot {
  rows: AgentRow[];
  failures: { url: string; reason: "forbidden" | "not-found" | "unreadable" | "unsupported" }[];
  warnings?: { url: string; reason: "condition-enforcement-unknown"; conditions: Subject[] }[];
  truncated: boolean;
  summary: { apps: number; people: number; publicItems: number };
}
export interface GrantRecord {
  created?: string;
  modified?: string;
  expiresAt?: string;
  purpose?: { iri?: string; label: string };
  /** Approval snapshot fields used only for unambiguous metadata attribution. */
  agents?: string[];
  targets?: string[];
  modes?: ModeId[];
  grantRefs?: string[];
  purposeSource?: "receipt";
}
export type GrantRecordIndex = ReadonlyMap<string, GrantRecord>;
/** One resource and its nearest governing document, before display compaction. */
export interface WalkedAccess {
  url: string;
  isContainer: boolean;
  policy: EffectivePolicy;
  system: AccessSystem;
  /** Trusted caller assertion, never inferred from editable access-control RDF. */
  implementation?: PodImplementation;
  inherited: boolean;
  inheritedFrom?: string;
  classification?: Classification;
  /** Metadata on authorization nodes, overridden by linked consent records. */
  records?: GrantRecordIndex;
  /** Original ACL graph when available; retained only while aggregating. */
  dataset?: DatasetCore;
}
