// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { ResourceWriteError } from "../../pod/resource.js";
import { copyDataset } from "../incremental.js";
import type { NormalisedDoc, WriteConditions } from "../types.js";
import { CLASSES, PodThing, SCHEMA } from "../vocab.js";
import type { SyncPodWriter, SyncResource, TwoWayAdapter } from "./types.js";

export interface FakeOperation {
  readonly remoteId?: string;
  readonly name: string;
}
export interface FakeRemoteItem {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly modifiedAt: string;
  readonly deleted?: boolean;
  readonly key?: string;
}
/** Typed one-item document used by the synthetic reference platform. */
export function fakeSyncDocument(url: string, name: string): NormalisedDoc {
  const dataset = copyDataset();
  const item = new PodThing(`${url}#item`, dataset, DataFactory);
  item.name = name;
  return { slug: url, dataset, category: "documents", forClass: CLASSES.TextDigitalDocument };
}
export function fakeSyncName(resource: Pick<SyncResource, "url" | "dataset">): string {
  return new PodThing(`${resource.url}#item`, resource.dataset, DataFactory).name ?? "";
}

/** Bounded-memory fixture host with real validator checks, owner protection and complete lists. */
export function createMemorySyncPod() {
  const root = `https://pod.test/integrations/fake-${crypto.randomUUID()}/`;
  const documents = new Map<
    string,
    { dataset: ReturnType<typeof copyDataset>; etag: string; lastModified: string }
  >();
  const protectedUrls = new Set<string>();
  let version = 0;
  const resolve = (slug: string) => {
    const url = new URL(slug, root);
    if (!url.href.startsWith(root) || url.hash || url.search)
      throw new Error("Fixture URL escapes connector.");
    return url.href;
  };
  const writer: SyncPodWriter = {
    webId: "https://pod.test/profile#owner",
    resolve,
    async read(slug) {
      const stored = documents.get(resolve(slug));
      return stored ? { ...stored, dataset: copyDataset(stored.dataset) } : undefined;
    },
    async write(doc: NormalisedDoc, conditions?: WriteConditions) {
      const url = resolve(doc.slug);
      const stored = documents.get(url);
      if (
        (conditions?.ifNoneMatch === "*" && stored) ||
        (conditions?.ifMatch && conditions.ifMatch !== stored?.etag)
      )
        throw new ResourceWriteError(url, 412);
      const etag = `"v${++version}"`;
      documents.set(url, {
        dataset: copyDataset(doc.dataset),
        etag,
        lastModified: new Date().toISOString(),
      });
      return {
        url,
        etag,
        category: doc.category,
        forClass: doc.forClass,
        skipRegistration: doc.skipRegistration,
      };
    },
    async remove(slug, conditions) {
      const url = resolve(slug);
      const stored = documents.get(url);
      if (stored && conditions?.ifMatch && conditions.ifMatch !== stored.etag)
        throw new ResourceWriteError(url, 412);
      documents.delete(url);
    },
    async registerType() {
      return { indexUrl: `${root}index.ttl` };
    },
    async ensureOwnerOnly(slug) {
      protectedUrls.add(resolve(slug));
    },
    async *list(container) {
      const url = resolve(container);
      for (const [key, value] of documents) {
        if (key.startsWith(url) && !key.slice(url.length).includes("/"))
          yield { url: key, etag: value.etag };
      }
    },
  };
  return {
    writer,
    documents,
    protectedUrls,
    async put(slug: string, name: string, modifiedAt = "2026-01-01T00:00:00Z") {
      await writer.write(fakeSyncDocument(resolve(slug), name));
      const stored = documents.get(resolve(slug));
      if (stored) stored.lastModified = modifiedAt;
    },
    name(slug: string): string | undefined {
      const url = resolve(slug);
      const stored = documents.get(url);
      return stored ? fakeSyncName({ url, dataset: stored.dataset }) : undefined;
    },
  };
}

