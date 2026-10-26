// AUTHORED-BY Codex GPT-6.1-Sol

export type UploadKind = "file" | "folder";
export type ConflictPolicy = "keep-both" | "replace" | "skip";

/** Decoded, relative path segments; never a URL or slash-delimited browser path. */
export type UploadPath = readonly string[];

export type DroppedEntry =
  | { readonly kind: "file"; readonly path: UploadPath; readonly size: number }
  | { readonly kind: "folder"; readonly path: UploadPath };

/** Complete flattened tree relative to the destination, including parent folders. */
export interface ExistingEntry {
  readonly kind: UploadKind;
  readonly path: UploadPath;
  readonly etag?: string;
}

/** Half-open byte range, compatible with Blob.slice(start, end). */
export interface UploadChunk {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export interface FolderChange {
  readonly path: UploadPath;
  /** Encoded relative path, including the trailing slash. */
  readonly targetPath: string;
  readonly action: "create" | "skip";
}

export interface PlannedFile {
  readonly sourcePath: UploadPath;
  readonly path: UploadPath;
  readonly targetPath: string;
  readonly targetUrl: string;
  readonly size: number;
  readonly chunks: readonly UploadChunk[];
  readonly operation:
    | { readonly action: "create"; readonly ifNoneMatch: "*" }
    | { readonly action: "replace"; readonly ifMatch: string }
    | { readonly action: "skip" };
}

export interface UploadPlanInput {
  readonly targetContainer: string;
  readonly entries: readonly DroppedEntry[];
  readonly existing: readonly ExistingEntry[];
  readonly policy: ConflictPolicy;
  readonly chunkSize: number;
}

export interface UploadPlan {
  /** Depth-first folders, all processed before files. */
  readonly folders: readonly (FolderChange & { readonly targetUrl: string })[];
  /** Files retain drop order; collisions reserve names within this plan. */
  readonly files: readonly PlannedFile[];
}
