// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { checkOwnerOnly, ownerPolicy, writeWac } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import {
  entities,
  PLACE_CLASS,
  type PlaceData,
  type PlacesSnapshot,
  type RecordValue,
  serializeRecord,
} from "./model.js";
import type { TimelineImport } from "./timeline.js";

const MAX_RESOURCES = 100_000;
const MAX_RESOURCE_BYTES = 128 * 1024;
/** Canonical keys stay out of URLs; Web Crypto gives stable SHA-256 file names. */
export async function importId(key: string): Promise<string> {
  if (key.length > 4096) throw new RangeError("Import identifier is too long");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
type Head = Awaited<ReturnType<StorageClient["head"]>>;
type Read = Awaited<ReturnType<StorageClient["read"]>>;
interface ReadProof {
  value: Read;
  chunks: Uint8Array<ArrayBuffer>[];
}
/** A recorded access-document read with a fresh, single-use body. */
function replay({ value, chunks }: ReadProof): Read {
  const response = new Response(new Blob(chunks));
  return {
    ...value,
    body: response.body,
    bytes: response.bytes.bind(response),
    text: response.text.bind(response),
    blob: response.blob.bind(response),
  };
}
function missing(error: unknown) {
  return error instanceof StorageError && error.code === "not-found";
}
function version(etag: string | null): string {
  if (!etag || !/^(?:W\/)?"[\x21\x23-\x7E\x80-\xFF]*"$/.test(etag))
    throw new Error("A version is needed to save safely");
  return etag;
}

/** Solid-only first cut: unsupported/ambiguous access models refuse before history is written. */
export function createPlacesRepository(
  storage: StorageClient,
  fetch: typeof globalThis.fetch,
  owner: string,
) {
  const base = new URL("places/", storage.root).href;
  const collection = new URL("places/", base).href;
  let initialized = false;
  const scope = (url: string) => {
    if (!storage.isWithinStorage(url)) throw new Error("Untrusted places location");
    return url;
  };
  async function head(url: string) {
    try {
      return await storage.head(scope(url));
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  // Session-scoped proofs: retain only container observations from successful shared
  // checks. File ACL overrides are always checked afresh. Reopening clears all proofs.
  // checkOwnerOnly drains each access document's body once, so a read is recorded as it is
  // drained (within the helper's own byte cap) and replayed as a fresh body.
  const verified = new Set<string>();
  const proofHeads = new Map<string, Head>();
  const proofReads = new Map<string, ReadProof>();
  async function verifyPrivacy(url: string) {
    scope(url);
    if (verified.has(url)) return;
    const heads = new Map<string, Head>();
    const reads = new Map<string, ReadProof>();
    const proofStorage = new Proxy(storage, {
      get(target, key) {
        if (key === "head")
          return async (...args: Parameters<StorageClient["head"]>) => {
            const cached = proofHeads.get(args[0]);
            if (cached) return cached;
            const value = await target.head(...args);
            heads.set(args[0], value);
            return value;
          };
        if (key === "read")
          return async (...args: Parameters<StorageClient["read"]>) => {
            const cached = proofReads.get(args[0]);
            if (cached) return replay(cached);
            const value = await target.read(...args);
            if (!value.body) return value;
            const chunks: Uint8Array<ArrayBuffer>[] = [];
            const body = value.body.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  chunks.push(new Uint8Array(chunk));
                  controller.enqueue(chunk);
                },
                // Only a fully drained body is a reusable observation.
                flush() {
                  reads.set(args[0], { value, chunks });
                },
              }),
            );
            return { ...value, body };
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    if (!(await checkOwnerOnly({ storage: proofStorage, url, ownerWebId: owner })).private)
      throw new Error("Cannot confirm owner-only Places storage");
    if (url.endsWith("/")) {
      verified.add(url);
      for (const [key, value] of heads) proofHeads.set(key, value);
      for (const [key, value] of reads) proofReads.set(key, value);
    }
  }
  async function folder(parent: string, name: string) {
    const url = scope(new URL(`${name}/`, parent).href);
    if (verified.has(url)) return url;
    let existing = await head(url);
    if (!existing) {
      try {
        await storage.create(parent, null, { kind: "container", name });
      } catch (error) {
        if (!(error instanceof StorageError && error.code === "conflict")) throw error;
      }
      existing = await head(url);
      if (!existing) throw new Error("Cannot create Places folder");
    }
    if (existing.links.has("http://www.w3.org/ns/solid/acp#accessControl"))
      throw new Error("Private Places requires WAC storage");
    const links = existing.links.get("acl");
    if (links?.length !== 1) throw new Error("Cannot find unambiguous access rules");
    const aclUrl = scope(links[0]!.target);
    if (!(await head(aclUrl))) {
      // Only a confirmed absent ACL on an empty folder may be provisioned.
      for await (const entry of storage.listAll(url, { maxBytes: MAX_RESOURCE_BYTES }))
        if (entry.url !== aclUrl)
          throw new Error("Make this Places folder private before opening it");
      const body = await writeWac(ownerPolicy(owner, true), url, aclUrl);
      const saved = await fetch(aclUrl, {
        method: "PUT",
        redirect: "error",
        headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
        body,
      });
      void saved.body?.cancel();
      if (!saved.ok && saved.status !== 412) throw new Error("Cannot protect Places storage");
    }
    await verifyPrivacy(url);
    return url;
  }
  async function initialize() {
    initialized = false;
    verified.clear();
    proofHeads.clear();
    proofReads.clear();
    if (
      storage.protocol !== "solid" ||
      storage.features.accessControl.state !== "available" ||
      storage.features.accessControl.detail.model !== "wac"
    )
      throw new Error("Private Places needs a supported owner-only access model");
    await folder(storage.root, "places");
    await folder(base, "places");
    await folder(base, "visits");
    await folder(base, "journeys");
    // A private Type Index is merely unlisted. Guard every index/preferences write,
    // including bootstrap destinations, rather than assuming that it is private.
    const profile = owner.split("#")[0];
    const indexStorage = new Proxy(storage, {
      get(target, key) {
        if (key === "readRdf")
          return async (...args: Parameters<StorageClient["readRdf"]>) => {
            if (args[0] !== profile) await verifyPrivacy(args[0]);
            return target.readRdf(...args);
          };
        if (key === "writeRdf")
          return async (...args: Parameters<StorageClient["writeRdf"]>) => {
            await verifyPrivacy(args[0]);
            return target.writeRdf(...args);
          };
        if (key === "create")
          return async (...args: Parameters<StorageClient["create"]>) => {
            await verifyPrivacy(args[0]);
            return target.create(...args);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await createTypeIndex({
      storage: indexStorage,
      features: storage.features,
      profile: owner,
    }).register(PLACE_CLASS, { container: collection }, { index: "private" });
    initialized = true;
  }
  function ready() {
    if (!initialized) throw new Error("Open private Places storage first");
  }
  async function resource(url: string) {
    await verifyPrivacy(url);
    const response = await storage.read(scope(url), { accept: "text/turtle" });
    const dataset = await parseRdf(response.body ?? "", response.contentType ?? "text/turtle", {
      baseIRI: url,
      maxBytes: MAX_RESOURCE_BYTES,
      maxQuads: 2000,
    });
    return { dataset, etag: response.etag };
  }
  async function load(): Promise<PlacesSnapshot> {
    ready();
    const snapshot: PlacesSnapshot = { places: [], visits: [], journeys: [], skipped: 0 };
    let readCount = 0;
    const walk = async (
      url: string,
      kind: "Place" | "Visit" | "Journey",
      depth: number,
    ): Promise<void> => {
      if (depth > 2) throw new RangeError("Unexpected Places shard depth");
      await verifyPrivacy(url);
      for await (const entry of storage.listAll(url, { maxBytes: 4 * 1024 * 1024 })) {
        if (++readCount > MAX_RESOURCES)
          throw new RangeError("Places history is too large to open in one view");
        if (entry.kind === "container") {
          if (kind !== "Place") await walk(entry.url, kind, depth + 1);
          continue;
        }
        if (!new URL(entry.url).pathname.endsWith(".ttl")) continue;
        try {
          const { dataset, etag } = await resource(entry.url);
          if (kind === "Place") {
            const data = entities.Place.parse(entry.url, dataset);
            if (!data) throw new Error("Invalid place");
            snapshot.places.push({ url: entry.url, etag, data });
          } else if (kind === "Visit") {
            const data = entities.Visit.parse(entry.url, dataset);
            if (!data || data.endTime < data.startTime) throw new Error("Invalid visit");
            snapshot.visits.push({ url: entry.url, etag, data });
          } else {
            const data = entities.Journey.parse(entry.url, dataset);
            if (!data || data.endTime < data.startTime) throw new Error("Invalid journey");
            snapshot.journeys.push({ url: entry.url, etag, data });
          }
        } catch {
          snapshot.skipped!++;
        }
      }
    };
    await walk(collection, "Place", 0);
    await walk(new URL("visits/", base).href, "Visit", 0);
    await walk(new URL("journeys/", base).href, "Journey", 0);
    return snapshot;
  }
  async function destination(kind: "visits" | "journeys", at: Date) {
    const date = at.toISOString();
    const year = await folder(new URL(`${kind}/`, base).href, date.slice(0, 4));
    return folder(year, date.slice(5, 7));
  }
  async function createRecord(
    parent: string,
    id: string,
    kind: "Place" | "Visit" | "Journey",
    data:
      | Parameters<typeof entities.Place.serialize>[1]
      | Parameters<typeof entities.Visit.serialize>[1]
      | Parameters<typeof entities.Journey.serialize>[1],
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    await verifyPrivacy(parent);
    const url = new URL(`${await importId(id)}.ttl`, parent).href;
    if (await head(url)) {
      const value = await resource(url);
      if (!entities[kind].parse(url, value.dataset))
        throw new Error("Import identifier conflicts with existing data");
      return url;
    }
    const body =
      kind === "Place"
        ? await serializeRecord(kind, url, data as PlaceData)
        : kind === "Visit"
          ? await serializeRecord(kind, url, data as Parameters<typeof entities.Visit.serialize>[1])
          : await serializeRecord(
              kind,
              url,
              data as Parameters<typeof entities.Journey.serialize>[1],
            );
    signal?.throwIfAborted();
    try {
      return (
        await storage.create(parent, body, {
          name: new URL(url).pathname.split("/").pop()!,
          contentType: "text/turtle",
          ...(signal ? { signal } : {}),
        })
      ).url;
    } catch (error) {
      if (!(error instanceof StorageError && error.code === "conflict")) throw error;
      const existing = await resource(url);
      if (!entities[kind].parse(url, existing.dataset))
        throw new Error("Import identifier conflicts with existing data");
      return url;
    }
  }
  async function importTimeline(
    input: TimelineImport,
    progress: (done: number, total: number) => void = () => {},
    signal?: AbortSignal,
  ) {
    ready();
    let done = 0;
    const total = input.places.length + input.visits.length + input.journeys.length;
    const placeUrls = new Map<string, string>();
    progress(0, total);
    const checkpoint = async () => {
      progress(++done, total);
      if (done % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    };
    for (const place of input.places) {
      placeUrls.set(
        place.id,
        await createRecord(collection, place.id, "Place", place.data, signal),
      );
      await checkpoint();
    }
    for (const visit of input.visits) {
      signal?.throwIfAborted();
      const url = placeUrls.get(visit.placeId);
      if (!url) throw new Error("Visit refers to a missing place");
      await createRecord(
        await destination("visits", visit.data.startTime),
        visit.id,
        "Visit",
        { ...visit.data, place: entities.Place.subject(url) },
        signal,
      );
      await checkpoint();
    }
    for (const journey of input.journeys) {
      signal?.throwIfAborted();
      await createRecord(
        await destination("journeys", journey.data.startTime),
        journey.id,
        "Journey",
        journey.data,
        signal,
      );
      await checkpoint();
    }
  }
  async function savePlace(
    record: RecordValue<PlaceData>,
    patch: Partial<Pick<PlaceData, "name" | "category" | "notes" | "saved">>,
  ) {
    ready();
    const target = new URL(record.url);
    if (
      target.href !== record.url ||
      new URL(".", target).href !== collection ||
      target.search ||
      target.hash
    )
      throw new Error("Place is outside this collection");
    const current = await resource(record.url);
    if (current.etag !== record.etag)
      throw new Error("This place changed elsewhere. Reload before editing.");
    const baseline = entities.Place.parse(record.url, current.dataset);
    if (!baseline) throw new Error("Cannot read the place to edit");
    const data = { ...baseline, ...patch, modified: new Date() };
    // Generate the field delta, then apply it to the original graph. Other apps'
    // subjects, annotations and unedited lexical values stay byte-for-byte terms.
    const before = entities.Place.build(record.url, baseline);
    const after = entities.Place.build(record.url, data);
    if (!entities.Place.parse(record.url, after)) throw new TypeError("Invalid place");
    const changed = [...before, ...after].filter((quad) => before.has(quad) !== after.has(quad));
    for (const quad of changed) {
      for (const original of current.dataset.getQuads(
        quad.subject.value,
        quad.predicate.value,
        null,
        null,
      ))
        current.dataset.delete(original);
    }
    for (const quad of after) {
      if (
        changed.some(
          (item) => item.subject.equals(quad.subject) && item.predicate.equals(quad.predicate),
        )
      )
        current.dataset.add(quad);
    }
    const result = await storage.write(
      record.url,
      await entities.Place.storeToTurtle(current.dataset),
      { ifMatch: version(record.etag), contentType: "text/turtle" },
    );
    if (result.etagSource !== "response") {
      const fresh = await resource(result.url);
      const reconciled = entities.Place.parse(result.url, fresh.dataset);
      if (!reconciled) throw new Error("Cannot read the saved place");
      return { url: result.url, etag: fresh.etag, data: reconciled };
    }
    return { url: result.url, etag: result.etag, data };
  }
  return { base, initialize, load, importTimeline, savePlace };
}
export type PlacesRepository = ReturnType<typeof createPlacesRepository>;

/** Storage discovery belongs to the caller when an account already has a client. */
export async function openPlacesRepository(options: {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  owner: string;
  storage?: StorageClient;
}) {
  const storage =
    options.storage ??
    (await createPodClient({ fetch: options.fetch, storage: options.storageUrl })).storage;
  return createPlacesRepository(storage, options.fetch, options.owner);
}
