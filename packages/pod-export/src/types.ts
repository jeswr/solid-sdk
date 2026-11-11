// AUTHORED-BY Codex GPT-6.1-Sol
export type ExportKind = "container" | "rdf" | "binary" | "acl" | "meta";
export interface ExportError {
  message: string;
  status?: number;
}
export interface ExportResource {
  url: string;
  kind: ExportKind;
  contentType: string;
  /** Resources advertising this auxiliary document, used when filtering a reused plan. */
  auxiliaryFor?: readonly string[];
  size?: number;
  error?: ExportError;
}
export interface ExportOptions {
  fetch: typeof globalThis.fetch;
  root: string;
  /** Relative paths or scoped URLs. A trailing slash selects the entire subtree. */
  include?: readonly string[];
  exclude?: readonly string[];
  signal?: AbortSignal;
  /** Maximum path depth below root, including auxiliary documents. Default 32. */
  maxDepth?: number;
  /** Maximum distinct resources, including root and auxiliary documents. Default 10,000. */
  maxEntries?: number;
}
export interface ExportPlan {
  root: string;
  resources: ExportResource[];
  estimatedBytes: number;
  unknownSizes: number;
}
export interface ExportEntry {
  url: string;
  path: string;
  contentType: string;
  bytes: number;
  kind: ExportKind;
  error?: ExportError;
}
export interface ExportManifest {
  exportedAt: string;
  root: string;
  entries: ExportEntry[];
}
export interface ExportProgress {
  files: number;
  totalFiles: number;
  bytes: number;
  estimatedBytes: number;
  current: string;
}
export interface ExportPodOptions extends ExportOptions {
  plan?: ExportPlan;
  concurrency?: number;
  onProgress?: (progress: ExportProgress) => void;
  /** Awaited between chunks for backpressure. Rejecting the sink fails the export. */
  sink: (chunk: Uint8Array) => void | Promise<void>;
}
