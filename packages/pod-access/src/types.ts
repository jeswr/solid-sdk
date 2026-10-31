// AUTHORED-BY Codex GPT-6.1-Sol
/** Detected access-control model; unknown requires caller handling. */
export type AccessSystem = "wac" | "acp" | "unknown";
/** Independently established server dialect; never infer this from editable RDF. */
export type PodImplementation = "css" | "ess" | "nss";
/** Existing migrator report categories, retained for consumer compatibility. */
export type ReportKind =
  | "group-unsupported"
  | "origin-unsupported"
  | "condition-unsupported"
  | "exclusion-unsupported"
  | "deny-unsupported"
  | "owner-mapped"
  | "source-owner-kept"
  | "inheritance-narrowed"
  | "acl-unreadable"
  | "acl-system-unknown"
  | "target-exists"
  | "protected-target"
  | "metadata-skipped"
  | "too-complex";
/** Existing migrator decision identifiers; the caller validates resolutions. */
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
/** A labeled migration decision and its explanation. */
export interface ReportOption {
  id: OptionId;
  label: string;
  description: string;
}
/** Stable, resource-scoped translation report with available narrowing decisions. */
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
/** Caller-selected options indexed by stable report item ID. */
export type Resolutions = Readonly<Record<string, OptionId>>;
/** Neutral access modes used by translation and symbolic proofs. */
export type Mode = "read" | "append" | "write" | "control";
/** A principal or condition atom; clauses conjoin atoms and rules disjoin clauses. */
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
/** A scoped conditional rule with source document provenance. */
export interface Grant {
  modes: Set<Mode>;
  who: Subject[][];
  except: Subject[];
  appliesTo: "resource" | "members" | "both";
  source: { url: string; node: string };
}
/** A restriction with the same condition and scope structure as a grant. */
export type Denial = Grant;
/** Neutral grants and denials, optionally recording explicit own ACP policies. */
export interface EffectivePolicy {
  grants: Grant[];
  denials: Denial[];
  /** An ACP document attached at least one policy that can apply to the resource itself. */
  explicit?: boolean;
}
/** A read access-control snapshot and its validator, supplied by the caller. */
export interface AccessDocument {
  policy: EffectivePolicy;
  url: string;
  turtle: string;
  etag: string | null;
  inactiveGrants?: { node: string; reason: string }[];
}
