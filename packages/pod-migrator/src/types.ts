// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { AccessSystem, ReportItem, Resolutions } from "@jeswr/pod-access";

export type {
  AccessDocument,
  AccessSystem,
  Denial,
  EffectivePolicy,
  Grant,
  Mode,
  OptionId,
  ReportItem,
  ReportKind,
  ReportOption,
  Resolutions,
  Subject,
} from "@jeswr/pod-access";
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
