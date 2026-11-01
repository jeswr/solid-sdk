// AUTHORED-BY Codex GPT-6.1-Sol
import type { AccessSystem, EffectivePolicy, Mode, Subject } from "@jeswr/pod-access";
import type { Classification } from "../model/domains";

export type AgentKind = "person" | "app" | "public" | "authenticated";
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
  system?: AccessSystem;
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
  inherited: boolean;
}
export interface AgentRow {
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
  inherited: boolean;
  inheritedFrom?: string;
  classification?: Classification;
  /** Metadata on authorization nodes, overridden by linked consent records. */
  records?: GrantRecordIndex;
}