/** No network: models conditional versions, durable idempotency and a post-create crash. */
export function createFakeTwoWayAdapter(account = "account") {
  const items = new Map<string, FakeRemoteItem>();
  const calls = { apply: 0, create: 0, update: 0, delete: 0, find: 0 };
  let serial = 0;
  let version = 0;
  const platform = {
    items,
    calls,
    crashAfterCreate: false,
    afterApply: undefined as (() => void) | undefined,
    set(name: string, id = "remote-1", modifiedAt = "2026-01-01T00:00:00Z") {
      const item = { id, name, modifiedAt, version: `remote-${++version}` };
      items.set(id, item);
      return item;
    },
    remove(id = "remote-1") {
      const previous = items.get(id);
      if (!previous) throw new Error("Missing fixture item.");
      items.set(id, { ...previous, version: `remote-${++version}`, deleted: true });
    },
  };
  const adapter: TwoWayAdapter<FakeOperation> = {
    metadata: {
      id: "fake-platform",
      name: "Synthetic two-way platform",
      tier: "A",
      authKind: "none",
      scopes: [],
      categories: ["documents"],
      whatYouGet: "Synthetic fixtures only",
      requirements: [],
    },
    fixtures: () => [],
    fieldsForHash: [`${SCHEMA}name`],
    writeBackContainers: ["items/"],
    requiredWriteScopes: ["fake:write"],
    async import(ctx) {
      for (const item of items.values()) {
        ctx.signal?.throwIfAborted();
        if (item.deleted) await ctx.sync.delete(item.id, item.version);
        else {
          const url = await ctx.sync.resolve(item.id, `${account}/items/${item.id}.ttl`);
          await ctx.sync.upsert({
            remoteId: item.id,
            remoteVersion: item.version,
            modifiedAt: item.modifiedAt,
            document: fakeSyncDocument(url, item.name),
          });
        }
      }
      return { cursor: `cursor-${version}` };
    },
    toRemote(resource) {
      return { remoteId: resource.remoteId, name: fakeSyncName(resource) };
    },
    async applyRemote(op, options) {
      options.signal?.throwIfAborted();
      calls.apply++;
      let item: FakeRemoteItem;
      if (op.remoteId) {
        const previous = items.get(op.remoteId);
        if (!previous || previous.deleted || options.ifMatch !== previous.version)
          throw new ResourceWriteError(op.remoteId, 412);
        calls.update++;
        item = {
          ...previous,
          name: op.name,
          version: `remote-${++version}`,
          modifiedAt: new Date().toISOString(),
        };
      } else {
        if (!options.idempotencyKey) throw new Error("Missing create key.");
        const found = [...items.values()].find((item) => item.key === options.idempotencyKey);
        if (found) return { remoteId: found.id, remoteVersion: found.version };
        calls.create++;
        item = {
          id: `created-${++serial}`,
          name: op.name,
          version: `remote-${++version}`,
          modifiedAt: new Date().toISOString(),
          key: options.idempotencyKey,
        };
      }
      items.set(item.id, item);
      platform.afterApply?.();
      if (!op.remoteId && platform.crashAfterCreate) {
        platform.crashAfterCreate = false;
        throw new Error("Synthetic crash after remote create.");
      }
      return { remoteId: item.id, remoteVersion: item.version };
    },
    async findByIdempotencyKey(key, options) {
      options.signal?.throwIfAborted();
      calls.find++;
      const item = [...items.values()].find((item) => item.key === key);
      return item ? { remoteId: item.id, remoteVersion: item.version } : undefined;
    },
    async deleteRemote(remoteId, options) {
      options.signal?.throwIfAborted();
      calls.delete++;
      const item = items.get(remoteId);
      if (!item || item.deleted) return;
      if (options.ifMatch !== item.version) throw new ResourceWriteError(remoteId, 412);
      platform.remove(remoteId);
    },
  };
  return { adapter, platform };
}
