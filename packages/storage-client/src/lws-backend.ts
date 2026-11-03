// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// LWS backend (ADR-003 §7, T-023/T-024).
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import { StorageError } from "./errors.js";
import {
  boundedText,
  dateOf,
  discard,
  linksOf,
  listingContainer,
  mediaTypeOf,
  type ReadShape,
  scoped,
} from "./http.js";
import { listingTooLarge, paginate, validateListingMaxBytes } from "./internal.js";
import { lwsWrites } from "./lws-write.js";
import {
  acceptReadStatus,
  createReadOperations,
  MEDIA_TYPE,
  type ReadExpectation,
} from "./read.js";
import { versionHistoryQuery } from "./services.js";
import type { AuthFetch, Entry, MetadataLink, ReadResult, StorageClient } from "./types.js";

const LWS = "https://www.w3.org/ns/lws#";
/** A hard byte limit, enforced while streaming (never trust Content-Length). */
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_LIST_ITEMS = 10000;
/** Maximum canonical next cursor length, measured in UTF-16 code units. */
const MAX_CURSOR_LENGTH = 8192;
/** Cumulative resolved item id lengths, measured in UTF-16 code units before filtering. */
const MAX_LIST_URL_LENGTH = 4 * 1024 * 1024;
const MAX_LINKSET_TARGETS = 10000;
/** Cumulative resolved anchor + href lengths, measured in UTF-16 code units. */
const MAX_LINKSET_URL_BYTES = 4 * 1024 * 1024;
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
export async function jsonBody(
  result: Pick<ReadResult, "url" | "contentType" | "body">,
  accepted: string[],
  signal?: AbortSignal,
  maxBytes?: number,
): Promise<unknown> {
  if (!accepted.includes(mediaTypeOf(result.contentType) ?? "")) {
    discard(result.body);
    throw invalid(result.url, "Unexpected JSON media type");
  }
  const text = await boundedText(
    result,
    Math.min(maxBytes ?? MAX_JSON_BYTES, MAX_JSON_BYTES),
    maxBytes !== undefined && maxBytes <= MAX_JSON_BYTES
      ? listingTooLarge(result.url, maxBytes)
      : invalid(result.url, "JSON exceeds 16 MiB"),
    signal,
  );
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(result.url, "Invalid JSON");
  }
}

