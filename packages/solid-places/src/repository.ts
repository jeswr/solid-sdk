// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  type EffectivePolicy,
  ownerPolicy,
  readWac,
  scopePolicy,
  writeWac,
} from "@jeswr/pod-access";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
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
export function assertOwnerOnly(policy: EffectivePolicy, owner: string, members = false): void {
  const selected = scopePolicy(policy, members ? "members" : "resource");
  const modes = new Set<string>();
  if (selected.denials.length) throw new Error("Cannot verify private access");
  for (const grant of selected.grants) {
    if (
      grant.except.length ||
      grant.who.length !== 1 ||
      grant.who[0]?.length !== 1 ||
      grant.who[0][0]?.kind !== "agent" ||
      grant.who[0][0].webId !== owner
    )
      throw new Error("Places storage must be owner-only");
    for (const mode of grant.modes) modes.add(mode);
  }
  if (!["read", "write", "control"].every((mode) => modes.has(mode)))
    throw new Error("Cannot verify full private access");
}
/** Canonical keys stay out of URLs; Web Crypto gives stable SHA-256 file names. */
export async function importId(key: string): Promise<string> {
  if (key.length > 4096) throw new RangeError("Import identifier is too long");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function missing(error: unknown) {
  return error instanceof StorageError && error.code === "not-found";
}
function strong(etag: string | null): string {
  if (!etag || !/^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(etag))
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
  async function acl(url: string) {
    const info = await head(url);
    if (!info) return undefined;
    if (info.links.has("http://www.w3.org/ns/solid/acp#accessControl"))
      throw new Error("Private Places requires WAC storage");
    const links = info.links.get("acl");
    if (links?.length !== 1) throw new Error("Cannot find unambiguous access rules");
    const aclUrl = scope(links[0]!.target);
    const response = await fetch(aclUrl, { redirect: "error", headers: { Accept: "text/turtle" } });
    if (response.status === 404) {
      void response.body?.cancel();
      return { url: aclUrl };
    }
    if (!response.ok) {
      void response.body?.cancel();
      throw new Error("Cannot read private access rules");
    }
    const dataset = await parseRdf(
      response.body ?? "",
      response.headers.get("content-type") ?? "text/turtle",
      { baseIRI: aclUrl, maxBytes: MAX_RESOURCE_BYTES, maxQuads: 10_000 },
    );
    return {
      url: aclUrl,
      etag: response.headers.get("etag"),
      policy: readWac(dataset, url, aclUrl, undefined, true),
    };
  }
  async function verifyPrivacy(url: string, members = false) {
    scope(url);
    let current = url;
    for (let depth = 0; depth < 32; depth++) {
      const rules = await acl(current);
      if (rules?.policy) {
        assertOwnerOnly(rules.policy, owner, current !== url);
        if (members) assertOwnerOnly(rules.policy, owner, true);
        return;
      }
      if (current === storage.root) break;
      current = new URL(current.endsWith("/") ? "../" : "./", current).href;
      scope(current);
    }
    throw new Error("Cannot confirm that Places storage is private");
  }
  async function folder(parent: string, name: string) {
    const url = new URL(`${name}/`, parent).href;
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
    const rules = await acl(url);
    if (!rules) throw new Error("Cannot inspect Places access");
    if (!rules.policy) {
      // A new or empty destination is sealed before any sensitive resource is created.
      for await (const entry of storage.listAll(url, { maxBytes: MAX_RESOURCE_BYTES }))
        if (entry.url !== rules.url)
          throw new Error("Make this Places folder private before opening it");
      const body = await writeWac(ownerPolicy(owner, true), url, rules.url);
      const saved = await fetch(rules.url, {
        method: "PUT",
        redirect: "error",
        headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
        body,
      });
      void saved.body?.cancel();
      if (!saved.ok && saved.status !== 412) throw new Error("Cannot protect Places storage");
    }
    await verifyPrivacy(url, true);
    return url;
  }
  async function initialize() {
    if (
      storage.protocol !== "solid" ||
      (await accessModel({ fetch, storage: storage.root })) !== "wac"
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
            await verifyPrivacy(args[0], true);
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
    const snapshot: PlacesSnapshot = { places: [], visits: [], journeys: [] };
    let readCount = 0;
    const walk = async (
      url: string,
      kind: "Place" | "Visit" | "Journey",
      depth: number,
    ): Promise<void> => {
      if (depth > 2) throw new RangeError("Unexpected Places shard depth");
      await verifyPrivacy(url, true);
      for await (const entry of storage.listAll(url, { maxBytes: 4 * 1024 * 1024 })) {
        if (++readCount > MAX_RESOURCES)
          throw new RangeError("Places history is too large to open in one view");
        if (entry.kind === "container") {
          if (kind !== "Place") await walk(entry.url, kind, depth + 1);
          continue;
        }
        if (!new URL(entry.url).pathname.endsWith(".ttl")) continue;
        const { dataset, etag } = await resource(entry.url);
        if (kind === "Place") {
          const data = entities.Place.parse(entry.url, dataset);
          if (data) snapshot.places.push({ url: entry.url, etag, data });
        } else if (kind === "Visit") {
          const data = entities.Visit.parse(entry.url, dataset);
          if (data && data.endTime >= data.startTime)
            snapshot.visits.push({ url: entry.url, etag, data });
        } else {
          const data = entities.Journey.parse(entry.url, dataset);
          if (data && data.endTime >= data.startTime)
            snapshot.journeys.push({ url: entry.url, etag, data });
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
    await verifyPrivacy(parent, true);
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
    await verifyPrivacy(record.url);
    const current = await resource(record.url);
    if (current.etag !== record.etag)
      throw new Error("This place changed elsewhere. Reload before editing.");
    const data = { ...record.data, ...patch, modified: new Date() };
    const result = await storage.write(
      record.url,
      await serializeRecord("Place", record.url, data),
      { ifMatch: strong(record.etag), contentType: "text/turtle" },
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

/** The suite demo is an explicitly non-enforcing Solid HTTP fixture, not a discovered server. */
export async function openPlacesRepository(options: {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  owner: string;
  demo: boolean;
}) {
  const storage = options.demo
    ? createSolidBackend({ fetch: options.fetch, root: options.storageUrl })
    : (await createPodClient({ fetch: options.fetch, storage: options.storageUrl })).storage;
  return createPlacesRepository(storage, options.fetch, options.owner);
}
