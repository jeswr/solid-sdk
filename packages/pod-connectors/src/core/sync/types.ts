// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import type { RunLimits } from "../budget.js";
import type {
  ConnectorStateOptions,
  ImportContext,
  ImportOutcome,
  ImportProgress,
  IntegrationAdapter,
  NormalisedDoc,
  PodWriter,
  SourceAuth,
} from "../types.js";

export type ConflictPolicy = "lww" | "manual" | "remote-wins" | "pod-wins";
export interface SyncConnection {
  /** One opaque, path-safe account key; all sync data stays beneath it. */
  readonly account: string;
  readonly writeBack?: boolean;
  readonly conflictPolicy?: ConflictPolicy;
  readonly propagateDeletes?: boolean;
  readonly skewGuardMs?: number;
}
export interface SyncResource {
  readonly url: string;
  readonly dataset: DatasetCore;
  readonly etag: string;
  readonly lastModified?: string;
  readonly remoteId?: string;
}
export interface RemoteResult {
  readonly remoteId: string;
  readonly remoteVersion: string;
}
export interface RemoteItem extends RemoteResult {
  readonly document: NormalisedDoc;
  /** Provider server time, never a client clock. */
  readonly modifiedAt?: string;
}
export interface SyncImportContext extends ImportContext {
  readonly sync: {
    /** Resolve BEFORE mapping RDF subjects, so pod-created items retain their URLs. */
    resolve(remoteId: string, fallbackSlug: string): Promise<string>;
    /** Re-fetch these identities even when a provider delta omits echoes of our own writes. */
    pendingRemoteIds(): readonly string[];
    upsert(item: RemoteItem): Promise<void>;
    /** Only explicit provider tombstones; absence from a delta is never deletion. */
    delete(remoteId: string, remoteVersion: string): Promise<void>;
  };
}
export interface RemoteWriteOptions {
  readonly idempotencyKey?: string;
  readonly ifMatch?: string;
  readonly api: typeof fetch;
  readonly signal?: AbortSignal;
}
/** Opt-in extension. Mapped inbound resources MUST use ctx.sync, not ctx.write/remove. */
export interface TwoWayAdapter<Op = unknown> extends IntegrationAdapter {
  readonly fieldsForHash: readonly string[];
  /** Leaf container slugs relative to the connection account; no recursive discovery. */
  readonly writeBackContainers: readonly string[];
  readonly requiredWriteScopes: readonly string[];
  import(ctx: SyncImportContext): Promise<ImportOutcome>;
  toRemote(resource: SyncResource): Op | Promise<Op>;
  /** Creates must deduplicate the durable key; updates MUST enforce ifMatch. */
  applyRemote(op: Op, options: RemoteWriteOptions): Promise<RemoteResult>;
  findByIdempotencyKey(key: string, options: RemoteWriteOptions): Promise<RemoteResult | undefined>;
  /** Must enforce ifMatch; an already absent remote item is success. */
  deleteRemote(remoteId: string, options: RemoteWriteOptions): Promise<void>;
}
export interface SyncListingEntry {
  readonly url: string;
  readonly etag?: string | null;
}
export interface SyncPodWriter extends PodWriter {
  /** Finite, complete direct-child listing; errors MUST throw, never yield a partial success. */
  list(container: string): AsyncIterable<SyncListingEntry>;
  /** Install owner-only access BEFORE reading or creating sensitive document bodies. */
  ensureOwnerOnly(slug: string): Promise<void>;
}
export interface SyncNotificationSource {
  /** Drain queued hints; finite per run. Hints never replace complete listings. */
  changes(containers: readonly string[], signal?: AbortSignal): AsyncIterable<string>;
}
export interface SyncPorts extends ConnectorStateOptions {
  readonly podWriter: SyncPodWriter;
  readonly sourceAuth: SourceAuth;
  /** Explicit grants are required when writeBack is on, even for non-OAuth adapters. */
  readonly scopes?: readonly string[];
  readonly cursor?: string;
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly signal?: AbortSignal;
  readonly limits?: RunLimits;
  readonly maxResources?: number;
  readonly notifications?: SyncNotificationSource;
  readonly now?: () => Date;
}
export interface SyncConflict {
  readonly snapshotUrl: string;
  readonly remoteVersion: string;
  readonly resolution: "manual" | "remote" | "pod";
}
export interface SyncLink {
  readonly podUrl: string;
  readonly remoteId?: string;
  readonly remoteVersion?: string;
  readonly podEtag?: string;
  readonly lastSyncedHash?: string;
  /** A returned/recovered version still needs its first mapped inbound echo verified. */
  readonly needsInbound?: boolean;
  /** Persisted with the exact pre-call pod baseline, retained across crashes and aborts. */
  readonly pendingCreate?: {
    readonly key: string;
    readonly hash: string;
    readonly podEtag: string;
    /** Immutable original mapped resource, for retries after subsequent local edits. */
    readonly resourceUrl: string;
  };
  readonly conflict?: SyncConflict;
  readonly pendingDelete?: boolean;
  readonly status?: "remote-deleted" | "trashed" | "pod-deleted";
  readonly trashUrl?: string;
}
