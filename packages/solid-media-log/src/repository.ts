// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { checkOwnerOnly } from "@jeswr/pod-access";
import { createTypeIndex, type TypeHint, type TypeIndex } from "@jeswr/pod-type-index";
import {
  createPodClient,
  isAuxiliaryResource,
  type RdfReadResult,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  CONNECTOR_CLASSES,
  type ConnectorEntry,
  connectorEntries,
  groupNetflixEntries,
  isConnectorDocument,
} from "./connectors.js";
import { mediaImportOccurrence } from "./imports.js";
import {
  LOG_ENTRY,
  type MediaEntry,
  parseMediaLog,
  serializeMediaLog,
  validateEntry,
} from "./model.js";

export interface MediaRecord {
  id: string;
  url: string | null;
  etag: string | null;
  data: MediaEntry;
  /** The write succeeded, but its representation could not yet be confirmed. */
  unconfirmed?: boolean;
  /** Another importer already completed this occurrence at its claimed URL. */
  alreadyImported?: boolean;
}
export interface MediaSkip {
  url: string;
  reason: string;
}
export interface MediaListing {
  records: MediaRecord[];
  /** Discovery or a source scan did not finish, including retryable reads of individual items. */
  incomplete: boolean;
  connectorDiscoveryUnavailable?: boolean;
  skipped?: MediaSkip[];
}
export interface MediaLoadOptions {
  /** Imports must scan every source before checking duplicates, without the view's deadline. */
  complete?: boolean;
  signal?: AbortSignal;
}
export interface MediaRepository {
  load(options?: MediaLoadOptions): Promise<MediaListing>;
  save(data: MediaEntry, existing?: MediaRecord, options?: MediaSaveOptions): Promise<MediaRecord>;
}
export interface MediaSaveOptions {
  /** Reuse the same token when retrying an unconfirmed new write. Defaults to the input object. */
  attempt?: object;
  /** Original CSV occurrence, used for atomic exact-URL creation of new imports. */
  importEntry?: MediaEntry;
}
export class MediaPrivacyError extends Error {
  constructor() {
    super(
      "Media needs an owner-only destination. Access could not be verified, so no media was saved.",
    );
  }
}
type VerifyPrivate = (url: string, signal: AbortSignal) => Promise<boolean>;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

