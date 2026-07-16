// AUTHORED-BY GPT-5.6 Sol via codex

import type { SyntheticRdfResult } from "@jeswr/synthetic-rdf";
import type { DatasetCore } from "@rdfjs/types";

/** A live pod reached only through the Fetch-compatible structural seam. */
export interface SeedTarget {
  webid: string;
  baseUrl: string;
  authFetch: typeof fetch;
}

/** Account lifecycle owner supplied by a harness, application, or browser pod. */
export interface AccountProvisioner {
  provisionAccount(webid?: string): Promise<SeedTarget>;
}

export interface PodLayout {
  pods: readonly PodSpec[];
}

export interface PodSpec {
  account: { target: SeedTarget } | { provision: { webid?: string } };
  resources: readonly (ResourceSpec | ResourceExpander)[];
}

export type ResourceExpander = (
  context: PodContext,
) => readonly ResourceSpec[] | Promise<readonly ResourceSpec[]>;

export interface ResourceSpec {
  path: string;
  source: DataSource;
  contentType?: string;
  access?: AccessSpec;
}

export type DataSource = { instance: InstanceRef } | { dataset: DatasetCore } | { body: string };

export interface InstanceRef {
  shape: string;
  index?: number;
}

export interface PodContext {
  webid: string;
  baseUrl: string;
  resolve(path: string): string;
  instances(shape: string): readonly import("@jeswr/synthetic-rdf").GeneratedInstance[];
}

export type AccessMode = "read" | "write" | "append" | "control";

export interface AccessSpec {
  publicRead?: boolean;
  agents?: readonly { webid: string; modes: readonly AccessMode[] }[];
}

export interface SeedOptions {
  layout: PodLayout;
  data?: SyntheticRdfResult;
  provisioner?: AccountProvisioner;
  mode?: "create" | "ensure" | "replace";
  /** Placeholder namespace used by synthetic-rdf. Defaults to `urn:synthetic:`. */
  placeholderBase?: string;
}

export interface SeedManifest {
  pods: readonly PodManifest[];
}

export interface PodManifest {
  webid: string;
  baseUrl: string;
  resources: readonly ResourceOutcome[];
  groups: readonly GroupOutcome[];
}

export interface ResourceOutcome {
  path: string;
  url: string;
  status: "created" | "skipped" | "replaced" | "failed" | "unwritten";
  group?: string;
}

export interface GroupOutcome {
  id: string;
  members: readonly string[];
  status: "written" | "skipped" | "partial";
}

/** A failed write or group preflight together with the state needed for repair. */
export class SeedError extends Error {
  readonly manifest: SeedManifest;

  constructor(message: string, manifest: SeedManifest, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SeedError";
    this.manifest = manifest;
  }
}
