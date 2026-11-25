// AUTHORED-BY Claude Sonnet 5.5
import { displayNameOf, type Entry } from "@jeswr/storage-client";
import { isExactChildUrl, retryOnConflict } from "@jeswr/storage-client/helpers";
import { decodeCursor, encodeCursor, type ListPosition } from "./cursor.js";
import {
  abortable,
  fail,
  isStorageCode,
  MediaFailure,
  type MediaStoreError,
  type Result,
  run,
  throwIfAborted,
  toError,
} from "./errors.js";
import type { ExposureState } from "./exposure.js";
import {
  baseType,
  DESCRIPTION_ACCEPT,
  DESCRIPTION_TYPES,
  loadSource,
  normaliseDescription,
  readBounded,
  type Source,
  sha256Hex,
} from "./io.js";
import { createMemoryJournal, type DeleteJournalEntry } from "./journal.js";
import {
  isInsideLibrary,
  isShardUrl,
  MONTH,
  segmentOf,
  shardChildOf,
  shardKeyOf,
  YEAR,
} from "./scope.js";
import { defaultSniff, SNIFF_BYTES, type Sniffed } from "./sniff.js";
import type {
  AttachThumbnailInput,
  Current,
  LibraryStatus,
  ListOptions,
  ListPage,
  MediaItem,
  MediaStore,
  MediaStoreOptions,
  PendingDelete,
  PutInput,
  PutOutcome,
  ResumeEntryResult,
  ResumeOptions,
  ResumeSummary,
  SerializedDescription,
  ShouldResume,
  SkipCounts,
  SweepOptions,
  SweepSummary,
  WithdrawResult,
} from "./types.js";

const MiB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_TAKEN = ["conflict", "precondition-failed"];
/** Media names this store creates on Solid: `<hash>.<ext>` and `<hash>-thumb.<ext>`. */
const OWN_MEDIA = /^[0-9a-f]{64}(?:-thumb)?\.[a-z0-9]{1,8}$/;
const MEDIA_TYPE = /^(?:image|audio|video|model)\//;
/** Where LWS shard titles hang: a link to the container itself, carrying the title. */
const TITLE_REL = "related";

interface Document {
  etag: string | null;
  contentType: string;
  text: string;
  byteLength: number;
  modified: Date | null;
}

type Loaded<T> =
  | { state: "ok"; item: MediaItem<T> }
  | { state: "pending" | "unparseable" | "outOfScope"; item?: undefined };

/** The caller's body (a Blob stays a Blob), its facts and what the sniffer said. */
interface Prepared {
  source: Source;
  sniffed: Sniffed;
  sha256: string;
  key: string;
  thumbnail: { source: Source; sniffed: Sniffed } | undefined;
}

interface Written {
  descriptionUrl: string;
  thumbnailUrl: string | undefined;
  existed: boolean;
  thumbnailMissing: boolean;
}

const present = (value: unknown): boolean => typeof value === "object" && value !== null;

function normaliseExtension(value: string): string {
  const lower = value.trim().toLowerCase().replace(/^\./, "");
  return lower === "jpeg" ? "jpg" : lower;
}

/** A sniffer's answer is untrusted too: it names the stored type and the resource's extension. */
const usable = (value: Sniffed | undefined): value is Sniffed =>
  value !== undefined &&
  /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value.contentType) &&
  /^\.[a-z0-9]{1,8}$/.test(value.extension);