function strongEtag(value: string | null | undefined): value is string {
  return typeof value === "string" && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

function documentUrl(url: string): string {
  const document = new URL(url);
  document.hash = "";
  return document.href;
}

function accessControlDocument({ dataset }: RdfReadResult): boolean {
  for (const { predicate, object } of dataset) {
    if (
      [predicate.value, object.termType === "NamedNode" ? object.value : ""].some(
        (iri) =>
          iri.startsWith("http://www.w3.org/ns/auth/acl#") ||
          iri.startsWith("http://www.w3.org/ns/solid/acp#") ||
          iri === "http://www.w3.org/ns/solid/terms#TypeIndex",
      )
    )
      return true;
  }
  return false;
}
/** Bound even injected transports that do not honour abort themselves. */
function interrupted<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function reason(error: unknown): string {
  return error instanceof StorageError ? error.code : "invalid-or-unavailable";
}
/** Injection seam keeps domain storage reusable by any app, CLI or importer. */
export function mediaRepository(
  storage: StorageClient,
  index: TypeIndex | undefined,
  verifyPrivate: VerifyPrivate,
): MediaRepository {
  const pending = new WeakMap<object, { url: string; attempted: MediaEntry }>();
  const conventional = new URL("media/", storage.root).href;
  async function isPrivate(url: string, signal: AbortSignal): Promise<boolean> {
    try {
      return await interrupted(verifyPrivate(url, signal), signal);
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }
  async function requirePrivate(url: string, signal: AbortSignal) {
    const verified = await isPrivate(url, signal).catch(() => false);
    if (!verified) throw new MediaPrivacyError();
  }
  async function readMedia(url: string, signal: AbortSignal) {
    return interrupted(storage.readRdf(url, { signal, maxBytes: MAX_MEDIA_BYTES }), signal);
  }
  function discoveryUnavailable(error: unknown) {
    return (
      storage.protocol === "lws" && error instanceof StorageError && error.code === "unsupported"
    );
  }
  let initialising:
    | Promise<{ container: string; hint?: TypeHint | undefined; present: boolean }>
    | undefined;
  function initialise() {
    if (initialising) return initialising;
    // Shared session work outlives any one caller's cancelled wait.
    const signal = AbortSignal.timeout(20000);
    initialising = (async () => {
      let locations: string[] = [];
      try {
        if (index) locations = await interrupted(index.find(LOG_ENTRY), signal);
      } catch {
        signal.throwIfAborted();
        // load() retries discovery for each scan; a transient failure is not session state.
      }
      let container: string | undefined;
      for (const location of locations) {
        try {
          const url = documentUrl(location);
          if (isAuxiliaryResource(url)) continue;
          const head = await interrupted(storage.head(url, { signal }), signal);
          if (isAuxiliaryResource(url, head)) continue;
          if (head.kind === "container") {
            container = head.url;
            break;
          }
          if (storage.protocol === "lws" && head.parent) {
            const parent = await interrupted(storage.head(head.parent, { signal }), signal);
            if (parent.kind === "container" && !isAuxiliaryResource(parent.url, parent)) {
              container = parent.url;
              break;
            }
          }
        } catch {
          signal.throwIfAborted();
        }
      }
      if (!container) {
        try {
          const head = await interrupted(storage.head(conventional, { signal }), signal);
          if (head.kind !== "container" || isAuxiliaryResource(head.url, head))
            throw new TypeError("Media storage must be a container");
          container = head.url;
        } catch (error) {
          if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
          signal.throwIfAborted();
          // A private root must be established before bootstrapping a destination.
          if (!(await isPrivate(storage.root, signal))) {
            initialising = undefined;
            return { container: conventional, present: false };
          }
          try {
            container = (
              await interrupted(
                storage.create(storage.root, null, { kind: "container", name: "media", signal }),
                signal,
              )
            ).url;
          } catch (conflict) {
            if (!(conflict instanceof StorageError) || conflict.code !== "conflict") throw conflict;
            const head = await interrupted(storage.head(conventional, { signal }), signal);
            if (head.kind !== "container" || isAuxiliaryResource(head.url, head))
              throw new TypeError("Media storage must be a container");
            container = head.url;
          }
        }
      }
      let hint: TypeHint | undefined;
      try {
        // TypeIndex has no signal option; do not start registration after our deadline.
        signal.throwIfAborted();
        if (index && (storage.protocol === "lws" || (await isPrivate(container, signal))))
          hint = await interrupted(index.register(LOG_ENTRY, { container }), signal);
      } catch {
        signal.throwIfAborted();
        console.warn("Media Type Index registration unavailable; using the media container.");
      }
      return { container, hint, present: true };
    })().catch((error: unknown) => {
      initialising = undefined;
      throw error;
    });
    return initialising;
  }
  return {
    async load(options = {}) {
      const signal = options.complete
        ? (options.signal ?? new AbortController().signal)
        : AbortSignal.any([
            AbortSignal.timeout(20000),
            ...(options.signal ? [options.signal] : []),
          ]);
      const { container, present } = await interrupted(initialise(), signal);
      const skipped = new Map<string, string>();
      let sources = [container];
      let incomplete = false;
      let connectorDiscoveryUnavailable = !index;
      try {
        if (index) {
          const locations = await interrupted(
            index.findAll([LOG_ENTRY, ...CONNECTOR_CLASSES]),
            signal,
          );
          sources = [...new Set([container, ...[...locations.values()].flat().map(documentUrl)])];
        }
      } catch (error) {
        connectorDiscoveryUnavailable = discoveryUnavailable(error);
        if (!connectorDiscoveryUnavailable) {
          incomplete = true;
          skipped.set(storage.root, "type-index-unavailable");
        }
      }
      if (!options.complete && sources.length > 32) {
        incomplete = true;
        sources = sources.slice(0, 32);
      }
      const records: MediaRecord[] = [];
      const connectors: ConnectorEntry[] = [];
      const seen = new Set<string>();
      async function read(location: string, editable = false) {
        const url = documentUrl(location);
        if (seen.has(url)) return;
        seen.add(url);
        try {
          if (isAuxiliaryResource(url)) {
            skipped.set(url, "auxiliary-resource");
            return;
          }
          const result = await readMedia(url, signal);
          if (signal.aborted) throw signal.reason;
          // Failed creates can leave empty reservations without an observed validator.
          if (!result.dataset.size) return;
          if (accessControlDocument(result)) {
            skipped.set(url, "auxiliary-resource");
            return;
          }
          const data = parseMediaLog(url, result.dataset);
          if (data)
            records.push({
              id: url,
              url: editable ? url : null,
              etag: editable ? result.etag : null,
              data: editable ? data : { ...data, origin: data.origin ?? url },
            });
          else {
            const imported = connectorEntries(result.dataset);
            if (!imported.length && !isConnectorDocument(result.dataset))
              throw new TypeError("Invalid media entry");
            for (const item of imported) {
              try {
                connectors.push({
                  id: item.id,
                  data: validateEntry(item.data),
                });
              } catch {
                skipped.set(item.id, "invalid-media-entry");
              }
            }
          }
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof StorageError &&
              (error.retryable || error.code === "payload-too-large"))
          )
            incomplete = true;
          skipped.set(url, signal.aborted ? "timeout-or-cancelled" : reason(error));
        }
      }
      for (const source of sources) {
        if (signal.aborted) {
          incomplete = true;
          break;
        }
        let listed = false;
        let listing = source === container;
        const batch: Promise<void>[] = [];
        try {
          if (isAuxiliaryResource(source)) {
            skipped.set(source, "auxiliary-resource");
            continue;
          }
          if (source === container && !present) continue;
          const head =
            source === container
              ? undefined
              : await interrupted(storage.head(source, { signal }), signal);
          if (head && isAuxiliaryResource(source, head)) skipped.set(source, "auxiliary-resource");
          else if (head?.kind === "resource") await read(source);
          else {
            listing = true;
            const iterator = storage
              .listAll(source, { signal, maxBytes: 2 * 1024 * 1024 })
              [Symbol.asyncIterator]();
            while (!signal.aborted) {
              const next = await interrupted(iterator.next(), signal);
              if (next.done) break;
              listed = true;
              if (next.value.kind === "resource")
                batch.push(read(next.value.url, source === container));
              if (batch.length === 6) {
                await Promise.all(batch);
                batch.length = 0;
              }
            }
          }
        } catch (error) {
          if (source === container && !listed && !signal.aborted) throw error;
          // A missing/forbidden instance is rejected. A failed container scan can hide entries.
          if (
            signal.aborted ||
            listing ||
            !(error instanceof StorageError) ||
            error.retryable ||
            (error.code !== "not-found" && error.code !== "forbidden")
          )
            incomplete = true;
          skipped.set(source, signal.aborted ? "timeout-or-cancelled" : reason(error));
        } finally {
          await Promise.all(batch);
        }
      }
      const owned = new Set(
        records
          .filter((r) => r.url)
          .map((r) => r.data.origin)
          .filter(Boolean),
      );
      return {
        records: [
          ...records.filter((r) => r.url || !owned.has(r.data.origin)),
          ...groupNetflixEntries(connectors)
            .filter((r) => !owned.has(r.data.origin))
            .map((r) => ({ ...r, url: null, etag: null })),
        ],
        incomplete: incomplete || signal.aborted,
        ...(connectorDiscoveryUnavailable ? { connectorDiscoveryUnavailable } : {}),
        skipped: [...skipped].map(([url, reason]) => ({ url, reason })),
      };
    },
    async save(input, existing, options = {}) {
      const data = validateEntry(input);
      const { container, hint, present } = await initialise();
      if (!present) throw new MediaPrivacyError();
      const signal = AbortSignal.timeout(20000);
      const attempt = options.attempt ?? input;
      const retry = existing?.url ? undefined : pending.get(attempt);
      const occurrence = options.importEntry && mediaImportOccurrence(options.importEntry);
      let url = existing?.url ?? retry?.url;
      let etag = existing?.etag;
      let reservationEtag: string | null = null;
      const newEntry = !existing?.url;
      const claim = newEntry && occurrence ? await importClaim(container, occurrence) : undefined;
      if (!newEntry && !strongEtag(etag)) throw new TypeError("Reload this item before editing it");
      if (newEntry) await requirePrivate(container, signal);
      if (!url) {
        if (claim && storage.protocol !== "solid")
          throw new TypeError("This storage cannot claim a CSV import occurrence atomically");
        try {
          const created = await storage.create(container, null, {
            contentType: "text/turtle",
            ...hint,
            ...(claim ? { exactUrl: claim } : {}),
            signal,
          });
          url = created.url;
          // A follow-up HEAD may already describe someone else's content.
          if (!claim && created.etagSource === "response" && strongEtag(created.etag))
            reservationEtag = created.etag;
        } catch (error) {
          if (!claim || !(error instanceof StorageError) || error.code !== "conflict") throw error;
          url = claim;
        }
      }
      const target = url;
      const readRecord = async (readSignal: AbortSignal) => {
        const fresh = await readMedia(target, readSignal);
        const parsed = !accessControlDocument(fresh) && parseMediaLog(target, fresh.dataset);
        return (
          parsed && {
            id: existing?.id ?? target,
            url: target,
            data: parsed,
            etag: fresh.etag,
            unconfirmed: false,
          }
        );
      };
      let body: string;
      try {
        if (isAuxiliaryResource(target) || (await storage.parentOf(target)) !== container) {
          reservationEtag = null;
          throw new TypeError("Choose a media document in your media container");
        }
        await requirePrivate(target, signal);
        body = await serializeMediaLog(target, data);
        if (newEntry) {
          const fresh = await storage.read(target, { signal, maxBytes: MAX_MEDIA_BYTES });
          if (fresh.kind !== "resource" || isAuxiliaryResource(target, fresh)) {
            reservationEtag = null;
            throw new TypeError("Couldn't reserve a new media entry safely");
          }
          if ((await fresh.bytes()).length) {
            reservationEtag = null;
            const current = (retry || claim) && (await readRecord(signal));
            if (current && claim && mediaImportOccurrence(current.data) === occurrence)
              return { ...current, alreadyImported: true };
            if (
              !current ||
              !retry ||
              (await serializeMediaLog(target, current.data)) !==
                (await serializeMediaLog(target, retry.attempted))
            )
              throw new TypeError("Couldn't reserve a new media entry safely");
            if ((await serializeMediaLog(target, current.data)) === body) {
              pending.delete(attempt);
              return current;
            }
            etag = current.etag;
          } else {
            if (reservationEtag && fresh.etag && fresh.etag !== reservationEtag) {
              reservationEtag = null;
              throw new TypeError("Couldn't reserve a new media entry safely");
            }
            if (!claim && !retry && strongEtag(fresh.etag)) reservationEtag = fresh.etag;
            etag = fresh.etag;
          }
          if (!strongEtag(etag)) throw new TypeError("Couldn't reserve a new media entry safely");
        } else {
          const head = await storage.head(target, { signal, revalidate: true });
          if (head.kind !== "resource" || isAuxiliaryResource(target, head))
            throw new TypeError("Choose a media document in your media container");
          const current = await readRecord(signal);
          if (!current) throw new TypeError("This resource is not a verified media document");
          if (current.etag !== etag)
            throw new StorageError("precondition-failed", {
              url: target,
              method: "PUT",
              status: 412,
            });
        }
      } catch (error) {
        if (reservationEtag && !(error instanceof MediaPrivacyError)) {
          try {
            await storage.delete(target, { ifMatch: reservationEtag });
          } catch {}
        }
        throw error;
      }
      try {
        await storage.write(target, body, {
          contentType: "text/turtle",
          ifMatch: etag as string,
          signal,
        });
      } catch (error) {
        const ambiguous =
          !(error instanceof StorageError) ||
          error.code === "network" ||
          error.code === "server" ||
          error.code === "invalid-response";
        if (ambiguous && newEntry) pending.set(attempt, { url: target, attempted: data });
        if (ambiguous || claim) {
          try {
            const current = await readRecord(AbortSignal.timeout(20000));
            if (current && ambiguous && (await serializeMediaLog(target, current.data)) === body) {
              pending.delete(attempt);
              return current;
            }
            if (current && claim && mediaImportOccurrence(current.data) === occurrence)
              return { ...current, alreadyImported: true };
          } catch {
            // Preserve the URL so the retry can reconcile before sending another write.
          }
        }
        if (!ambiguous && reservationEtag) {
          try {
            await storage.delete(target, { ifMatch: reservationEtag });
          } catch {}
        }
        throw error;
      }
      pending.delete(attempt);
      const saved: MediaRecord = {
        id: existing?.id ?? target,
        url: target,
        etag: null,
        data,
        unconfirmed: true,
      };
      try {
        return (await readRecord(signal)) || saved;
      } catch {
        /* A committed write must never look like a rollback. */
        return saved;
      }
    },
  };
}
async function importClaim(container: string, occurrence: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(occurrence));
  const name = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new URL(`import-${name}.ttl`, container).href;
}

