// AUTHORED-BY Codex GPT-6.1-Sol
// LWS read side (ADR-003 §7, T-023); mutations arrive with T-024.
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import { StorageError } from "./errors.js";
import { dateOf, discard, linksOf, mediaTypeOf, type ReadShape, scoped } from "./http.js";
import { paginate, throwIfAborted } from "./internal.js";
import {
  acceptReadStatus,
  createReadOperations,
  MEDIA_TYPE,
  type ReadExpectation,
} from "./read.js";
import type { AuthFetch, Entry, MetadataLink, ReadResult, StorageClient } from "./types.js";

const LWS = "https://www.w3.org/ns/lws#";
/** A hard byte limit, enforced while streaming (never trust Content-Length). */
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const LIST_ACCEPT = "application/lws+json, application/ld+json;q=0.5";

export interface LwsBackendOptions {
  /** Authenticated fetch (pod-auth). */
  fetch: AuthFetch;
  /** StorageRoot container URL; every request must stay within it. */
  root: string;
  /** Absolute HTTP(S) StorageDescription.id; normalised once. Default: root (as sparq emits). */
  storage?: string;
  /** Resolved features; default: an undescribed LWS storage. */
  features?: Features;
}

function invalid(url: string, message: string): StorageError {
  return new StorageError("invalid-response", { method: "GET", url, message });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typesOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((type): type is string => typeof type === "string")
    : [];
}

