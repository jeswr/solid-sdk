// AUTHORED-BY Codex GPT-6
/** Access-control language, independent of the server implementation. */
export type AccessSystem = "wac" | "acp" | "unknown";
/** Trusted server implementation established independently of editable RDF. */
export type PodImplementation = "css" | "ess" | "nss";
/** Stable report categories retained by policy translation and its migration callers. */
export type ReportKind =
  | "group-unsupported"
  | "origin-unsupported"
  | "condition-unsupported"
  | "exclusion-unsupported"
  | "deny-unsupported"
  | "owner-mapped"
  | "source-owner-kept"
  | "inheritance-narrowed"
  | "resource-unreadable"
  | "acl-unreadable"
  | "acl-system-unknown"
  | "target-exists"
  | "protected-target"
  | "metadata-skipped"
  | "too-complex";
/** Caller decisions; translation offers only safe narrowing alternatives. */
export type OptionId =
  | "skip"
  | "expand"
  | "owner-only"
  | "per-resource"
  | "overwrite"
  | "merge"
  | "drop-overlapping"
  | "abort"
  | "acknowledge";
/** A narrowing decision with human-readable label and consequence. */
export interface ReportOption {
  id: OptionId;
  label: string;
  description: string;
}
/** A policy limitation with provenance and explicit caller choices. */
export interface ReportItem {
  id: string;
  kind: ReportKind;
  severity: "info" | "needs-decision";
  resourceUrl: string;
  title: string;
  explanation: string;
  sourceRuleTurtle?: string;
  options: ReportOption[];
  recommended: OptionId;
}
/** Selections indexed by stable report item ID. */
export type Resolutions = Readonly<Record<string, OptionId>>;
/** Solid access mode; normalized reads include Append whenever Write is granted. */
export type Mode = "read" | "append" | "write" | "control";
/** One symbolic identity or condition in a grant conjunction. */
export type Subject =
  | { kind: "agent"; webId: string }
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "group"; group: string }
  | { kind: "creator" }
  | { kind: "owner" }
  | { kind: "client"; clientId: string }
  | { kind: "issuer"; issuer: string }
  | { kind: "vc"; vcType: string }
  | { kind: "origin"; origin: string };
/** A scoped disjunction of subject conjunctions, with exclusions and provenance. */
export interface Grant {
  modes: Set<Mode>;
  who: Subject[][];
  except: Subject[];
  appliesTo: "resource" | "members" | "both";
  source: { url: string; node: string };
}
/** A scoped rule that subtracts access using the same normal form as a grant. */
export type Denial = Grant;
/** Grant/denial normal form after parsing or effective-policy composition. */
export interface EffectivePolicy {
  grants: Grant[];
  denials: Denial[];
  /** An ACP document attached at least one policy that can apply to the resource itself. */
  explicit?: boolean;
}
/** Caller-supplied access representation, parsed policy, validator and provenance. */
export interface AccessDocument {
  policy: EffectivePolicy;
  url: string;
  turtle: string;
  etag: string | null;
  inactiveGrants?: { node: string; reason: string }[];
}