/** RFC 9264 §4.2: anchors and targets resolve against the delivering linkset URL. */
export function linksetOf(raw: unknown, url: string): Map<string, Map<string, MetadataLink[]>> {
  if (!object(raw) || !Array.isArray(raw.linkset)) throw invalid(url, "Expected linkset array");
  const links = new Map<string, Map<string, MetadataLink[]>>();
  let targetCount = 0;
  let urlBytes = 0;
  const countUrl = (value: string) => {
    urlBytes += value.length;
    if (urlBytes > MAX_LINKSET_URL_BYTES) throw invalid(url, "Resolved linkset URLs exceed 4 MiB");
  };
  for (const context of raw.linkset) {
    if (!object(context) || typeof context.anchor !== "string")
      throw invalid(url, "Missing anchor");
    const anchor = resolve(context.anchor, url);
    if (anchor === null || !/^https?:/.test(anchor)) throw invalid(url, "Invalid anchor URL");
    countUrl(anchor);
    const rels = links.get(anchor) ?? new Map<string, MetadataLink[]>();
    for (const [rel, targets] of Object.entries(context)) {
      if (rel === "anchor") continue;
      if (!Array.isArray(targets)) throw invalid(url, "Expected relation target array");
      const normalised = rels.get(rel) ?? [];
      for (const target of targets) {
        if (++targetCount > MAX_LINKSET_TARGETS)
          throw invalid(url, "Linkset exceeds 10000 targets");
        if (!object(target) || typeof target.href !== "string") throw invalid(url, "Missing href");
        const href = resolve(target.href, url);
        if (href === null) throw invalid(url, "Invalid target URL");
        countUrl(href);
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

/** Create a scoped LWS StorageClient with conditional mutations. */
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
  const isWithinStorage = (url: string) => {
    try {
      scoped(root, "GET", url);
      return true;
    } catch {
      return false;
    }
  };
  const isRoot = (url: string) => {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href === root;
  };
  const safeLink = (url: string | undefined) =>
    url !== undefined && isWithinStorage(url) ? url : null;

  function inspect(method: string, url: string, response: Response) {
    const links = linksOf(response, url, method);
    if ((links.get(`${LWS}storage`) ?? []).some(({ target }) => target !== storage)) {
      discard(response.body);
      throw new StorageError("scope", {
        method,
        url,
        message: `${method} ${url} advertises a foreign storage`,
      });
    }
    return links;
  }
  async function shapeOf(
    method: string,
    url: string,
    response: Response,
    expect: ReadExpectation,
  ): Promise<ReadShape> {
    const links = inspect(method, url, response);
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
  async function metadata(url: string, signal?: AbortSignal, described?: ReadResult) {
    described ??= await head(url, { signal });
    if (described.metadataUrl === null)
      throw new StorageError("unsupported", {
        method: "GET",
        url: described.url,
        message: `${described.url} advertises no linkset metadata`,
      });
    const result = await get(described.metadataUrl, { Accept: "application/linkset+json" }, signal);
    const raw = await jsonBody(result, ["application/linkset+json", "application/json"], signal);
    return { url: result.url, etag: result.etag, raw, links: linksetOf(raw, result.url) };
  }

  // Container identifiers may be slashless; validate the representation rather than URL shape.
  // Also used by recursive deletion, after HEAD confirms a scoped target is a container.
  const list: StorageClient["list"] = async (container, opts = {}) => {
    validateListingMaxBytes(opts.maxBytes);
    const result = await get(
      opts.cursor === undefined ? container : opts.cursor.url,
      { Accept: LIST_ACCEPT },
      opts.signal,
      false,
      opts.revalidate,
      opts.headers,
    );
    const raw = await jsonBody(
      result,
      ["application/lws+json", "application/ld+json"],
      opts.signal,
      opts.maxBytes,
    );
    if (
      !object(raw) ||
      !(hasType(typesOf(raw.type), "Container") || hasType(typesOf(raw.type), "ContainerPage")) ||
      !Array.isArray(raw.items)
    )
      throw invalid(result.url, "Expected Container or ContainerPage with items array");
    if (raw.items.length > MAX_LIST_ITEMS) throw invalid(result.url, "Listing exceeds 10000 items");
    const seen = new Set<string>();
    const items: Entry[] = [];
    let urlLength = 0;
    for (const item of raw.items) {
      if (!object(item) || typeof item.id !== "string")
        throw invalid(result.url, "Expected item with string id");
      const id = resolve(item.id, result.url);
      if (id === null) continue;
      urlLength += id.length;
      if (urlLength > MAX_LIST_URL_LENGTH)
        throw invalid(result.url, "Resolved listing IDs exceed 4 MiB");
      if (!isWithinStorage(id) || seen.has(id)) continue;
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
    const nextLink = result.links.get("next")?.[0]?.target;
    let next: string | null = null;
    if (nextLink !== undefined) {
      try {
        next = scoped(root, "GET", nextLink);
      } catch {
        throw invalid(result.url, "Invalid next page URL");
      }
      if (next.length > MAX_CURSOR_LENGTH || next === result.url)
        throw invalid(result.url, "Invalid next page URL");
    }
    return {
      items,
      next: next === null ? null : { url: next },
      total: count(raw.totalItems),
      etag: result.etag,
    };
  };

  const client: StorageClient = {
    protocol: "lws",
    root,
    features,
    head,
    read,
    readRdf,
    isWithinStorage,
    async list(url, opts) {
      return list(listingContainer(root, url, versionHistoryQuery(features, root, url)), opts);
    },
    async *listAll(url, opts = {}) {
      const container = listingContainer(root, url, versionHistoryQuery(features, root, url));
      yield* paginate(
        container,
        (cursor) => client.list(container, { ...opts, cursor }),
        opts.signal,
      );
    },
    metadata,
    async parentOf(url) {
      const target = scoped(root, "HEAD", url);
      return isRoot(target) ? null : (await head(target)).parent;
    },
    ...lwsWrites({ ...options, root }, () => client, inspect, metadata, list),
  };
  return client;
}