function hasType(types: string[], name: string): boolean {
  return types.includes(name) || types.includes(`${LWS}${name}`);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Resolve only URL data; this does not authorise requests to it. */
function resolve(value: string, base: string): string | null {
  return URL.canParse(value, base) ? new URL(value, base).href : null;
}

/** Bounded JSON collection, with transport errors kept as network errors. */
async function jsonBody(
  result: ReadResult,
  accepted: string[],
  signal?: AbortSignal,
): Promise<unknown> {
  if (!accepted.includes(mediaTypeOf(result.contentType) ?? "")) {
    discard(result.body);
    throw invalid(result.url, "Unexpected JSON media type");
  }
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (result.body) {
    const reader = result.body.getReader();
    const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      throwIfAborted("GET", result.url, signal);
      for (;;) {
        const chunk = await reader.read();
        throwIfAborted("GET", result.url, signal);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_JSON_BYTES) {
          cancel();
          throw invalid(result.url, "JSON exceeds 16 MiB");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      signal?.removeEventListener("abort", cancel);
      // Also releases an unread body when already aborted before collection.
      cancel();
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(result.url, "Invalid JSON");
  }
}

/** RFC 9264 §4.2: anchors and targets resolve against the delivering linkset URL. */
function linksetOf(raw: unknown, url: string): Map<string, Map<string, MetadataLink[]>> {
  if (!object(raw) || !Array.isArray(raw.linkset)) throw invalid(url, "Expected linkset array");
  const links = new Map<string, Map<string, MetadataLink[]>>();
  for (const context of raw.linkset) {
    if (!object(context) || typeof context.anchor !== "string")
      throw invalid(url, "Missing anchor");
    const anchor = resolve(context.anchor, url);
    if (anchor === null || !/^https?:/.test(anchor)) throw invalid(url, "Invalid anchor URL");
    const rels = links.get(anchor) ?? new Map<string, MetadataLink[]>();
    for (const [rel, targets] of Object.entries(context)) {
      if (rel === "anchor") continue;
      if (!Array.isArray(targets)) throw invalid(url, "Expected relation target array");
      const normalised = rels.get(rel) ?? [];
      for (const target of targets) {
        if (!object(target) || typeof target.href !== "string") throw invalid(url, "Missing href");
        const href = resolve(target.href, url);
        if (href === null) throw invalid(url, "Invalid target URL");
        // Keep only string attributes; RFC 9264 arrays (hreflang/title*) are left in raw.
        const params = Object.fromEntries(
          Object.entries(target).filter(
            ([key, value]) => key !== "href" && typeof value === "string",
          ),
        ) as Record<string, string>;
        normalised.push({ href, params });
      }
      rels.set(rel, normalised);
    }
    links.set(anchor, rels);
  }
  return links;
}

function writesPending(method: string, url: string): Promise<never> {
  return Promise.reject(
    new StorageError("unsupported", {
      method,
      url,
      message: `${method} on the LWS backend is not available yet (T-024)`,
    }),
  );
}

/** Create the LWS StorageClient. Read operations only; mutations reject with `unsupported`. */
export function createLwsBackend(options: LwsBackendOptions): StorageClient {
  const root = scoped(options.root, "GET", options.root);
  if (!root.endsWith("/") || /[?#]/.test(root))
    throw new TypeError("root must be a container URL ending with '/'");
  const storage = new URL(options.storage ?? root).href;
  if (!/^https?:/.test(storage)) throw new TypeError("storage must be an absolute http(s) URL");
  const features =
    options.features ??
    deriveFeatures({
      protocol: "lws",
      id: storage,
      root,
      descriptionUrl: null,
      services: [],
      capabilities: [],
      sources: ["probe"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
    });
  const isWithinStorage = (url: string) => URL.canParse(url) && isWithinPodScope(root, url);
  const isRoot = (url: string) => {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href === root;
  };
  const safeLink = (url: string | undefined) =>
    url !== undefined && isWithinStorage(url) ? url : null;

  async function shapeOf(
    method: string,
    url: string,
    response: Response,
    expect: ReadExpectation,
  ): Promise<ReadShape> {
    const links = linksOf(response, url, method);
    if ((links.get(`${LWS}storage`) ?? []).some(({ target }) => target !== storage)) {
      discard(response.body);
      throw new StorageError("scope", {
        method,
        url,
        message: `${method} ${url} advertises a foreign storage`,
      });
    }
    await acceptReadStatus(method, url, response, expect);
    const status = response.status as 200 | 206 | 304;
    return {
      status,
      links,
      kind:
        isRoot(url) || (links.get("type") ?? []).some(({ target }) => target === `${LWS}Container`)
          ? "container"
          : "resource",
      parent: isRoot(url) ? null : safeLink(links.get("up")?.[0]?.target),
      metadataUrl: safeLink(links.get("linkset")?.[0]?.target),
      allow: null,
      withBody: method === "GET" && status !== 304,
    };
  }
  const { get, head, read, readRdf } = createReadOperations(options.fetch, root, shapeOf);

  const client: StorageClient = {
    protocol: "lws",
    root,
    features,
    head,
    read,
    readRdf,
    isWithinStorage,
    async list(url, opts = {}) {
      const container = scoped(root, "GET", url);
      if (!container.endsWith("/") || /[?#]/.test(container))
        throw new StorageError("bad-request", {
          method: "GET",
          url: container,
          message: "list() takes a container URL ending with '/' without a query or fragment",
        });
      const result = await get(
        opts.cursor === undefined ? container : opts.cursor.url,
        { Accept: LIST_ACCEPT },
        opts.signal,
      );
      const raw = await jsonBody(
        result,
        ["application/lws+json", "application/ld+json"],
        opts.signal,
      );
      if (
        !object(raw) ||
        !(hasType(typesOf(raw.type), "Container") || hasType(typesOf(raw.type), "ContainerPage")) ||
        !Array.isArray(raw.items)
      )
        throw invalid(result.url, "Expected Container or ContainerPage with items array");
      const seen = new Set<string>();
      const items: Entry[] = [];
      for (const item of raw.items) {
        if (!object(item) || typeof item.id !== "string")
          throw invalid(result.url, "Expected item with string id");
        const id = resolve(item.id, result.url);
        if (id === null || !isWithinStorage(id) || seen.has(id)) continue;
        seen.add(id);
        const types = typesOf(item.type);
        const kind = hasType(types, "Container") ? "container" : "resource";
        items.push({
          url: id,
          kind,
          contentType:
            kind !== "container" && typeof item.format === "string" && MEDIA_TYPE.test(item.format)
              ? item.format
              : null,
          size: count(item.size),
          modified: typeof item.modified === "string" ? dateOf(item.modified) : null,
          types: types.filter(
            (type) =>
              !["Container", "DataResource", `${LWS}Container`, `${LWS}DataResource`].includes(
                type,
              ) &&
              /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]*$/i.test(type) &&
              URL.canParse(type),
          ),
        });
      }
      const next = result.links.get("next")?.[0]?.target;
      if (next !== undefined && (!isWithinStorage(next) || next === new URL(result.url).href))
        throw invalid(result.url, "Invalid next page URL");
      return {
        items,
        next: next === undefined ? null : { url: next },
        total: count(raw.totalItems),
        etag: result.etag,
      };
    },
    listAll(url, opts = {}) {
      return paginate(
        url,
        (cursor) => client.list(url, { cursor, signal: opts.signal }),
        opts.signal,
      );
    },
    async metadata(url) {
      const described = await head(url);
      if (described.metadataUrl === null)
        throw new StorageError("unsupported", {
          method: "GET",
          url: described.url,
          message: `${described.url} advertises no linkset metadata`,
        });
      const result = await get(
        described.metadataUrl,
        { Accept: "application/linkset+json" },
        undefined,
      );
      const raw = await jsonBody(result, ["application/linkset+json", "application/json"]);
      return { url: result.url, etag: result.etag, raw, links: linksetOf(raw, result.url) };
    },
    async parentOf(url) {
      const target = scoped(root, "HEAD", url);
      return isRoot(target) ? null : (await head(target)).parent;
    },
    write: (url) => writesPending("PUT", url),
    writeRdf: (url) => writesPending("PUT", url),
    create: (url) => writesPending("POST", url),
    patch: (url) => writesPending("PATCH", url),
    move: (url) => writesPending("MOVE", url),
    delete: (url) => writesPending("DELETE", url),
    setMetadata: (url) => writesPending("PATCH", url),
  };
  return client;
}
