// AUTHORED-BY Codex GPT-6.1-Sol
import type { Features } from "@jeswr/storage-capabilities";
import type { AuthFetch, StorageClient } from "@jeswr/storage-client";

/** Capability keys that can gate an operation (`protocol` is not a feature). */
export type FeatureName = Exclude<keyof Features, "protocol">;

/** A running, isolated target. Fixed-owner targets must refuse a second identity. */
export interface RunningTarget {
  root: string;
  webId: string;
  fetch: AuthFetch;
  authFetchFor(webId: string): Promise<AuthFetch>;
  storage: StorageClient;
  /** Independent expectations; compare state and detail, ignoring explanatory evidence. */
  claims: Partial<Features>;
  /** Memory has no HTTP server; derive from its synthetic description instead. */
  resolveFeatures?(): Promise<Features>;
  stop(): Promise<void>;
}

/** Start once per suite; each scenario creates a fresh container. */
export interface ConformanceTarget {
  name: string;
  start(): Promise<RunningTarget>;
}

/** A probe returns whether the operation works, and must propagate unexpected failures. */
export type SupportProbe = (target: RunningTarget) => Promise<boolean>;

/** Shared scenarios run unchanged against every target. */
export interface ConformanceCase {
  id: string;
  requires: readonly FeatureName[];
  run(target: RunningTarget): Promise<void>;
  /** Required for every missing prerequisite; success without advertisement fails. */
  checks?: Partial<Record<FeatureName, SupportProbe>>;
}

/** Credential-free, stable report row. Reasons never include exception text or URLs. */
export interface ReportRow {
  test: string;
  status: "pass" | "fail" | "skip";
  feature: FeatureName | null;
  reason: string | null;
}

/** One JSON document per target. */
export interface TargetReport {
  target: string;
  results: ReportRow[];
}