const sameContainer = (a: string, b: string): boolean => {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withOrphans(
  cause: unknown,
  orphans: readonly string[],
  signal: AbortSignal | undefined,
): unknown {
  if (orphans.length === 0) return cause;
  const error = toError(cause, signal);
  return new MediaFailure(error.kind, error.reason, orphans);
}

/**
 * Open the store: validate the options and look the library up through the Type Index
 * (read-only; nothing is created or registered until the first `put`).
 */
export async function openMediaStore<T, I>(
  options: MediaStoreOptions<T, I>,
): Promise<Result<MediaStore<T, I>>> {
  const invalid = (): Result<MediaStore<T, I>> => ({
    ok: false,
    error: toError(fail("failed", "invalid-input"), undefined),
  });
  if (
    !present(options) ||
    !present(options.storage) ||
    !present(options.typeIndex) ||
    !present(options.features) ||
    !Array.isArray(options.classes)
  ) {
    return invalid();
  }
  const { storage, typeIndex, classes } = options;
  const name = options.defaultContainerName;
  const sniff = options.sniff ?? defaultSniff;
  const maxBytes = options.maxBytes ?? 50 * MiB;
  const maxThumbnailBytes = options.maxThumbnailBytes ?? 5 * MiB;
  const maxDescriptionBytes = options.maxDescriptionBytes ?? MiB;
  const concurrency = options.concurrency ?? 4;
  const updateAttempts = options.updateAttempts ?? 4;
  const exposureTtlMs = options.exposureTtlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const journal = options.journal ?? createMemoryJournal();
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (
    options.features.protocol !== storage.protocol ||
    classes.length === 0 ||
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    /[/\\?#\p{Cc}]/u.test(name) ||
    ![maxBytes, maxThumbnailBytes, maxDescriptionBytes, concurrency, updateAttempts].every(
      positive,
    ) ||
    !(Number.isFinite(exposureTtlMs) && exposureTtlMs >= 0)
  ) {
    return invalid();
  }

  let library: string | null = null;
  const children = new Map<string, string>();
  const privateUntil = new Map<string, number>();

  // ---- containment ---------------------------------------------------------------------
  // On Solid a URL's path says where it lives. On LWS identifiers are opaque and containment is
  // logical, so membership is proven by `parentOf` (the server's `up` link) or remembered from a
  // listing or create this store performed itself.
  const lws = storage.protocol === "lws";
  const verifiedShards = new Set<string>();
  const memberShard = new Map<string, string>();

  /** A listed or created child of `shardUrl` (a listing is authoritative on LWS). */
  const isMember = (shardUrl: string, url: string): boolean =>
    lws ? storage.isWithinStorage(url) && !/[?#]/.test(url) : isExactChildUrl(shardUrl, url);

  const remember = (shardUrl: string, ...urls: (string | undefined)[]): void => {
    if (!lws) return;
    for (const url of urls.filter((one): one is string => one !== undefined)) {
      memberShard.set(url, shardUrl);
    }
  };

  async function parentOf(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!storage.isWithinStorage(url) || /[?#]/.test(url)) return undefined;
    try {
      const parent = await abortable(signal, storage.parentOf(url));
      return parent ?? undefined;
    } catch (cause) {
      if (signal?.aborted || isStorageCode(cause, "network")) throw cause;
      return undefined;
    }
  }

  async function shardInLibrary(
    lib: string,
    shard: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (verifiedShards.has(shard)) return true;
    let inside: boolean;
    if (lws) {
      const year = await parentOf(shard, signal);
      inside = year !== undefined && (await parentOf(year, signal)) === lib;
    } else {
      inside = isShardUrl(lib, shard);
    }
    if (inside) verifiedShards.add(shard);
    return inside;
  }

  /** The shard container `url` is a direct member of, if that shard belongs to the library. */
  async function shardOfMember(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!lws) return shardChildOf(lib, url)?.shardUrl;
    const known = memberShard.get(url);
    if (known !== undefined) return known;
    const parent = await parentOf(url, signal);
    if (parent === undefined || !(await shardInLibrary(lib, parent, signal))) return undefined;
    memberShard.set(url, parent);
    return parent;
  }

  const requireUrl = (url: unknown): void => {
    if (typeof url !== "string") throw fail("failed", "invalid-input");
  };

  // ---- discovery and layout -------------------------------------------------------------

  // LWS identifiers are opaque and may carry no trailing slash.
  const isCandidate = (url: string): boolean =>
    (lws || url.endsWith("/")) &&
    url !== storage.root &&
    !/[?#]/.test(url) &&
    storage.isWithinStorage(url);

  /** The container carrying the default name first, then lexicographic order. */
  const preferNamed = (a: string, b: string): number =>
    Number(segmentOf(b) === name) - Number(segmentOf(a) === name) || a.localeCompare(b);

  async function discover(signal: AbortSignal | undefined): Promise<string | null> {
    const found = await abortable(signal, typeIndex.findAll([...classes]));
    for (const cls of classes) {
      const urls = (found.get(cls) ?? []).filter(isCandidate).sort(preferNamed);
      if (urls[0] !== undefined) {
        library = urls[0];
        return library;
      }
    }
    return null;
  }

  const noLibrary = (): never => {
    throw fail("not-found", "no-library");
  };

  async function resolveLibrary(signal: AbortSignal | undefined): Promise<string> {
    const url = library ?? (await discover(signal));
    return url ?? noLibrary();
  }

  /** A child container by name: its title on LWS, its URL segment on Solid. */
  async function findChild(
    parent: string,
    childName: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    for await (const entry of storage.listAll(parent, { signal })) {
      const label = lws ? displayNameOf(entry) : segmentOf(entry.url);
      if (entry.kind === "container" && label === childName && isMember(parent, entry.url)) {
        return entry.url;
      }
    }
    return undefined;
  }

  /** A server that picks its own identifiers needs the name stored as the container's title. */
  async function setTitle(
    url: string,
    title: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      const { etag } = await abortable(signal, storage.metadata(url));
      if (etag === null) throw fail("failed", "shard-title");
      await abortable(
        signal,
        storage.setMetadata(url, [{ op: "add", rel: TITLE_REL, href: url, title }], {
          ifMatch: etag,
        }),
      );
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw fail("failed", "shard-title");
    }
  }

  async function ensureChild(
    parent: string,
    childName: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const cacheKey = `${parent}\n${childName}`;
    const cached = children.get(cacheKey);
    if (cached !== undefined) return cached;
    let url = await findChild(parent, childName, signal);
    if (url === undefined) {
      try {
        url = (await storage.create(parent, null, { kind: "container", name: childName, signal }))
          .url;
      } catch (cause) {
        if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
        url = await findChild(parent, childName, signal);
        if (url === undefined) throw fail("failed", "name-unavailable");
      }
      if (lws && segmentOf(url) !== childName) await setTitle(url, childName, signal);
    }
    children.set(cacheKey, url);
    return url;
  }

  async function findOrCreateLibrary(signal: AbortSignal | undefined): Promise<string> {
    const known = library ?? (await discover(signal));
    if (known !== null) return known;
    let url: string;
    if (storage.protocol === "solid") {
      try {
        url = (await storage.create(storage.root, null, { kind: "container", name, signal })).url;
      } catch (cause) {
        if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
        const adopted = await findChild(storage.root, name, signal);
        if (adopted === undefined) throw fail("failed", "name-unavailable");
        url = adopted;
      }
      for (const cls of classes) {
        await abortable(signal, typeIndex.register(cls, { container: url }, { index: "private" }));
      }
    } else {
      // LWS declares the class when the resource is created, so the hint comes first.
      const links = [];
      for (const cls of classes) {
        const hint = await abortable(
          signal,
          typeIndex.register(cls, { container: storage.root }, { index: "private" }),
        );
        links.push(...(hint?.links ?? []));
      }
      url = (await storage.create(storage.root, null, { kind: "container", name, links, signal }))
        .url;
    }
    throwIfAborted(signal);
    library = url;
    return url;
  }

  // ---- exposure --------------------------------------------------------------------------

  /**
   * Ask the probe about one container. Only a clear answer is reported as one: a missing probe,
   * a probe that throws and any value but the three states are `failed`, which no override can
   * lift (the override is for a probe that says `unknown` itself, such as the LWS adapter).
   */
  async function exposureOf(
    target: string,
    signal: AbortSignal | undefined,
  ): Promise<ExposureState | "failed"> {
    const probe = options.exposure;
    if (probe === undefined) return "failed";
    let state: ExposureState | "failed";
    try {
      const answer = await abortable(signal, probe(target, signal));
      state =
        answer === "private" || answer === "exposed" || answer === "unknown" ? answer : "failed";
    } catch (cause) {
      if (signal?.aborted) throw cause;
      state = "failed";
    }
    if (state === "private") privateUntil.set(target, now() + exposureTtlMs);
    return state;
  }

  /**
   * The per-container override, asked fresh on every refusal for `target` (never cached, never
   * shared between containers). A throw, a rejection or any value but `true` is a no.
   */
  async function unknownAllowed(target: string, signal: AbortSignal | undefined): Promise<boolean> {
    const allow = options.allowUnknownExposureFor;
    if (typeof allow !== "function") return false;
    return (await safely(signal, () => abortable(signal, Promise.resolve(allow(target))))) === true;
  }

  /** Refuse a write into `target` unless it is known private (or `unknown` and allowed for it). */
  async function requireNotExposed(target: string, signal: AbortSignal | undefined): Promise<void> {
    if ((privateUntil.get(target) ?? 0) > now()) return;
    const state = await exposureOf(target, signal);
    if (state === "exposed") throw fail("exposed", "library-exposed");
    if (state === "failed" || (state === "unknown" && !(await unknownAllowed(target, signal)))) {
      throw fail("exposed", "exposure-unknown");
    }
  }

  /**
   * Locate or create the library without writing media, and report the probe's answer for it.
   * A library that does not exist yet is created only when the storage root is `private`, or
   * `unknown` and `allowUnknownExposureFor(root)` says `true`; an exposed or unprobeable root
   * leaves the pod untouched. Nothing here writes an access rule.
   */
  async function ensure(signal: AbortSignal | undefined): Promise<LibraryStatus> {
    const known = library ?? (await discover(signal));
    if (known !== null) {
      return { url: known, created: false, exposure: await reported(known, signal), probed: known };
    }
    const blocked = await creationBlock(signal);
    if (blocked === null) {
      const url = await findOrCreateLibrary(signal);
      return { url, created: true, exposure: await reported(url, signal), probed: url };
    }
    return {
      url: null,
      created: false,
      exposure: blocked === "failed" ? "unknown" : blocked,
      probed: storage.root,
    };
  }

  /**
   * Whether a missing library may be created: only under a storage root that probes `private`
   * (or `unknown` with `allowUnknownExposureFor(root)` true). `null` means yes; otherwise the
   * root's state that forbids it. A new container inherits its parent's access, so creating one
   * under an exposed or unprobeable root is itself a write the store must not make.
   */
  async function creationBlock(
    signal: AbortSignal | undefined,
  ): Promise<ExposureState | "failed" | null> {
    const root = storage.root;
    const state = await exposureOf(root, signal);
    const allowed =
      state === "private" || (state === "unknown" && (await unknownAllowed(root, signal)));
    return allowed ? null : state;
  }

  /** The probe's answer for a container, with a failed probe read as `unknown`. */
  async function reported(target: string, signal: AbortSignal | undefined): Promise<ExposureState> {
    const state = await exposureOf(target, signal);
    return state === "failed" ? "unknown" : state;
  }

  // ---- reading descriptions --------------------------------------------------------------

  async function readDocument(url: string, signal: AbortSignal | undefined): Promise<Document> {
    const result = await storage.read(url, { accept: DESCRIPTION_ACCEPT, signal });
    if (result.kind === "container") throw fail("failed", "not-a-document");
    const bytes = await readBounded(result, maxDescriptionBytes, () =>
      fail("too-large", "description-too-large"),
    );
    return {
      etag: result.etag,
      contentType: result.contentType ?? "text/turtle",
      text: new TextDecoder().decode(bytes),
      byteLength: bytes.byteLength,
      modified: result.lastModified,
    };
  }

  async function safely<R>(
    signal: AbortSignal | undefined,
    fn: () => Promise<R> | R,
  ): Promise<R | undefined> {
    try {
      return await fn();
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return undefined;
    }
  }

  async function interpret(
    lib: string,
    url: string,
    doc: Document,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    if (doc.byteLength === 0) return { state: "pending" };
    const value = await safely(signal, () => options.parse(url, doc.text, doc.contentType));
    if (value === undefined) return { state: "unparseable" };
    const where = await safely(signal, () => options.locate(value));
    if (where === undefined) return { state: "unparseable" };
    const binaryUrl = where.binaryUrl;
    if (binaryUrl === undefined || (await shardOfMember(lib, binaryUrl, signal)) === undefined) {
      return { state: "outOfScope" };
    }
    const thumbnailUrl =
      where.thumbnailUrl !== undefined &&
      (await shardOfMember(lib, where.thumbnailUrl, signal)) !== undefined
        ? where.thumbnailUrl
        : undefined;
    return {
      state: "ok",
      item: {
        descriptionUrl: url,
        value,
        binaryUrl,
        thumbnailUrl,
        etag: doc.etag,
        modified: doc.modified,
      },
    };
  }

  async function loadItem(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    return interpret(lib, url, await readDocument(url, signal), signal);
  }

  /** The reason a description that is not `ok` cannot be used. */
  const reasonOf = (state: "pending" | "unparseable" | "outOfScope") =>
    state === "pending"
      ? "description-pending"
      : state === "outOfScope"
        ? "out-of-scope"
        : "description-unparseable";

  // ---- put -------------------------------------------------------------------------------

  /** A thumbnail's bytes, size-bounded and sniffed: it must be a recognised image. */
  async function loadThumbnail(
    body: Blob | Uint8Array,
  ): Promise<{ source: Source; sniffed: Sniffed }> {
    const source = await loadSource(body, maxThumbnailBytes, SNIFF_BYTES, false);
    const sniffed = sniff(source.head);
    if (!usable(sniffed) || !sniffed.contentType.startsWith("image/")) {
      throw fail("unsupported", "unsniffable");
    }
    return { source, sniffed };
  }

  async function prepare(input: PutInput<I>): Promise<Prepared> {
    const source = await loadSource(input.bytes, maxBytes, SNIFF_BYTES, true);
    throwIfAborted(input.signal);
    const sniffed = sniff(source.head, { extension: input.extension });
    if (!usable(sniffed)) throw fail("unsupported", "unsniffable");
    if (
      baseType(input.contentType) !== sniffed.contentType ||
      normaliseExtension(input.extension) !== normaliseExtension(sniffed.extension)
    ) {
      throw fail("unsupported", "type-mismatch");
    }
    const key = shardKeyOf(input.createdAt);
    if (key === undefined) throw fail("failed", "invalid-input");
    const thumbnail =
      input.thumbnail === undefined ? undefined : await loadThumbnail(input.thumbnail.bytes);
    const sha256 = source.sha256 as string;
    throwIfAborted(input.signal);
    return { source, sniffed, sha256, key, thumbnail };
  }

  /** Hash the bytes behind `url`, reading at most `max`. */
  async function hashOf(
    url: string,
    max: number,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const result = await storage.read(url, { signal });
    const bytes = await readBounded(result, max, () => fail("too-large", "bytes-too-large"));
    return sha256Hex(bytes);
  }

  /**
   * Create `fileName`, or adopt what is already at that name once `verify` accepts it. The
   * name is exact on Solid, so the resource there is the one to verify; on LWS a taken name is
   * never reported (the server picks another).
   */
  async function createMedia(
    shardUrl: string,
    fileName: string,
    body: Blob,
    contentType: string,
    verify: (existing: string) => Promise<void>,
    signal: AbortSignal | undefined,
    created: string[],
  ): Promise<string> {
    try {
      const made = await storage.create(shardUrl, body, { name: fileName, contentType, signal });
      created.push(made.url);
      return made.url;
    } catch (cause) {
      if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
    }
    const existing = `${shardUrl}${fileName}`;
    try {
      await verify(existing);
    } catch (cause) {
      if (isStorageCode(cause, "not-found")) throw fail("conflict", "name-unavailable");
      throw cause;
    }
    return existing;
  }

  /** A binary already at its name must hash to the same bytes. */
  const verifyBinary =
    (hash: string, signal: AbortSignal | undefined) =>
    async (existing: string): Promise<void> => {
      if ((await hashOf(existing, maxBytes, signal)) !== hash) {
        throw fail("conflict", "hash-mismatch");
      }
    };

  /** A thumbnail already at its name must be a recognisable image. */
  const verifyThumbnail =
    (signal: AbortSignal | undefined) =>
    async (existing: string): Promise<void> => {
      const result = await storage.read(existing, { signal });
      const bytes = await readBounded(result, maxThumbnailBytes, () =>
        fail("too-large", "bytes-too-large"),
      );
      if (!sniff(bytes.subarray(0, SNIFF_BYTES))?.contentType.startsWith("image/")) {
        throw fail("conflict", "hash-mismatch");
      }
    };

  function createThumbnail(
    shardUrl: string,
    fileName: string,
    thumbnail: { source: Source; sniffed: Sniffed },
    signal: AbortSignal | undefined,
    created: string[],
  ): Promise<string> {
    return createMedia(
      shardUrl,
      `${fileName}${thumbnail.sniffed.extension}`,
      thumbnail.source.body,
      thumbnail.sniffed.contentType,
      verifyThumbnail(signal),
      signal,
      created,
    );
  }

  /** Build the description for a known URL and check it parses and points where it should. */
  async function buildChecked(
    url: string,
    binaryUrl: string,
    thumbnailUrl: string | undefined,
    input: PutInput<I>,
    prepared: Prepared,
  ): Promise<{ body: string; contentType: string }> {
    const { signal } = input;
    const built = normaliseDescription(
      await abortable(
        signal,
        options.build(url, binaryUrl, input.description, {
          sha256: prepared.sha256,
          contentType: prepared.sniffed.contentType,
          byteLength: prepared.source.size,
          createdAt: input.createdAt,
          thumbnailUrl,
        }),
      ),
      maxDescriptionBytes,
    );
    throwIfAborted(signal);
    const check = await safely(signal, () => options.parse(url, built.body, built.contentType));
    const where =
      check === undefined ? undefined : await safely(signal, () => options.locate(check));
    if (where?.binaryUrl !== binaryUrl || where.thumbnailUrl !== thumbnailUrl) {
      throw fail("failed", "description-invalid");
    }
    return built;
  }

  /** What is at a Solid description's exact name: nothing, an empty shell, or a description. */
  async function settle(
    lib: string,
    url: string,
    binaryUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<
    { state: "none" } | { state: "empty"; etag: string } | { state: "adopted"; item: MediaItem<T> }
  > {
    let doc: Document;
    try {
      doc = await readDocument(url, signal);
    } catch (cause) {
      if (isStorageCode(cause, "not-found")) return { state: "none" };
      throw cause;
    }
    const loaded = await interpret(lib, url, doc, signal);
    if (loaded.state === "ok") {
      if (loaded.item.binaryUrl !== binaryUrl) throw fail("conflict", "description-mismatch");
      return { state: "adopted", item: loaded.item };
    }
    if (loaded.state !== "pending") throw fail("conflict", "description-mismatch");
    if (doc.etag === null) throw fail("failed", "no-validator");
    return { state: "empty", etag: doc.etag };
  }

  /**
   * Solid honours exact names, so the description's URL is known before it exists: the whole
   * document is built first and created atomically at that name (`If-None-Match: *`). No empty
   * document is ever visible. A taken name is adopted when it points at our binary; an empty
   * shell left by another writer is taken over with a write conditional on its ETag.
   */
  async function writeSolid(
    lib: string,
    shardUrl: string,
    input: PutInput<I>,
    prepared: Prepared,
    binaryUrl: string,
    created: string[],
  ): Promise<Written> {
    const { signal } = input;
    const { sha256 } = prepared;
    const descriptionUrl = `${shardUrl}${sha256}`;
    let built: { body: string; contentType: string } | undefined;
    let thumbnailUrl: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const found = await settle(lib, descriptionUrl, binaryUrl, signal);
      if (found.state === "adopted") {
        return {
          descriptionUrl,
          thumbnailUrl: found.item.thumbnailUrl,
          existed: true,
          thumbnailMissing:
            prepared.thumbnail !== undefined && found.item.thumbnailUrl === undefined,
        };
      }
      if (built === undefined) {
        thumbnailUrl =
          prepared.thumbnail === undefined
            ? undefined
            : await createThumbnail(
                shardUrl,
                `${sha256}-thumb`,
                prepared.thumbnail,
                signal,
                created,
              );
        built = await buildChecked(descriptionUrl, binaryUrl, thumbnailUrl, input, prepared);
      }
      try {
        if (found.state === "none") {
          const made = await storage.create(shardUrl, built.body, {
            name: sha256,
            contentType: built.contentType,
            signal,
          });
          created.push(made.url);
          if (made.url !== descriptionUrl) throw fail("failed", "name-unavailable");
        } else {
          await storage.write(descriptionUrl, built.body, {
            contentType: built.contentType,
            ifMatch: found.etag,
            signal,
          });
        }
        return { descriptionUrl, thumbnailUrl, existed: false, thumbnailMissing: false };
      } catch (cause) {
        if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
      }
    }
    throw fail("conflict", "retries-exhausted");
  }

  /**
   * LWS picks the identifier, so the description has to exist before its body can name it. The
   * empty document is created, then filled with a write conditional on its own validator
   * (never `*`). If anything fails in between, `dropEmpty` removes the shell, and `sweepOrphans`
   * collects one that could not be removed.
   */
  async function writeLws(
    shardUrl: string,
    input: PutInput<I>,
    prepared: Prepared,
    binaryUrl: string,
    created: string[],
    shell: { url?: string },
  ): Promise<Written> {
    const { signal } = input;
    const { sha256 } = prepared;
    const thumbnailUrl =
      prepared.thumbnail === undefined
        ? undefined
        : await createThumbnail(shardUrl, `${sha256}-thumb`, prepared.thumbnail, signal, created);
    const made = await storage.create(shardUrl, "", {
      name: sha256,
      contentType: "text/turtle",
      signal,
    });
    created.push(made.url);
    shell.url = made.url;
    const built = await buildChecked(made.url, binaryUrl, thumbnailUrl, input, prepared);
    const etag = made.etag ?? (await storage.head(made.url, { signal })).etag;
    if (etag === null) throw fail("failed", "no-validator");
    await storage.write(made.url, built.body, {
      contentType: built.contentType,
      ifMatch: etag,
      signal,
    });
    return { descriptionUrl: made.url, thumbnailUrl, existed: false, thumbnailMissing: false };
  }

  /** Delete an empty document on the validator observed now; true if it is gone. */
  async function dropEmpty(url: string): Promise<boolean> {
    try {
      const doc = await readDocument(url, undefined);
      if (doc.byteLength !== 0 || doc.etag === null) return false;
      await storage.delete(url, { ifMatch: doc.etag });
      return true;
    } catch (cause) {
      return isStorageCode(cause, "not-found");
    }
  }

  /** A description the caller's lookup named: usable only if its binary hashes to `sha256`. */
  async function lookup(
    sha256: string,
    wantsThumbnail: boolean,
    signal: AbortSignal | undefined,
  ): Promise<PutOutcome | undefined> {
    if (options.findByHash === undefined) return undefined;
    const hit = await options.findByHash(sha256, signal);
    throwIfAborted(signal);
    const descriptionUrl = hit?.descriptionUrl;
    if (typeof descriptionUrl !== "string") return undefined;
    // No library yet, or a hit outside it: a miss, never a failure.
    const found = library ?? (await discover(signal));
    const placed = found === null ? undefined : await shardOfMember(found, descriptionUrl, signal);
    return placed === undefined
      ? undefined
      : withCopy(descriptionUrl, signal, () =>
          adoptHit(found as string, descriptionUrl, sha256, wantsThumbnail, signal),
        );
  }

  /** Under the copy's lock: verify the hit and adopt it, withdrawing any pending delete. */
  async function adoptHit(
    lib: string,
    descriptionUrl: string,
    sha256: string,
    wantsThumbnail: boolean,
    signal: AbortSignal | undefined,
  ): Promise<PutOutcome | undefined> {
    let loaded: Loaded<T>;
    try {
      loaded = await loadItem(lib, descriptionUrl, signal);
    } catch (cause) {
      if (isStorageCode(cause, "not-found")) return undefined;
      throw cause;
    }
    if (loaded.state !== "ok") throw fail("conflict", "description-mismatch");
    if ((await hashOf(loaded.item.binaryUrl, maxBytes, signal)) !== sha256) {
      throw fail("conflict", "hash-mismatch");
    }
    // The copy is in use again: a pending delete of it must not outlive this adoption.
    await journalled(() => journal.delete(descriptionUrl));
    return {
      descriptionUrl,
      binaryUrl: loaded.item.binaryUrl,
      thumbnailUrl: loaded.item.thumbnailUrl,
      thumbnailMissing: wantsThumbnail && loaded.item.thumbnailUrl === undefined,
      sha256,
      existed: true,
    };
  }

  async function put(input: PutInput<I>): Promise<PutOutcome> {
    if (!present(input)) throw fail("failed", "invalid-input");
    const { signal } = input;
    const prepared = await prepare(input);
    const { sha256 } = prepared;
    const known = await lookup(sha256, prepared.thumbnail !== undefined, signal);
    if (known !== undefined) return known;
    const lib = await findOrCreateLibrary(signal);
    await requireNotExposed(lib, signal);
    const [year, month] = prepared.key.split("/") as [string, string];
    const shardUrl = await ensureChild(await ensureChild(lib, year, signal), month, signal);
    await requireNotExposed(shardUrl, signal);
    verifiedShards.add(shardUrl);
    // On LWS the server names a new pair, so nobody else can be deleting it. On Solid the copy
    // is `<shard>/<hash>`: serialise with any remove or resume of it.
    const attempt = async (): Promise<PutOutcome> => {
      const created: string[] = [];
      const shell: { url?: string } = {};
      // Solid: the copy's URL is known now, so withdraw any pending delete BEFORE any write. A
      // journal that cannot answer is remembered: an adopted copy then fails closed (a pending
      // delete may exist), a freshly created one succeeds (nothing was written before).
      let journalDown = false;
      if (!lws) {
        try {
          await journal.delete(`${shardUrl}${sha256}`);
        } catch {
          journalDown = true;
        }
      }
      let outcome: PutOutcome;
      try {
        const binaryUrl = await createMedia(
          shardUrl,
          `${sha256}${prepared.sniffed.extension}`,
          prepared.source.body,
          prepared.sniffed.contentType,
          verifyBinary(sha256, signal),
          signal,
          created,
        );
        const written = lws
          ? await writeLws(shardUrl, input, prepared, binaryUrl, created, shell)
          : await writeSolid(lib, shardUrl, input, prepared, binaryUrl, created);
        remember(shardUrl, written.descriptionUrl, binaryUrl, written.thumbnailUrl);
        outcome = {
          descriptionUrl: written.descriptionUrl,
          binaryUrl,
          thumbnailUrl: written.thumbnailUrl,
          thumbnailMissing: written.thumbnailMissing,
          sha256,
          existed: written.existed && !created.includes(binaryUrl),
        };
      } catch (cause) {
        // Nothing is deleted by guesswork: media are named by their content, so a retry adopts
        // them and `sweepOrphans` removes any that never gain a description. Only an empty shell
        // this call made is removed, because nothing else can have written into it.
        const left =
          shell.url !== undefined && (await dropEmpty(shell.url))
            ? created.filter((url) => url !== shell.url)
            : created;
        throw withOrphans(cause, left, signal);
      }
      // Nothing was left half-done, so there are no orphans to report for this failure.
      if (journalDown && outcome.existed) throw fail("failed", "journal");
      return outcome;
    };
    return lws ? attempt() : withCopy(`${shardUrl}${sha256}`, signal, attempt);
  }

  // ---- per-copy serialisation ----------------------------------------------------------
  // Copies are named by content, so several records can share one. Everything that creates,
  // adopts, edits, deletes or resumes the deletion of one copy (keyed by its canonical
  // description URL) runs one at a time inside this store, so a `remove` and a `put` of the
  // same bytes cannot interleave into a description without its binary (or the reverse).
  // The lock is per store instance; a request that hangs holds its copy until it settles or
  // its caller aborts (waiting callers can abort and leave the queue).
  // On LWS the server names a new pair, so a created pair is unlocked by design: it assumes a
  // server never reuses the identifier of a deleted resource for a different one.
  const copyLocks = new Map<string, Promise<void>>();
  const vetoing = new Set<string>();
  const canonical = (url: string): string => {
    try {
      return new URL(url).href;
    } catch {
      return url;
    }
  };

  async function withCopy<R>(
    descriptionUrl: string,
    signal: AbortSignal | undefined,
    fn: () => Promise<R>,
  ): Promise<R> {
    const key = canonical(descriptionUrl);
    // A veto that calls back into the store for its own copy would wait for itself.
    if (vetoing.has(key)) throw fail("conflict", "reentrant");
    const previous = copyLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine);
    copyLocks.set(key, tail);
    // The entry goes only when the whole chain has drained, never when one waiter gives up.
    void tail.then(() => {
      if (copyLocks.get(key) === tail) copyLocks.delete(key);
    });
    try {
      await abortable(signal, previous);
      return await fn();
    } finally {
      release();
    }
  }

  // ---- list and get ----------------------------------------------------------------------

  const emptySkips = (): SkipCounts => ({ foreign: 0, unparseable: 0, pending: 0, outOfScope: 0 });
  const modifiedAt = (entry: Entry): number => entry.modified?.getTime() ?? 0;
  const newestFirst = (a: Entry, b: Entry): number =>
    modifiedAt(b) - modifiedAt(a) || a.url.localeCompare(b.url);

  /** Could this listing entry be a description? Unknown types count while they are small. */
  const isCandidateEntry = (entry: Entry): boolean =>
    entry.kind === "resource" &&
    (entry.contentType === null
      ? (entry.size ?? 0) <= maxDescriptionBytes
      : DESCRIPTION_TYPES.has(baseType(entry.contentType)));

  interface Shard {
    key: string;
    url: string;
  }

  /** Shard containers, newest month first (equal labels by URL), from `from` onwards. */
  async function collectShards(
    lib: string,
    from: { shard: string; shardUrl: string } | undefined,
    signal: AbortSignal | undefined,
    skipped: SkipCounts,
  ): Promise<Shard[]> {
    const named = async (parent: string, pattern: RegExp) => {
      const out: { label: string; url: string }[] = [];
      for await (const entry of storage.listAll(parent, { signal })) {
        const label = lws ? displayNameOf(entry) : segmentOf(entry.url);
        if (entry.kind === "container" && pattern.test(label) && isMember(parent, entry.url)) {
          out.push({ label, url: entry.url });
        } else {
          skipped.foreign++;
        }
      }
      return out;
    };
    const all: Shard[] = [];
    for (const year of await named(lib, YEAR)) {
      if (from !== undefined && year.label > from.shard.slice(0, 4)) continue;
      for (const month of await named(year.url, MONTH)) {
        all.push({ key: `${year.label}/${month.label}`, url: month.url });
      }
    }
    // Two containers may carry one label on LWS (a POST never conflicts): the URL breaks ties,
    // so a cursor naming one of them resumes in the right place.
    all.sort((a, b) => b.key.localeCompare(a.key) || a.url.localeCompare(b.url));
    const shards = all.filter(
      (shard) =>
        from === undefined ||
        !(shard.key > from.shard || (shard.key === from.shard && shard.url < from.shardUrl)),
    );
    for (const shard of shards) verifiedShards.add(shard.url);
    return shards;
  }

  async function list(opts: ListOptions): Promise<ListPage<T>> {
    const { signal } = opts;
    const limit = opts.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw fail("failed", "invalid-input");
    const position = opts.cursor === undefined ? undefined : decodeCursor(opts.cursor);
    const skipped = emptySkips();
    const items: MediaItem<T>[] = [];
    const found = library ?? (await discover(signal));
    const walk = async (lib: string): Promise<ListPage<T>> => {
      const shards = await collectShards(lib, position, signal, skipped);
      for (const [at, shard] of shards.entries()) {
        const resume: ListPosition | undefined =
          position?.shard === shard.key && position.shardUrl === shard.url ? position : undefined;
        let page: string | null = resume?.page ?? null;
        let offset = resume?.offset ?? 0;
        if (page !== null && !sameContainer(page, shard.url)) {
          throw fail("failed", "invalid-cursor");
        }
        for (;;) {
          const listing = await storage.list(shard.url, {
            ...(page === null ? {} : { cursor: { url: page } }),
            signal,
          });
          const candidates: Entry[] = [];
          for (const entry of listing.items) {
            if (!isMember(shard.url, entry.url)) skipped.outOfScope++;
            else if (isCandidateEntry(entry)) {
              remember(shard.url, entry.url);
              candidates.push(entry);
            } else if (entry.kind !== "resource" || entry.contentType === null) skipped.foreign++;
          }
          candidates.sort(newestFirst);
          let index = offset;
          while (index < candidates.length) {
            const chunk = candidates.slice(index, index + concurrency);
            const loaded = await Promise.all(
              chunk.map((entry) => loadMember(lib, entry.url, signal)),
            );
            for (const result of loaded) {
              index++;
              if (result.state === "ok") items.push(result.item);
              else skipped[result.state]++;
              if (items.length >= limit) break;
            }
            if (items.length >= limit) break;
          }
          const nextPage = listing.next?.url ?? null;
          if (items.length >= limit) {
            const resumeAt = (target: Shard, at: string | null, from: number) =>
              encodeCursor({ shard: target.key, shardUrl: target.url, page: at, offset: from });
            if (index < candidates.length || nextPage !== null) {
              return { items, next: resumeAt(shard, page, index), skipped };
            }
            const following = shards[at + 1];
            return {
              items,
              next: following === undefined ? null : resumeAt(following, null, 0),
              skipped,
            };
          }
          if (nextPage === null) break;
          page = nextPage;
          offset = 0;
        }
      }
      return { items, next: null, skipped };
    };
    return found === null ? { items, next: null, skipped } : walk(found);
  }

  /** One member's outcome; a bad member is skipped, a transport failure fails the page. */
  async function loadMember(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    try {
      return await loadItem(lib, url, signal);
    } catch (cause) {
      if (signal?.aborted || isStorageCode(cause, "network")) throw cause;
      return { state: "unparseable" };
    }
  }

  /** The shard of a member of this library, or a not-found failure. */
  async function memberOrFail(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const shardUrl = await shardOfMember(lib, url, signal);
    if (shardUrl === undefined) throw fail("not-found", "out-of-scope");
    return shardUrl;
  }

  async function get(url: string, signal: AbortSignal | undefined): Promise<MediaItem<T>> {
    requireUrl(url);
    const lib = await resolveLibrary(signal);
    await memberOrFail(lib, url, signal);
    const loaded = await loadItem(lib, url, signal);
    if (loaded.state === "ok") return loaded.item;
    throw fail("failed", reasonOf(loaded.state));
  }

  // ---- update ----------------------------------------------------------------------------

  /**
   * Conditional edit of one description. `accept` sees the item before and after and decides
   * whether the edit may stand; the write is on the ETag the edit was computed from.
   */
  async function edit(
    lib: string,
    url: string,
    mutate: (current: Current) => Promise<SerializedDescription | undefined>,
    accept: (before: MediaItem<T>, after: MediaItem<T>) => boolean,
    signal: AbortSignal | undefined,
  ): Promise<MediaItem<T>> {
    let snapshot: Document | undefined;
    const attempt = async (etag: string | null): Promise<MediaItem<T>> => {
      const doc = snapshot as Document;
      if (etag === null) throw fail("failed", "no-validator");
      const before = await interpret(lib, url, doc, signal);
      if (before.state !== "ok") throw fail("failed", reasonOf(before.state));
      const output = await mutate({ url, body: doc.text, contentType: doc.contentType });
      if (output === undefined) return before.item;
      const next = normaliseDescription(output, maxDescriptionBytes);
      const after = await interpret(
        lib,
        url,
        { ...doc, text: next.body, contentType: next.contentType, byteLength: next.body.length },
        signal,
      );
      if (after.state !== "ok" || !accept(before.item, after.item)) {
        throw fail("failed", "description-invalid");
      }
      throwIfAborted(signal);
      const written = await storage.write(url, next.body, {
        contentType: next.contentType,
        ifMatch: etag,
        signal,
      });
      if (written.created) {
        // CSS 7 answers `If-Match: "<etag>"` on a resource that no longer exists with a create
        // (201), not a 412. The description was deleted after it was read: the write brought it
        // back, possibly beside media a `remove` is deleting. Take it down again (only if it is
        // still the version just written) and report the item as gone.
        const validator = written.etag;
        if (validator !== null) {
          await safely(signal, () => storage.delete(url, { ifMatch: validator, signal }));
        }
        throw fail("not-found", "storage");
      }
      return { ...after.item, etag: written.etag, modified: null };
    };
    try {
      return await retryOnConflict(
        attempt,
        async () => {
          snapshot = await readDocument(url, signal);
          return { etag: snapshot.etag };
        },
        updateAttempts,
      );
    } catch (cause) {
      if (isStorageCode(cause, "precondition-failed")) throw fail("conflict", "retries-exhausted");
      throw cause;
    }
  }

  async function update(
    url: string,
    mutate: (current: Current) => Promise<SerializedDescription | undefined>,
    signal: AbortSignal | undefined,
  ): Promise<MediaItem<T>> {
    requireUrl(url);
    const key = canonical(url);
    return withCopy(key, signal, () => updateLocked(key, mutate, signal));
  }

  async function updateLocked(
    url: string,
    mutate: (current: Current) => Promise<SerializedDescription | undefined>,
    signal: AbortSignal | undefined,
  ): Promise<MediaItem<T>> {
    const lib = await resolveLibrary(signal);
    await memberOrFail(lib, url, signal);
    // An edit may change everything but where the media are: repointing a description at
    // another item's binary would make a later `remove` delete it.
    return edit(
      lib,
      url,
      mutate,
      (before, after) =>
        after.binaryUrl === before.binaryUrl && after.thumbnailUrl === before.thumbnailUrl,
      signal,
    );
  }

  async function attachThumbnail(url: string, input: AttachThumbnailInput): Promise<MediaItem<T>> {
    if (!present(input)) throw fail("failed", "invalid-input");
    requireUrl(url);
    const key = canonical(url);
    return withCopy(key, input.signal, () => attachThumbnailLocked(key, input));
  }

  async function attachThumbnailLocked(
    url: string,
    input: AttachThumbnailInput,
  ): Promise<MediaItem<T>> {
    const { signal } = input;
    const lib = await resolveLibrary(signal);
    const shardUrl = await memberOrFail(lib, url, signal);
    const current = await loadItem(lib, url, signal);
    if (current.state !== "ok") throw fail("failed", reasonOf(current.state));
    if (current.item.thumbnailUrl !== undefined) return current.item;
    const thumbnail = await loadThumbnail(input.bytes);
    await requireNotExposed(lib, signal);
    await requireNotExposed(shardUrl, signal);
    const created: string[] = [];
    try {
      const thumbnailUrl = await createThumbnail(
        shardUrl,
        `${segmentOf(url)}-thumb`,
        thumbnail,
        signal,
        created,
      );
      const item = await edit(
        lib,
        url,
        (existing) => input.mutate(existing, thumbnailUrl),
        (before, after) =>
          after.binaryUrl === before.binaryUrl && after.thumbnailUrl === thumbnailUrl,
        signal,
      );
      remember(shardUrl, thumbnailUrl);
      return item;
    } catch (cause) {
      throw withOrphans(cause, created, signal);
    }
  }

  // ---- remove ----------------------------------------------------------------------------

  /** Conditional delete: observe the ETag, delete on it, retry a lost race. Gone is done. */
  async function deleteGuarded(
    url: string,
    signal: AbortSignal | undefined,
    before?: Veto,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const head = await storage.head(url, { signal });
        // A description is never media, whatever name points at it.
        if (DESCRIPTION_TYPES.has(baseType(head.contentType ?? ""))) return;
        if (head.etag === null) throw fail("failed", "no-validator");
        await before?.();
        await storage.delete(url, { ifMatch: head.etag, signal });
        return;
      } catch (cause) {
        if (isStorageCode(cause, "not-found")) return;
        if (!isStorageCode(cause, "precondition-failed")) throw cause;
      }
    }
    throw fail("conflict", "retries-exhausted");
  }

  /** Called immediately before a destructive request; throws `Skipped` to stop. */
  type Veto = () => Promise<void>;

  class Skipped extends Error {
    constructor(
      readonly why: "vetoed" | "veto-error" | "withdrawn",
      /** Drop the journal entry too (the veto said `"withdraw"`). */
      readonly drop = false,
    ) {
      super(why);
    }
  }

  const journalled = async <R>(fn: () => Promise<R>): Promise<R> => {
    try {
      return await fn();
    } catch {
      throw fail("failed", "journal");
    }
  };

  /**
   * Step one: delete the description on the validator just read. It must still locate the
   * binary the journal recorded; a description that has changed hands is left alone.
   * Returns false for such a description.
   */
  async function removeDescription(
    lib: string,
    entry: DeleteJournalEntry,
    signal: AbortSignal | undefined,
    before?: Veto,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let doc: Document;
      try {
        doc = await readDocument(entry.descriptionUrl, signal);
      } catch (cause) {
        if (isStorageCode(cause, "not-found")) return true;
        throw cause;
      }
      const loaded = await interpret(lib, entry.descriptionUrl, doc, signal);
      if (loaded.state === "unparseable" || loaded.item?.binaryUrl !== entry.binaryUrl) {
        return false;
      }
      if (doc.etag === null) throw fail("failed", "no-validator");
      try {
        await before?.();
        await storage.delete(entry.descriptionUrl, { ifMatch: doc.etag, signal });
        return true;
      } catch (cause) {
        if (isStorageCode(cause, "not-found")) return true;
        if (!isStorageCode(cause, "precondition-failed")) throw cause;
      }
    }
    throw fail("conflict", "retries-exhausted");
  }

  /** May `target` be deleted as media of the item whose description is `entry`'s? */
  async function isOwnMedia(
    lib: string,
    entry: DeleteJournalEntry,
    target: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (target === entry.descriptionUrl) return false;
    if ((await shardOfMember(lib, target, signal)) !== entry.shardUrl) return false;
    // Solid names are ours: `<description name>[-thumb].<ext>` and nothing else.
    return (
      lws ||
      new RegExp(
        `^${escapeRegExp(segmentOf(entry.descriptionUrl))}(?:-thumb)?\\.[a-z0-9]{1,8}$`,
      ).test(segmentOf(target))
    );
  }

  /** Step two, only once the description is confirmed gone and has not been recreated. */
  async function removeMedia(
    lib: string,
    entry: DeleteJournalEntry,
    signal: AbortSignal | undefined,
    before?: Veto,
  ): Promise<void> {
    let recreated = true;
    try {
      await storage.head(entry.descriptionUrl, { signal });
    } catch (cause) {
      if (!isStorageCode(cause, "not-found")) throw cause;
      recreated = false;
    }
    if (!recreated) {
      for (const target of [entry.binaryUrl, entry.thumbnailUrl]) {
        if (target !== undefined && (await isOwnMedia(lib, entry, target, signal))) {
          await deleteGuarded(target, signal, before);
        }
      }
    }
    await journalled(() => journal.delete(entry.descriptionUrl));
  }

  async function remove(url: string, signal: AbortSignal | undefined): Promise<void> {
    requireUrl(url);
    const key = canonical(url);
    await withCopy(key, signal, () => removeLocked(key, signal));
  }

  async function removeLocked(url: string, signal: AbortSignal | undefined): Promise<void> {
    const lib = await resolveLibrary(signal);
    const shardUrl = await memberOrFail(lib, url, signal);
    const doc = await readDocument(url, signal);
    const loaded = await interpret(lib, url, doc, signal);
    if (loaded.state === "unparseable") throw fail("failed", "description-unparseable");
    const entry: DeleteJournalEntry = {
      descriptionUrl: url,
      shardUrl,
      phase: "intent",
      ...(loaded.item === undefined
        ? {}
        : {
            binaryUrl: loaded.item.binaryUrl,
            ...(loaded.item.thumbnailUrl === undefined
              ? {}
              : { thumbnailUrl: loaded.item.thumbnailUrl }),
          }),
    };
    await journalled(() => journal.put(entry));
    let gone: boolean;
    try {
      gone = await removeDescription(lib, entry, signal);
    } catch (cause) {
      // A definitive failure means the item stays, so the intent is withdrawn; being offline
      // or aborted leaves it for `resumePending`.
      if (!signal?.aborted && !isStorageCode(cause, "network")) {
        await journalled(() => journal.delete(url));
      }
      throw cause;
    }
    if (!gone) {
      await journalled(() => journal.delete(url));
      throw fail("conflict", "description-mismatch");
    }
    const deleted: DeleteJournalEntry = { ...entry, phase: "deleted" };
    await journalled(() => journal.put(deleted));
    await removeMedia(lib, deleted, signal);
  }

  const pendingView = (entry: DeleteJournalEntry): PendingDelete => {
    const name = segmentOf(entry.descriptionUrl);
    return Object.freeze({
      descriptionUrl: entry.descriptionUrl,
      shardUrl: entry.shardUrl,
      ...(entry.binaryUrl === undefined ? {} : { binaryUrl: entry.binaryUrl }),
      ...(entry.thumbnailUrl === undefined ? {} : { thumbnailUrl: entry.thumbnailUrl }),
      phase: entry.phase ?? "intent",
      ...(!lws && /^[0-9a-f]{64}$/.test(name) ? { sha256: name } : {}),
    });
  };

  const sameCopy = (a: string, b: string): boolean => canonical(a) === canonical(b);

  const currentEntry = async (descriptionUrl: string): Promise<DeleteJournalEntry | undefined> =>
    (await journalled(() => journal.list())).find((one) =>
      sameCopy(one.descriptionUrl, descriptionUrl),
    );

  /**
   * Run immediately before each destructive request of a resumed delete: the journal entry is
   * re-read (a withdrawal by anyone sharing the journal ends the entry), then the caller's veto
   * is asked. A throw or rejection is a `false`, and an abort stays an abort.
   */
  const vetoFor =
    (
      descriptionUrl: string,
      shouldResume: ShouldResume | undefined,
      signal: AbortSignal | undefined,
    ): Veto =>
    async () => {
      const current = await currentEntry(descriptionUrl);
      if (current === undefined) throw new Skipped("withdrawn");
      if (shouldResume === undefined) return;
      const view = pendingView(current);
      const key = canonical(descriptionUrl);
      let answer: unknown = false;
      let why: "vetoed" | "veto-error" = "vetoed";
      vetoing.add(key);
      try {
        answer = await abortable(signal, (async () => shouldResume(view))());
      } catch {
        why = "veto-error";
      } finally {
        vetoing.delete(key);
      }
      throwIfAborted(signal);
      if (answer === "withdraw") throw new Skipped("withdrawn", true);
      if (answer !== true) throw new Skipped(why);
    };

  async function resumePending(args: ResumeArgs): Promise<ResumeSummary> {
    const { signal, shouldResume } = args;
    const entries = await journalled(() => journal.list());
    const results: ResumeEntryResult[] = [];
    const summary: ResumeSummary = {
      completed: 0,
      failed: 0,
      rejected: 0,
      skipped: 0,
      entries: results,
    };
    const lib = library ?? (await discover(signal));
    for (const entry of entries) {
      throwIfAborted(signal);
      const outcome = await withCopy(entry.descriptionUrl, signal, () =>
        resumeEntry(lib, entry, signal, shouldResume),
      );
      summary[outcome.outcome]++;
      results.push({ descriptionUrl: entry.descriptionUrl, ...outcome });
    }
    return summary;
  }

  async function resumeEntry(
    lib: string | null,
    listed: DeleteJournalEntry,
    signal: AbortSignal | undefined,
    shouldResume: ShouldResume | undefined,
  ): Promise<Omit<ResumeEntryResult, "descriptionUrl">> {
    if (lib === null) return { outcome: "failed" };
    // The journal was listed before this entry's turn: a put may have adopted the copy and
    // withdrawn the intent since. Act only on what the journal holds now.
    const entry = await currentEntry(listed.descriptionUrl);
    if (entry === undefined) return { outcome: "skipped", reason: "withdrawn" };
    let ours: boolean;
    try {
      // A deleted description can no longer be placed on LWS; its media are placed one by one.
      ours =
        (await shardInLibrary(lib, entry.shardUrl, signal)) &&
        (entry.phase === "deleted" ||
          (await shardOfMember(lib, entry.descriptionUrl, signal)) === entry.shardUrl);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { outcome: "failed" };
    }
    if (!ours) {
      // Not ours: a stale or tampered record is dropped and never acted on.
      await journalled(() => journal.delete(entry.descriptionUrl));
      return { outcome: "rejected" };
    }
    const before = vetoFor(entry.descriptionUrl, shouldResume, signal);
    try {
      let working = entry;
      // The description first; media only after it is confirmed gone.
      if (entry.phase !== "deleted") {
        if (!(await removeDescription(lib, entry, signal, before))) {
          await journalled(() => journal.delete(entry.descriptionUrl));
          return { outcome: "rejected" };
        }
        // Past the point of no return: record it, so a later start (and LWS, where a deleted
        // description cannot be placed) still finishes or keeps the media.
        working = { ...entry, phase: "deleted" };
        // Unless somebody withdrew the entry while the description was going.
        if ((await currentEntry(entry.descriptionUrl)) === undefined) {
          return { outcome: "skipped", reason: "withdrawn" };
        }
        await journalled(() => journal.put(working));
      }
      await removeMedia(lib, working, signal, before);
      return { outcome: "completed" };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      if (cause instanceof Skipped) {
        if (cause.drop) await journalled(() => journal.delete(entry.descriptionUrl));
        return { outcome: "skipped", reason: cause.why };
      }
      return { outcome: "failed" };
    }
  }

  async function withdrawPending(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<WithdrawResult> {
    requireUrl(url);
    return withCopy(url, signal, async () => {
      const entry = await currentEntry(url);
      if (entry === undefined) return "none";
      let gone = entry.phase === "deleted";
      if (!gone && storage.isWithinStorage(entry.descriptionUrl)) {
        try {
          await storage.head(entry.descriptionUrl, { signal });
        } catch (cause) {
          if (!isStorageCode(cause, "not-found")) throw cause;
          gone = true;
        }
      }
      if (gone) {
        // Half-finished: nothing can save the copy now. Keep the record, as `deleted`, so the
        // leftover media are cleaned up (or the copy is repaired by a later put).
        if (entry.phase !== "deleted")
          await journalled(() => journal.put({ ...entry, phase: "deleted" }));
        return "incomplete";
      }
      await journalled(() => journal.delete(entry.descriptionUrl));
      return "withdrawn";
    });
  }

  interface ResumeArgs {
    signal?: AbortSignal;
    shouldResume?: ShouldResume;
    bad?: boolean;
  }

  const isSignal = (value: unknown): value is AbortSignal =>
    typeof value === "object" && value !== null && "aborted" in value;

  const resumeArgs = (arg: unknown): ResumeArgs => {
    if (arg === undefined || arg === null) return {};
    if (isSignal(arg)) return { signal: arg };
    if (typeof arg !== "object") return { bad: true };
    const { signal, shouldResume } = arg as ResumeOptions;
    if (
      (signal !== undefined && !isSignal(signal)) ||
      (shouldResume !== undefined && typeof shouldResume !== "function")
    ) {
      return { bad: true };
    }
    return { signal, shouldResume };
  };

  // ---- sweep -----------------------------------------------------------------------------

  /**
   * Delete one unreferenced medium under its copy's lock, after re-checking there: a put may
   * have adopted it since the listing, or a pending delete (possibly vetoed) may still name it.
   * True when it was deleted.
   */
  async function sweepMedia(
    lib: string,
    shardUrl: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    // On Solid the copy is `<shard>/<hash>`; LWS names are opaque, so the medium is its own key.
    const hash = /^[0-9a-f]{64}/.exec(segmentOf(url))?.[0];
    const copy = !lws && hash !== undefined ? `${shardUrl}${hash}` : url;
    return withCopy(copy, signal, async () => {
      const pending = await journalled(() => journal.list());
      if (pending.some((one) => one.binaryUrl === url || one.thumbnailUrl === url)) return false;
      if (copy !== url) {
        try {
          const loaded = await loadItem(lib, copy, signal);
          const named =
            loaded.state === "ok" ? [loaded.item.binaryUrl, loaded.item.thumbnailUrl] : undefined;
          // An empty or unreadable description may be mid-write; one naming the medium owns it.
          if (named === undefined || named.includes(url)) return false;
        } catch (cause) {
          if (!isStorageCode(cause, "not-found")) throw cause;
        }
      }
      await deleteGuarded(url, signal);
      return true;
    });
  }

  async function sweep(opts: SweepOptions): Promise<SweepSummary> {
    const { signal } = opts;
    const minAgeMs = opts.minAgeMs ?? DAY_MS;
    if (!(Number.isFinite(minAgeMs) && minAgeMs >= 0)) throw fail("failed", "invalid-input");
    const summary: SweepSummary = { deleted: 0, retained: 0, shardsSkipped: 0 };
    const lib = library ?? (await discover(signal));
    if (lib === null) return summary;
    const old = (entry: Entry): boolean =>
      entry.modified !== null && now() - entry.modified.getTime() >= minAgeMs;
    for (const shard of await collectShards(lib, undefined, signal, emptySkips())) {
      const referenced = new Set<string>();
      const shells: string[] = [];
      const media: Entry[] = [];
      let understood = true;
      for await (const entry of storage.listAll(shard.url, { signal })) {
        if (!isMember(shard.url, entry.url) || entry.kind !== "resource") continue;
        if (!isCandidateEntry(entry)) {
          // The hash-name pattern selects candidates on Solid whatever the content type (PLY and
          // SPZ are application/octet-stream). LWS names are the server's, so there the name
          // pattern (when the server kept ours) or a media content type selects.
          if (
            OWN_MEDIA.test(segmentOf(entry.url)) ||
            (lws &&
              (MEDIA_TYPE.test(entry.contentType ?? "") || OWN_MEDIA.test(entry.displayName ?? "")))
          ) {
            media.push(entry);
          }
          continue;
        }
        const loaded = await loadMember(lib, entry.url, signal);
        if (loaded.state === "ok") {
          referenced.add(loaded.item.binaryUrl);
          if (loaded.item.thumbnailUrl !== undefined) referenced.add(loaded.item.thumbnailUrl);
        } else if (loaded.state === "pending") {
          if (old(entry)) shells.push(entry.url);
        } else understood = false;
      }
      if (!understood) {
        summary.shardsSkipped++;
        continue;
      }
      for (const entry of media) {
        if (referenced.has(entry.url)) continue;
        if (!old(entry) || !(await sweepMedia(lib, shard.url, entry.url, signal))) {
          summary.retained++;
        } else summary.deleted++;
      }
      for (const url of shells) if (await dropEmpty(url)) summary.deleted++;
    }
    return summary;
  }

  // ---- surface ---------------------------------------------------------------------------

  const store: MediaStore<T, I> = {
    get library() {
      return library;
    },
    isInsideLibrary: (url) =>
      library !== null &&
      (lws ? memberShard.has(url) || verifiedShards.has(url) : isInsideLibrary(library, url)),
    checkExposure: (signal) =>
      run(signal, async () =>
        exposureOf(library ?? (await discover(signal)) ?? storage.root, signal).then((state) =>
          state === "failed" ? "unknown" : state,
        ),
      ),
    ensureLibrary: (options) => run(options?.signal, () => ensure(options?.signal)),
    put: (input) => run(input?.signal, () => put(input)),
    list: (opts = {}) => run(opts.signal, () => list(opts)),
    get: (url, signal) => run(signal, () => get(url, signal)),
    update: (url, mutate, opts = {}) => run(opts.signal, () => update(url, mutate, opts.signal)),
    attachThumbnail: (url, input) => run(input?.signal, () => attachThumbnail(url, input)),
    remove: (url, signal) => run(signal, () => remove(url, signal)),
    resumePending: (arg) => {
      const args = resumeArgs(arg);
      return run(args.signal, async () => {
        if (args.bad === true) throw fail("failed", "invalid-input");
        return resumePending(args);
      });
    },
    withdrawPending: (url, signal) => run(signal, () => withdrawPending(url, signal)),
    sweepOrphans: (opts = {}) => run(opts.signal, () => sweep(opts)),
  };
  const opened = await run(options.signal, () => discover(options.signal));
  return opened.ok
    ? { ok: true, value: store }
    : { ok: false, error: opened.error as MediaStoreError };
}
