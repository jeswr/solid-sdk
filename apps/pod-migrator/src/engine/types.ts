// AUTHORED-BY Codex GPT-6
export type AccessSystem = "wac" | "acp" | "unknown";
export interface PodHttp {
  readonly root: string;
  get(url: string, init?: { accept?: string; signal?: AbortSignal }): Promise<Response>;
  head(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
  put(
    url: string,
    body: Uint8Array | string,
    init: { contentType: string; ifNoneMatch?: "*"; ifMatch?: string; signal?: AbortSignal },
  ): Promise<Response>;
  delete(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
}
export interface PodSide {
  root: string;
  ownerWebId: string;
  http: PodHttp;
  /** Same pod fence over auth-core.publicFetch; never an authenticated fallback. */
  publicHttp?: PodHttp;
  /** Established by the caller independently of editable access RDF; never inferred from mode IRIs. */
  implementation?: "css" | "ess" | "nss";
}
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
export interface ReportOption {
  id: OptionId;
  label: string;
  description: string;
}
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
export interface PlannedResource {
  sourceUrl: string;
  targetUrl: string;
  kind: "container" | "resource";
  contentType?: string;
  size?: number;
}
export interface MigrationPlan {
  sourceSystem: AccessSystem;
  targetSystem: AccessSystem;
  resources: PlannedResource[];
  report: ReportItem[];
  stats: { containers: number; resources: number; bytes: number; aclDocuments: number };
}
export type Resolutions = Readonly<Record<string, OptionId>>;
export interface Progress {
  phase: "crawl" | "read-access" | "plan" | "lock" | "copy" | "grant" | "verify";
  done: number;
  total: number;
  current?: string;
}
export interface ExecutablePlan {
  readonly plan: MigrationPlan;
  readonly resolutions: Resolutions;
}
export interface MigrationResult {
  copied: string[];
  skipped: { url: string; reason: string }[];
  failed: { url: string; error: string }[];
  aclWritten: string[];
  verified: boolean;
  cancelled: boolean;
  log: { at: string; level: "info" | "warn" | "error"; message: string }[];
}
export class MigrationAborted extends Error {
  override name = "MigrationAborted";
}
export type Mode = "read" | "append" | "write" | "control";
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
export interface Grant {
  modes: Set<Mode>;
  who: Subject[][];
  except: Subject[];
  appliesTo: "resource" | "members" | "both";
  source: { url: string; node: string };
}
export type Denial = Grant;
export interface EffectivePolicy {
  grants: Grant[];
  denials: Denial[];
}
export interface AccessDocument {
  policy: EffectivePolicy;
  url: string;
  turtle: string;
  etag: string | null;
  inactiveGrants?: { node: string; reason: string }[];
}
