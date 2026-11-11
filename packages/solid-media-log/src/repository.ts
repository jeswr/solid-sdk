// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex, type TypeHint, type TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { CONNECTOR_CLASSES, connectorEntries, groupNetflixEntries } from "./connectors.js";
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
}
export interface MediaSkip {
  url: string;
  reason: string;
}
export interface MediaListing {
  records: MediaRecord[];
  incomplete: boolean;
  skipped?: MediaSkip[];
}
export interface MediaLoadOptions {
  /** Imports must scan every source before checking duplicates, without the view's deadline. */
  complete?: boolean;
  signal?: AbortSignal;
}
export interface MediaRepository {
  load(options?: MediaLoadOptions): Promise<MediaListing>;
  save(data: MediaEntry, existing?: MediaRecord): Promise<MediaRecord>;
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
export function mediaRepository(storage: StorageClient, index: TypeIndex): MediaRepository {
  let initialising: Promise<{ container: string; hint?: TypeHint | undefined }> | undefined;
  const discoverySkips = new Map<string, string>();
  function initialise() {
    if (initialising) return initialising;
    initialising = (async () => {
      let locations: string[] = [];
      try {
        locations = await interrupted(index.find(LOG_ENTRY), AbortSignal.timeout(20000));
      } catch {
        discoverySkips.set(storage.root, "type-index-unavailable");
      }
      let container: string | undefined;
      for (const url of locations) {
        try {
          const head = await storage.head(url);
          if (head.kind === "container") {
            container = head.url;
            break;
          }
          if (storage.protocol === "lws" && head.parent) {
            const parent = await storage.head(head.parent);
            if (parent.kind === "container") {
              container = parent.url;
              break;
            }
          }
        } catch (error) {
          discoverySkips.set(url, reason(error));
        }
      }
      if (!container) {
        const conventional = new URL("media/", storage.root).href;
        try {
          const head = await storage.head(conventional);
          if (head.kind !== "container") throw new TypeError("Media storage must be a container");
          container = head.url;
        } catch (error) {
          if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
          try {
            container = (
              await storage.create(storage.root, null, { kind: "container", name: "media" })
            ).url;
          } catch (conflict) {
            if (!(conflict instanceof StorageError) || conflict.code !== "conflict") throw conflict;
            const head = await storage.head(conventional);
            if (head.kind !== "container") throw new TypeError("Media storage must be a container");
            container = head.url;
          }
        }
      }
      let hint: TypeHint | undefined;
      try {
        hint = await interrupted(
          index.register(LOG_ENTRY, { container }),
          AbortSignal.timeout(20000),
        );
      } catch {
        console.warn("Media Type Index registration unavailable; using the media container.");
      }
      return { container, hint };
    })().catch((error: unknown) => {
      initialising = undefined;
      throw error;
    });
    return initialising;
  }
  return {
    async load(options = {}) {
      const { container } = await initialise();
      const signal = options.complete
        ? (options.signal ?? new AbortController().signal)
        : AbortSignal.any([
            AbortSignal.timeout(20000),
            ...(options.signal ? [options.signal] : []),
          ]);
      const skipped = new Map(discoverySkips);
      let sources = [container];
      let incomplete = false;
      try {
        const locations = await interrupted(
          index.findAll([LOG_ENTRY, ...CONNECTOR_CLASSES]),
          signal,
        );
        sources = [...new Set([container, ...[...locations.values()].flat()])];
      } catch {
        skipped.set(storage.root, "type-index-unavailable");
      }
      if (!options.complete && sources.length > 32) {
        incomplete = true;
        sources = sources.slice(0, 32);
      }
      const records: MediaRecord[] = [];
      const seen = new Set<string>();
      async function read(url: string) {
        if (seen.has(url)) return;
        seen.add(url);
        try {
          const result = await interrupted(storage.readRdf(url, { signal }), signal);
          if (signal.aborted) throw signal.reason;
          const data = parseMediaLog(url, result.dataset);
          if (data) records.push({ id: url, url, etag: result.etag, data });
          else {
            const imported = connectorEntries(result.dataset);
            if (!imported.length) throw new TypeError("Invalid media entry");
            for (const item of imported) {
              try {
                records.push({
                  id: item.id,
                  url: null,
                  etag: null,
                  data: validateEntry(item.data),
                });
              } catch {
                skipped.set(item.id, "invalid-media-entry");
              }
            }
          }
        } catch (error) {
          skipped.set(url, signal.aborted ? "timeout-or-cancelled" : reason(error));
        }
      }
      for (const source of sources) {
        if (signal.aborted) {
          incomplete = true;
          break;
        }
        let listed = false;
        const batch: Promise<void>[] = [];
        try {
          const head =
            source === container
              ? { kind: "container" }
              : await interrupted(storage.head(source, { signal }), signal);
          if (head.kind === "resource") await read(source);
          else {
            const iterator = storage
              .listAll(source, { signal, maxBytes: 2 * 1024 * 1024 })
              [Symbol.asyncIterator]();
            while (!signal.aborted) {
              const next = await interrupted(iterator.next(), signal);
              if (next.done) break;
              listed = true;
              if (next.value.kind === "resource") batch.push(read(next.value.url));
              if (batch.length === 6) {
                await Promise.all(batch);
                batch.length = 0;
              }
            }
          }
        } catch (error) {
          if (source === container && !listed && !signal.aborted) throw error;
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
      const imported = groupNetflixEntries(
        records.filter((r) => !r.url).map((r) => ({ id: r.id, data: r.data })),
      );
      return {
        records: [
          ...records.filter((r) => r.url),
          ...imported
            .filter((r) => !owned.has(r.data.origin))
            .map((r) => ({ ...r, url: null, etag: null })),
        ],
        incomplete: incomplete || signal.aborted || skipped.size > 0,
        skipped: [...skipped].map(([url, reason]) => ({ url, reason })),
      };
    },
    async save(input, existing) {
      const data = validateEntry(input);
      const { container, hint } = await initialise();
      let url = existing?.url;
      let etag = existing?.etag;
      let reserved = false;
      if (url && !etag) throw new TypeError("Reload this item before editing it");
      if (!url) {
        const created = await storage.create(container, null, {
          contentType: "text/turtle",
          ...hint,
        });
        url = created.url;
        const fresh = await storage.read(url);
        etag = fresh.etag;
        if ((await fresh.bytes()).length || !etag)
          throw new TypeError("Couldn't reserve a new media entry safely");
        reserved = true;
      }
      try {
        await storage.write(url, await serializeMediaLog(url, data), {
          contentType: "text/turtle",
          ifMatch: etag as string,
        });
      } catch (error) {
        // Delete only our observed empty reservation; a concurrent writer's ETag prevents deletion.
        if (reserved) {
          try {
            await storage.delete(url, { ifMatch: etag as string });
          } catch {}
        }
        throw error;
      }
      const saved: MediaRecord = {
        id: existing?.id ?? url,
        url,
        etag: null,
        data,
        unconfirmed: true,
      };
      try {
        const fresh = await storage.readRdf(url);
        const parsed = parseMediaLog(url, fresh.dataset);
        if (parsed) return { ...saved, data: parsed, etag: fresh.etag, unconfirmed: false };
      } catch {
        /* A committed write must never look like a rollback. */
      }
      return saved;
    },
  };
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
  const features = storage.features;
  return mediaRepository(
    storage,
    createTypeIndex({ storage, features, profile: options.webId, fetch: options.fetch }),
  );
}
