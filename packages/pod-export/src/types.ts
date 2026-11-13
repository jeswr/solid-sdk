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
export interface InventoryOptions extends ExportOptions {
  /** Fail closed on malformed members and require immediate children (migration). */
  directChildren?: boolean;
  /** Omit listed/advertised access metadata and its descendants. */
  skipAuxiliaries?: boolean;
  /** Propagate read errors instead of recording them on resources. */
  failFast?: boolean;
  /** Preserve migration's legacy Number-based HEAD estimates. */
  numericContentLength?: boolean;
  /** Custom semantic reader, e.g. migration's independent completeness checks. */
  readMembers?: (url: string) => Promise<Iterable<string>>;
  onHead?: (response: Response, url: string) => void;
  onSkipAuxiliary?: (url: string, advertised: boolean) => void;
  onProgress?: (progress: { done: number; total: number; current: string }) => void;
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
  /** The body ended before a complete representation was read. */
  partial?: boolean;
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
  /** Retained for compatibility; bodies and requests are processed sequentially. */
  concurrency?: number;
  onProgress?: (progress: ExportProgress) => void;
  /** Awaited between chunks for backpressure. Rejecting the sink fails the export. */
  sink: (chunk: Uint8Array) => void | Promise<void>;
  /** Rewrite already-delivered ZIP headers without changing output length. Without this,
   * streamed members keep conservative .partial names even after successful reads. */
  patch?: (offset: number, chunk: Uint8Array) => void | Promise<void>;
}
