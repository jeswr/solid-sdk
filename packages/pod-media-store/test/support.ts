// AUTHORED-BY Claude Sonnet 5.5
import { createTypeIndex } from "@jeswr/pod-type-index";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import type { MediaStore, MediaStoreOptions, PutInput } from "../src/index.js";
import { openMediaStore } from "../src/index.js";

export const ROOT = "https://pod.example/alice/";
export const WEBID = `${ROOT}profile/card#me`;
export const CLASS = "https://example.org/ns#Media";
export type Protocol = "solid" | "lws";

/** The test model: a JSON-LD description with a name, the pointers and another app's triple. */
export interface Model {
  id: string;
  name: string;
  binaryUrl: string;
  thumbnailUrl?: string;
  other?: string;
}
export interface Input {
  name: string;
}

export const parseModel = async (url: string, body: string): Promise<Model | undefined> => {
  const json = JSON.parse(body) as Record<string, unknown>;
  if (json["@type"] !== "ex:Media") return undefined;
  return {
    id: url,
    name: json.name as string,
    binaryUrl: json.contentUrl as string,
    ...(json.thumbnailUrl === undefined ? {} : { thumbnailUrl: json.thumbnailUrl as string }),
    ...(json.other === undefined ? {} : { other: json.other as string }),
  };
};

export const buildModel: MediaStoreOptions<Model, Input>["build"] = async (
  url,
  binaryUrl,
  input,
  context,
) => ({
  contentType: "application/ld+json",
  body: JSON.stringify({
    "@id": `${url}#it`,
    "@type": "ex:Media",
    name: input.name,
    contentUrl: binaryUrl,
    sha256: context.sha256,
    ...(context.thumbnailUrl === undefined ? {} : { thumbnailUrl: context.thumbnailUrl }),
  }),
});

export function png(seed = 0, size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff;
  return bytes;
}

export function jpeg(seed = 0): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < 24; i++) bytes[i] = (seed * 13 + i) & 0xff;
  return bytes;
}

export const AT = new Date("2026-05-17T10:00:00Z");

export function putInput(
  overrides: Partial<PutInput<Input>> & { seed?: number } = {},
): PutInput<Input> {
  const { seed, ...rest } = overrides;
  return {
    bytes: png(seed ?? 1),
    contentType: "image/png",
    extension: ".png",
    createdAt: AT,
    description: { name: "first" },
    ...rest,
  };
}

/** LWS stand-in: the type index service is a QUERY we do not have, so read class types off the root. */
export function lwsTypeIndex(storage: StorageClient): MediaStoreOptions<Model, Input>["typeIndex"] {
  return {
    async findAll(classes) {
      const found = new Map<string, string[]>(classes.map((cls) => [cls, []]));
      for await (const entry of storage.listAll(storage.root)) {
        for (const cls of classes) if (entry.types.includes(cls)) found.get(cls)?.push(entry.url);
      }
      return found;
    },
    async register(cls) {
      return { links: [{ rel: "type", target: cls }] };
    },
  };
}

export interface Harness {
  protocol: Protocol;
  storage: StorageClient;
  /** The storage the store sees (possibly wrapped). */
  seen: StorageClient;
  store: MediaStore<Model, Input>;
  options: MediaStoreOptions<Model, Input>;
  reopen(overrides?: Partial<MediaStoreOptions<Model, Input>>): Promise<MediaStore<Model, Input>>;
}

export async function harness(
  protocol: Protocol,
  overrides: Partial<MediaStoreOptions<Model, Input>> = {},
  wrap: (storage: StorageClient) => StorageClient = (storage) => storage,
  pageSize?: number,
): Promise<Harness> {
  const storage = createMemoryStorage({
    protocol,
    root: ROOT,
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  if (protocol === "solid") {
    await storage.write(`${ROOT}profile/card`, `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, {
      contentType: "text/turtle",
      ifMatch: "*",
    });
  }
  const seen = wrap(storage);
  const typeIndex =
    protocol === "solid"
      ? createTypeIndex({ storage: seen, features: storage.features, profile: WEBID })
      : lwsTypeIndex(seen);
  const options: MediaStoreOptions<Model, Input> = {
    storage: seen,
    features: storage.features,
    typeIndex,
    classes: [CLASS],
    defaultContainerName: "media",
    parse: parseModel,
    build: buildModel,
    locate: (value) => ({ binaryUrl: value.binaryUrl, thumbnailUrl: value.thumbnailUrl }),
    sleep: async () => {},
    ...overrides,
  };
  const reopen = async (more: Partial<MediaStoreOptions<Model, Input>> = {}) => {
    const opened = await openMediaStore({ ...options, ...more });
    if (!opened.ok) throw new Error(`open failed: ${opened.error.reason}`);
    return opened.value;
  };
  return { protocol, storage, seen, options, store: await reopen(), reopen };
}

type Hook = (call: { method: string; args: unknown[]; n: number }) => Promise<void> | void;
const HOOKED = new Set(["create", "write", "read", "head", "delete", "list"]);

/** Wrap a storage so `before` runs ahead of each mutating or reading call (fault injection). */
export function intercept(
  storage: StorageClient,
  before: Hook,
  after?: (call: { method: string; args: unknown[] }, result: unknown) => Promise<void> | void,
): StorageClient {
  let n = 0;
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property === "listAll") {
        return async function* (...args: unknown[]) {
          await before({ method: "listAll", args, n: ++n });
          yield* (value as (...a: unknown[]) => AsyncIterable<unknown>).apply(target, args);
        };
      }
      if (!HOOKED.has(String(property))) return value.bind(target);
      return async (...args: unknown[]) => {
        await before({ method: String(property), args, n: ++n });
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        await after?.({ method: String(property), args }, result);
        return result;
      };
    },
  });
}

/** Every resource (not container) under the storage root. */
export async function allResources(storage: StorageClient): Promise<string[]> {
  const out: string[] = [];
  const walk = async (container: string) => {
    for await (const entry of storage.listAll(container)) {
      if (entry.kind === "container") await walk(entry.url);
      else out.push(entry.url);
    }
  };
  await walk(storage.root);
  return out.filter(
    (url) => !url.startsWith(`${ROOT}profile/`) && !url.startsWith(`${ROOT}settings/`),
  );
}

export async function text(storage: StorageClient, url: string): Promise<string> {
  return (await storage.read(url)).text();
}

export async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** LWS-like server: ignores the requested name and picks its own. */
export function serverNames(storage: StorageClient): StorageClient {
  let counter = 0;
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property !== "create") return value.bind(target);
      return (container: string, body: unknown, options: Record<string, unknown> = {}) =>
        target.create(container, body as never, { ...options, name: `srv${++counter}` });
    },
  });
}

/** The shard container the put of `AT` lands in. */
export function shardOf(store: { library: string | null }): string {
  return `${store.library}2026/05/`;
}

export function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`unexpected failure ${JSON.stringify(result.error)}`);
  return result.value;
}
