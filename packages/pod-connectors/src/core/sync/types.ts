// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
/**
 * Fixed reason classes for an item the runner skipped, deferred or could not process. Health
 * pages and the manifest carry only these classes, never raw provider text or tokens.
 */
export type SyncSkipReason =
  /** Adapter or vocabulary mapping (inbound document, outbound op) failed. */
  | "mapping-failed"
  /** Canonical hashing refused the document (size, term or blank-node caps). */
  | "hash-failed"
  /** Reading the pod resource failed. */
  | "read-failed"
  /** A pod write or link-store write failed (including a lost precondition). */
  | "write-failed"
  /** The provider call (applyRemote, key lookup, deleteRemote) failed. */
  | "remote-failed"
  /** The pod resource has no strong ETag. */
  | "weak-etag"
  /** A sub-container or non-RDF file in a write-back container. */
  | "unsupported-resource"
  /** An item imported by this connector without a link; never created at the provider. */
  | "unlinked-import"
  /** The provider identity is already linked to another pod resource. */
  | "duplicate-identity"
  /** The connection's hard link cap is reached; the item is not linked. */
  | "link-cap"
  /** Waiting on an unresolved create intent; retried next run. */
  | "deferred";
export interface SyncSkip {
  readonly direction: "inbound" | "outbound";
  readonly reason: SyncSkipReason;
  readonly remoteId?: string;
  readonly podUrl?: string;
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
  /**
   * The idempotency key the provider stored with this item (iCalendar UID, body marker, ...).
   * Inbound adopts the pending-create link carrying this key instead of minting a new resource.
   */
  readonly idempotencyKey?: string;
  /** Provider server time, never a client clock. */
  readonly modifiedAt?: string;
}
export interface SyncImportContext extends ImportContext {
  readonly sync: {
    /**
     * Resolve BEFORE mapping RDF subjects, so pod-created items retain their URLs. Returns the
     * linked pod URL, the pending-create URL carrying `idempotencyKey`, or the framework-owned
     * `<prefix>/<first 32 hex chars of sha-256(remoteId)>.ttl`. `prefix` is an account-qualified
     * write-back container slug such as `account/items`; adapters never build slugs from ids.
     */
    resolve(remoteId: string, prefix: string, idempotencyKey?: string): Promise<string>;
    /**
     * Identities to fetch even when a provider delta omits them: echoes of our own writes,
     * retained manual conflicts and previously failed or deferred inbound items.
     */
    pendingRemoteIds(): readonly string[];
    /** Item failures are recorded and retried next run; only run-level errors reject. */
    upsert(item: RemoteItem): Promise<void>;
    /** Only explicit provider tombstones; absence from a delta is never deletion. */
    delete(remoteId: string, remoteVersion: string): Promise<void>;
    /** Record an adapter-side mapping failure; the identity is retried on the next run. */
    fail(remoteId: string): void;
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
  /**
   * The adapter's mapped predicates: the fields the canonical hash covers AND the only quads an
   * inbound update replaces. Every other triple in a pod resource is preserved.
   */
  readonly fieldsForHash: readonly string[];
  /**
   * Whether applyRemote deduplicates a repeated create by `idempotencyKey` (default true).
   * A provider that cannot declares false; the framework then never re-sends an unconfirmed
   * create and defers it (and unlinked inbound items) until the key lookup finds it.
   */
  readonly deduplicatesCreateKeys?: boolean;
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
  /** The listing typed the member as a non-RDF source; it is skipped, never read. */
  readonly nonRdf?: boolean;
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
  /** Lower the hard per-connection link cap (MAX_SYNC_LINKS = 50,000). */
  readonly maxLinks?: number;
  readonly notifications?: SyncNotificationSource;
  readonly now?: () => Date;
}
export interface SyncConflict {
  readonly snapshotUrl: string;
  readonly remoteVersion: string;
  readonly resolution: "manual" | "remote" | "pod";
  /** A duplicate provider identity, recorded instead of a link identity. */
  readonly remoteId?: string;
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
  /** When a tombstone was recorded; tombstones are garbage-collected 30 days later. */
  readonly deletedAt?: string;
  /** Move in progress from this pod URL; recovery drops the old record. */
  readonly movedFrom?: string;
  readonly trashUrl?: string;
}
