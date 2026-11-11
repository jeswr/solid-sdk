// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { CONNECTOR_CLASSES, connectorEntries } from "./connectors.js";
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
}
export interface MediaListing {
  records: MediaRecord[];
  incomplete: boolean;
}
export interface MediaRepository {
  load(): Promise<MediaListing>;
  save(data: MediaEntry, existing?: MediaRecord): Promise<MediaRecord>;
}
/** Injection seam keeps domain storage reusable by any app, CLI or importer. */
export function mediaRepository(storage: StorageClient, index: TypeIndex): MediaRepository {
  let initialising: Promise<string> | undefined;
  function initialise(): Promise<string> {
    if (initialising) return initialising;
    initialising = (async () => {
      const locations = await index.find(LOG_ENTRY);
      for (const url of locations) {
        const head = await storage.head(url);
        if (head.kind === "container") return head.url;
        // LWS type search returns instances; their server-reported parent is the locator.
        if (storage.protocol === "lws" && head.parent) {
          const parent = await storage.head(head.parent);
          if (parent.kind === "container") return parent.url;
        }
      }
      const conventional = new URL("media/", storage.root).href;
      let container: string;
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
      await index.register(LOG_ENTRY, { container });
      return container;
    })().catch((error: unknown) => {
      initialising = undefined;
      throw error;
    });
    return initialising;
  }
  return {
    async load() {
      const container = await initialise();
      const locations = await index.findAll([LOG_ENTRY, ...CONNECTOR_CLASSES]);
      const sources = [...new Set([container, ...[...locations.values()].flat()])];
      const records: MediaRecord[] = [];
      const seen = new Set<string>();
      let incomplete = sources.length > 32;
      const signal = AbortSignal.timeout(20000);
      async function read(url: string) {
        if (seen.has(url)) return;
        seen.add(url);
        const result = await storage.readRdf(url, { signal });
        const data = parseMediaLog(url, result.dataset);
        if (data) records.push({ id: url, url, etag: result.etag, data });
        for (const item of connectorEntries(result.dataset))
          records.push({ id: item.id, url: null, etag: null, data: item.data });
      }
      for (const source of sources.slice(0, 32)) {
        const head = await storage.head(source, { signal });
        if (head.kind === "resource") await read(source);
        else {
          for await (const item of storage.listAll(source, { signal, maxBytes: 2 * 1024 * 1024 })) {
            if (seen.size >= 1000) {
              incomplete = true;
              break;
            }
            if (item.kind === "resource") await read(item.url);
          }
        }
      }
      const owned = new Set(
        records
          .filter((record) => record.url)
          .map((record) => record.data.origin)
          .filter(Boolean),
      );
      return {
        records: records.filter((record) => record.url || !owned.has(record.data.origin)),
        incomplete,
      };
    },
    async save(input, existing) {
      const data = validateEntry(input);
      const container = await initialise();
      if (existing?.url) {
        if (!existing.etag) throw new TypeError("Reload this item before editing it");
        await storage.write(existing.url, await serializeMediaLog(existing.url, data), {
          contentType: "text/turtle",
          ifMatch: existing.etag,
        });
        const fresh = await storage.readRdf(existing.url);
        const saved = parseMediaLog(existing.url, fresh.dataset);
        if (!saved) throw new TypeError("The saved media entry is invalid");
        return { ...existing, etag: fresh.etag, data: saved };
      }
      const hint = await index.register(LOG_ENTRY, { container });
      // Allocate first: LWS decides the URL. Require its empty content and ETag together.
      const created = await storage.create(container, null, {
        contentType: "text/turtle",
        ...hint,
      });
      const fresh = await storage.read(created.url);
      if ((await fresh.bytes()).length || !fresh.etag)
        throw new TypeError("Couldn't reserve a new media entry safely");
      await storage.write(created.url, await serializeMediaLog(created.url, data), {
        contentType: "text/turtle",
        ifMatch: fresh.etag,
      });
      const saved = await storage.readRdf(created.url);
      const parsed = parseMediaLog(created.url, saved.dataset);
      if (!parsed) throw new TypeError("The saved media entry is invalid");
      return {
        id: existing?.id ?? created.url,
        url: created.url,
        etag: saved.etag,
        data: parsed,
      };
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
