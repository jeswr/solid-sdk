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
  /**
   * Read-only exposure probe, asked about the library container and about each shard before
   * anything is written into it. See {@link ExposureCheck}. Writes fail closed: an `exposed`
   * answer, an inconclusive one, a failure of the probe, any value other than the three
   * states, and a missing probe all refuse the write, unless `allowUnknownExposure` is set
   * (which lets the inconclusive cases through, never an `exposed` answer).
   */
  exposure?: ExposureCheck;
  /** Let writes proceed when exposure is unknown or unchecked. Default false. */
  allowUnknownExposure?: boolean;
  /** How long a "private" answer is reused for one container, in milliseconds. Default 60 000. */
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
  /** Stored next to the binary. Its own sniffed type must be an image. */
  thumbnail?: { bytes: Blob | Uint8Array };
  signal?: AbortSignal;
}

export interface PutOutcome {
  descriptionUrl: string;
  binaryUrl: string;
  /** The thumbnail the description actually links, otherwise undefined. */
  thumbnailUrl: string | undefined;
  /**
   * True when a thumbnail was supplied but the description (which already existed) does not
   * link one. Nothing was linked: call `attachThumbnail` to add it.
   */
  thumbnailMissing: boolean;
  /** Lowercase hex SHA-256 of the binary. */
  sha256: string;
  /** True when the description and the binary were already there and verified. */
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

/** What `attachThumbnail` needs: the image and the edit that links it. */
export interface AttachThumbnailInput {
  bytes: Blob | Uint8Array;
  /**
   * Like `update`'s `mutate`, plus the thumbnail's URL. The result must locate that URL as the
   * thumbnail and leave the binary alone.
   */
  mutate: (current: Current, thumbnailUrl: string) => Promise<SerializedDescription | undefined>;
  signal?: AbortSignal;
}

export interface SweepOptions {
  /** Only resources at least this old are touched. Default 24 hours. */
  minAgeMs?: number;
  signal?: AbortSignal;
}

export interface SweepSummary {
  /** Unreferenced media and abandoned empty descriptions that were removed. */
  deleted: number;
  /** Unreferenced media left because they are younger than `minAgeMs`. */
  retained: number;
  /** Shards left alone because a description in them could not be read or understood. */
  shardsSkipped: number;
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
  /** Store a thumbnail for an existing description and link it with a conditional edit. */
  attachThumbnail(
    descriptionUrl: string,
    input: AttachThumbnailInput,
  ): Promise<Result<MediaItem<T>>>;
  /**
   * Two-step journalled delete: the description first (conditional on its ETag), and only
   * once it is confirmed gone, the binary and thumbnail. A description that stays is never
   * left without its media.
   */
  remove(descriptionUrl: string, signal?: AbortSignal): Promise<Result<void>>;
  /** Finish deletes recorded in the journal, the description first. */
  resumePending(signal?: AbortSignal): Promise<Result<ResumeSummary>>;
  /**
   * Remove media no description references and empty descriptions a failed put left on LWS,
   * once they are old enough. A shard whose descriptions cannot all be read is left alone.
   */
  sweepOrphans(options?: SweepOptions): Promise<Result<SweepSummary>>;
}

export type { MediaStoreError, Sniffed };