export async function createMediaRepository(options: {
  fetch: typeof globalThis.fetch;
  storage: string;
  webId: string;
  /** Explicitly known Solid transport, for demo pods without discovery metadata. */
  knownSolid?: boolean;
}): Promise<MediaRepository> {
  const storage = options.knownSolid
    ? createSolidBackend({ fetch: options.fetch, root: options.storage })
    : (await createPodClient({ fetch: options.fetch, storage: options.storage })).storage;
  const verificationFeatures: StorageClient["features"] = options.knownSolid
    ? // The built-in demo fixture serves WAC but does not advertise a storage description.
      {
        ...storage.features,
        accessControl: { state: "available", evidence: "demo fixture", detail: { model: "wac" } },
      }
    : storage.features;
  const verify: VerifyPrivate = async (url, signal) => {
    const scopedReads: StorageClient = {
      ...storage,
      features: verificationFeatures,
      head: (target, opts) => storage.head(target, { ...opts, signal }),
      read: (target, opts) => storage.read(target, { ...opts, signal }),
    };
    return (await checkOwnerOnly({ storage: scopedReads, url, ownerWebId: options.webId })).private;
  };
  const indexStorage: StorageClient = {
    ...storage,
    async writeRdf(url, dataset, opts) {
      if (!(await verify(url, opts.signal ?? AbortSignal.timeout(20000))))
        throw new MediaPrivacyError();
      return storage.writeRdf(url, dataset, opts);
    },
    async create() {
      // Existing private indexes can be updated. Provisioning an index with private metadata
      // would need a separate verified reservation before supplying its initial RDF.
      throw new MediaPrivacyError();
    },
  };
  let index: TypeIndex | undefined;
  try {
    index = createTypeIndex({
      storage: indexStorage,
      features: storage.features,
      profile: options.webId,
      fetch: options.fetch,
    });
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "scope") throw error;
  }
  return mediaRepository(storage, index, verify);
}
