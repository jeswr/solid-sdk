// AUTHORED-BY Claude Sonnet 5.5
import type { TypeIndex } from "@jeswr/pod-type-index";
import type { Features } from "@jeswr/storage-capabilities";
import type { StorageClient } from "@jeswr/storage-client";
import type { MediaStoreError, Result } from "./errors.js";
import type { ExposureCheck, ExposureState } from "./exposure.js";
import type { DeleteJournal } from "./journal.js";
import type { Sniffed, Sniffer } from "./sniff.js";

/** A serialised description document. A bare string is Turtle. */
export type SerializedDescription = string | { body: string; contentType: string };

/** Facts about the stored bytes, handed to `build` next to the caller's own input. */
export interface BuildContext {
  /** Lowercase hex SHA-256 of the binary. */
  readonly sha256: string;
  /** The sniffed type of the binary, never the declared one. */
  readonly contentType: string;
  readonly byteLength: number;
  readonly createdAt: Date;
  /** The URL the thumbnail create returned, when a thumbnail was supplied. */
  readonly thumbnailUrl: string | undefined;
}

/** Where a parsed description says its media lives. Both are checked against the library. */
export interface MediaLocation {
  readonly binaryUrl: string | undefined;
  readonly thumbnailUrl?: string | undefined;
}

export interface MediaStoreOptions<T, I> {
  /** Covers the discovery that `openMediaStore` performs. */
  signal?: AbortSignal;
  storage: StorageClient;
  features: Features;
  typeIndex: Pick<TypeIndex, "findAll" | "register">;
  /** Classes registered for the library container (the first is looked up first). */
  classes: readonly string[];
  /** Requested name for a brand-new library container (a hint on LWS). */
  defaultContainerName: string;
  /**
   * Parse one description. Return `undefined` for a document that is not this model's. The
   * store never looks inside the value; `locate` says where its media is.
   */
  parse(descriptionUrl: string, body: string, contentType: string): Promise<T | undefined>;
  /** Serialise a description for a document at `descriptionUrl` describing `binaryUrl`. */
  build(
    descriptionUrl: string,
    binaryUrl: string,
    input: I,
    context: BuildContext,
  ): Promise<SerializedDescription>;
  /** Read the media URLs out of a parsed value (also the "points at that binary" predicate). */
  locate(value: T): MediaLocation;
  /** Decide the real type of the bytes. Default: {@link defaultSniff}. */
  sniff?: Sniffer;
  /** Largest binary, in bytes. Default 50 MiB. */
  maxBytes?: number;
  /** Largest thumbnail, in bytes. Default 5 MiB. */
  maxThumbnailBytes?: number;
  /** Largest description document, in bytes. Default 1 MiB. */
  maxDescriptionBytes?: number;
  /** Description reads in flight during `list`. Default 4. */
  concurrency?: number;
  /** Attempts for `update` before it reports a conflict. Default 4. */
  updateAttempts?: number;
  /** Read-only exposure probe for the library container. See {@link ExposureCheck}. */
  exposure?: ExposureCheck;
  /** Also refuse `put` when the probe is inconclusive. Default false. */
  refuseUnknownExposure?: boolean;
  /** How long a "private" answer is reused, in milliseconds. Default 60 000. */
  exposureTtlMs?: number;
  /**
   * Optional dedupe lookup for servers that name resources themselves (LWS). Given a content
   * hash it returns a description the caller already knows. Without it, two puts of the same
   * bytes on LWS create two pairs: the store cannot find the first by name.
   */
  findByHash?: (
    sha256: string,
    signal?: AbortSignal,
  ) => Promise<{ descriptionUrl: string } | undefined>;
  /** Durable delete journal. Default: in-memory. */
  journal?: DeleteJournal;
  now?: () => number;
  /** Wait between polls of a description another writer is still filling. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Polls of a pending description before `put` gives up. Default 5. */
  pendingPolls?: number;
  /** Milliseconds between those polls. Default 100. */
  pendingDelayMs?: number;
}

export interface PutInput<I> {
  bytes: Blob | Uint8Array;
  /** Declared type. Not trusted: it must agree with the sniffed type or the put is refused. */
  contentType: string;
  /** Declared extension. Not trusted either; the sniffed extension names the resource. */
  extension: string;
  /** Creation time; its UTC month picks the shard. */
  createdAt: Date;
  /** Passed to `build`. */
  description: I;
  thumbnail?: { bytes: Blob | Uint8Array; contentType?: string };
  signal?: AbortSignal;
}

export interface PutOutcome {
  descriptionUrl: string;
  binaryUrl: string;
  thumbnailUrl: string | undefined;
  /** Lowercase hex SHA-256 of the binary. */
  sha256: string;
  /** True when every resource was already there and verified; nothing was written. */
  existed: boolean;
}

export interface MediaItem<T> {
  descriptionUrl: string;
  value: T;
  /** Always inside the library. */
  binaryUrl: string;
  /** Inside the library, otherwise undefined. */
  thumbnailUrl: string | undefined;
  etag: string | null;
  modified: Date | null;
}

export interface SkipCounts {
  /** Members that are not documents of this store (sub-containers, oversize unknowns). */
  foreign: number;
  /** Descriptions that failed to read or parse. */
  unparseable: number;
  /** Empty documents a writer is still filling. */
  pending: number;
  /** Members or media pointers outside the shard or library. */
  outOfScope: number;
}

export interface ListOptions {
  /** Opaque cursor from a previous page. */
  cursor?: string;
  /** Items per page, 1 to 200. Default 50. */
  limit?: number;
  signal?: AbortSignal;
}

export interface ListPage<T> {
  items: readonly MediaItem<T>[];
  /** Pass back as `cursor`, or null at the end. */
  next: string | null;
  skipped: SkipCounts;
}

/** What `mutate` sees: the current description exactly as stored. */
export interface Current {
  readonly url: string;
  readonly body: string;
  readonly contentType: string;
}

export interface ResumeSummary {
  completed: number;
  failed: number;
  rejected: number;
}

export interface MediaStore<T, I> {
  /** The library container URL, or null until one is found or created. */
  readonly library: string | null;
  /** True only for a URL strictly inside the library container tree. */
  isInsideLibrary(url: string): boolean;
  /** Probe whether the library (or, before it exists, the storage root) is readable by others. */
  checkExposure(signal?: AbortSignal): Promise<Result<ExposureState>>;
  put(input: PutInput<I>): Promise<Result<PutOutcome>>;
  list(options?: ListOptions): Promise<Result<ListPage<T>>>;
  get(descriptionUrl: string, signal?: AbortSignal): Promise<Result<MediaItem<T>>>;
  /**
   * Conditional edit. `mutate` gets the stored body and returns the new one (or `undefined` to
   * change nothing), so it can keep triples written by other apps. On a lost race it is called
   * again on the fresh body.
   */
  update(
    descriptionUrl: string,
    mutate: (current: Current) => Promise<SerializedDescription | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Result<MediaItem<T>>>;
  /** Two-step journalled delete: the description first, then the binary and thumbnail. */
  remove(descriptionUrl: string, signal?: AbortSignal): Promise<Result<void>>;
  /** Finish deletes recorded in the journal. */
  resumePending(signal?: AbortSignal): Promise<Result<ResumeSummary>>;
}

export type { MediaStoreError, Sniffed };
