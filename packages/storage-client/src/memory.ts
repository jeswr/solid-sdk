// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * `createMemoryStorage()`: a faithful in-memory StorageClient (ADR-003 §8) for unit tests and as
 * the conformance reference. It reproduces ETags (monotonic), 412/428 semantics, container
 * membership and totalItems, LWS paging, linksets with `up`, the MoveResource toggle,
 * N3-Patch-equivalent quad application and RFC 6902 JSON Patch.
 */

import type { Quad } from "@jeswr/fetch-rdf";
import { parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { escapeIri } from "@jeswr/rdf-serialize";
import {
  deriveFeatures,
  type Features,
  type StorageDescription,
} from "@jeswr/storage-capabilities";
import { LWS, SSD } from "@jeswr/storage-capabilities/vocab";
import { DataFactory, Store } from "n3";
import { StorageError, type StorageErrorCode } from "./errors.js";
import { isWithin, paginate, pathParent, throwIfAborted, toBytes } from "./internal.js";
import { applyJsonPatch, type JsonPatchError } from "./json-patch.js";
import {
  applyQuadPatch,
  mediaType,
  type RdfPatchError,
  serializeQuads,
  TRIPLE_FORMATS,
  WRITABLE_RDF,
} from "./rdf.js";
import type {
  CreateOptions,
  Entry,
  LinkTarget,
  Metadata,
  MetadataLink,
  MetadataOp,
  Page,
  PageCursor,
  Patch,
  RdfReadResult,
  ReadResult,
  ResourceKind,
  StorageClient,
} from "./types.js";

export interface MemoryStorageOptions {
  /** Which server behaviour to reproduce. Default 'solid'. */
  protocol?: "solid" | "lws";
  /** Storage root (must end with '/'). Default 'https://memory.example/'. */
  root?: string;
  /** LWS page size for listings. Default 50. */
  pageSize?: number;
  /** LWS: advertise and honour MoveResource. Default false. */
  moveResource?: boolean;
  /**
   * Default true: a mutation without `ifMatch` throws a TypeError, so apps cannot be written
   * against the memory backend incorrectly. Set false to reach the emulated server instead
   * (Solid accepts the unconditional write; LWS answers 428).
   */
  strictConditional?: boolean;
  clock?: () => number;
}

export type MemoryStorage = StorageClient;
export type { StorageClient } from "./types.js";

const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const IANA_REL = "http://www.iana.org/assignments/relation/";
const LWS_CONTAINER = "https://www.w3.org/ns/lws#Container";
const LWS_DATA_RESOURCE = "https://www.w3.org/ns/lws#DataResource";
const LWS_SERVER_RELS = new Set(["linkset", "type", "up"]);
const RDF_READABLE: ReadonlySet<string> = new Set(SUPPORTED_RDF_MEDIA_TYPES);
const MAX_EMULATED_MOVE = 2_000;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

interface UserLink {
  anchor: string;
  rel: string;
  href: string;
}
interface Node {
  url: string;
  kind: ResourceKind;
  parent: string | null;
  body: Uint8Array;
  contentType: string | null;
  etag: string;
  metaEtag: string;
  modified: number;
  types: string[];
  links: UserLink[];
}

function slug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => BASE32[byte % 32]).join("");
}

function relIri(rel: string): string {
  return rel.includes(":") ? rel : `${IANA_REL}${rel.toLowerCase()}`;
}

function canonical(url: string): boolean {
  try {
    return new URL(url).href === url && escapeIri(url) === url;
  } catch {
    return false;
  }
}

export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryStorage {
  const protocol = options.protocol ?? "solid";
  const lws = protocol === "lws";
  const root = options.root ?? "https://memory.example/";
  const parsedRoot = new URL(root);
  if (!root.endsWith("/") || parsedRoot.href !== root || parsedRoot.search || parsedRoot.hash) {
    throw new TypeError("root must be a normalised URL ending with '/'");
  }
  const pageSize = options.pageSize ?? 50;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError("pageSize must be a positive integer");
  }
  const moveResource = lws && options.moveResource === true;
  const strict = options.strictConditional ?? true;
  const clock = options.clock ?? Date.now;
  let counter = 0;
  const nextEtag = () => `"${++counter}"`;
  const nodes = new Map<string, Node>();

  const description: StorageDescription = {
    protocol,
    id: lws ? `${root}.well-known/storage` : root,
    root,
    descriptionUrl: lws ? `${root}.well-known/storage` : `${root}.well-known/solid`,
    services: lws ? [{ type: [LWS.StorageRoot], endpoint: root, extra: {} }] : [],
    capabilities: [
      ...(moveResource
        ? [
            {
              type: [LWS.MoveResource],
              extra: { appliesTo: ["DataResource", "Container"], preservesIdentifier: false },
            },
          ]
        : []),
      {
        type: [SSD.PatchSupport],
        extra: {
          format: {
            "text/turtle": ["text/n3"],
            "application/json": ["application/json-patch+json"],
          },
        },
      },
    ],
    sources: [lws ? "lws-cid" : "solid-description"],
    fetchedAt: clock(),
    etag: null,
    maxAgeMs: Number.MAX_SAFE_INTEGER,
    verificationMethods: [],
  };
  const features: Features = deriveFeatures(description);

  const now = clock();
  nodes.set(root, {
    url: root,
    kind: "container",
    parent: null,
    body: new Uint8Array(),
    contentType: null,
    etag: nextEtag(),
    metaEtag: nextEtag(),
    modified: now,
    types: [],
    links: [],
  });

  const fail = (
    code: StorageErrorCode,
    method: string,
    url: string,
    status: number | null,
    extra: {
      etag?: string | null;
      feature?: keyof Features;
      message?: string;
      cause?: unknown;
    } = {},
  ) => new StorageError(code, { status, url, method, ...extra });

  function begin(method: string, url: string, signal?: AbortSignal): void {
    throwIfAborted(method, url, signal);
    // Only canonical, IRI-safe URLs are stored, so listings can never carry Turtle delimiters.
    if (!canonical(url)) {
      throw fail("bad-request", method, url, 400, {
        message: `${JSON.stringify(url)} is not a canonical URL`,
      });
    }
    if (!isWithin(url, root)) {
      throw fail("scope", method, url, null, { message: `${url} is outside ${root}` });
    }
  }

  function need(method: string, url: string): Node {
    const node = nodes.get(url);
    if (!node) throw fail("not-found", method, url, 404);
    return node;
  }

  function container(method: string, url: string): Node {
    const node = need(method, url);
    if (node.kind !== "container") {
      throw fail("method-not-allowed", method, url, 405, { message: `${url} is not a container` });
    }
    return node;
  }

  /**
   * Missing precondition: TypeError in strict mode; otherwise LWS 428 and Solid proceeds.
   * ADR-003 §3: `'*'` is accepted only by `write` (`allowAny`); elsewhere it is a TypeError.
   */
  function conditional(
    method: string,
    url: string,
    ifMatch: string | undefined,
    allowAny = false,
  ): string | undefined {
    if (ifMatch === "*" && !allowAny) {
      throw new TypeError(`${method} ${url}: ifMatch '*' is only allowed on write()`);
    }
    if (typeof ifMatch === "string" && ifMatch !== "") return ifMatch;
    if (strict) {
      throw new TypeError(`${method} ${url}: ifMatch is required (ETag or '*')`);
    }
    if (lws) throw fail("precondition-required", method, url, 428);
    return undefined;
  }

  function checkEtag(
    method: string,
    url: string,
    node: Node | undefined,
    ifMatch: string | undefined,
  ) {
    if (ifMatch === undefined || ifMatch === "*") return;
    if (!node || node.etag !== ifMatch) {
      throw fail("precondition-failed", method, url, 412, { etag: node?.etag ?? null });
    }
  }

  function children(url: string): Node[] {
    return [...nodes.values()]
      .filter((node) => node.parent === url)
      .sort((a, b) => (a.url < b.url ? -1 : 1));
  }

  function subtree(url: string): Node[] {
    const result: Node[] = [];
    const visit = (node: Node) => {
      result.push(node);
      for (const child of children(node.url)) visit(child);
    };
    visit(need("GET", url));
    return result;
  }

  /** Bump a container's ETag after a membership change (the container always exists). */
  function touch(url: string | null): void {
    const node = nodes.get(url as string) as Node;
    node.etag = nextEtag();
    node.modified = clock();
  }

  function entry(node: Node): Entry {
    return {
      url: node.url,
      kind: node.kind,
      contentType: node.kind === "container" ? null : node.contentType,
      size: node.kind === "container" ? null : node.body.byteLength,
      modified: new Date(node.modified),
      types: [...node.types],
    };
  }

  const metadataUrl = (url: string) => (lws ? `${url}.linkset` : `${url}.meta`);

  function headerLinks(node: Node): Map<string, LinkTarget[]> {
    const links = new Map<string, LinkTarget[]>();
    const push = (rel: string, target: string) =>
      links.set(rel, [...(links.get(rel) ?? []), { target, params: {} }]);
    if (lws) {
      push("type", node.kind === "container" ? LWS_CONTAINER : LWS_DATA_RESOURCE);
      for (const type of node.types) push("type", type);
      if (node.parent !== null) push("up", node.parent);
      push("linkset", metadataUrl(node.url));
    } else {
      push("type", `${LDP}Resource`);
      if (node.kind === "container") {
        push("type", `${LDP}Container`);
        push("type", `${LDP}BasicContainer`);
      }
      if (node.url === root) push("type", "http://www.w3.org/ns/pim/space#Storage");
      push("describedby", metadataUrl(node.url));
    }
    return links;
  }

  /**
   * The representation of a snapshot node. Everything is captured synchronously before the only
   * await, so bytes, ETag and links always describe the same state. LWS containers are paged
   * (`page` is 1-based) and expose `rel=next` like `list()`.
   */
  async function representation(
    node: Node,
    page = 1,
  ): Promise<{ bytes: Uint8Array; contentType: string; next: string | null }> {
    if (node.kind !== "container") {
      // Resources always carry the contentType they were written with.
      return { bytes: node.body, contentType: node.contentType as string, next: null };
    }
    if (lws) {
      const items = children(node.url);
      const start = (page - 1) * pageSize;
      return {
        next: start + pageSize < items.length ? `${node.url}?page=${page + 1}` : null,
        bytes: new TextEncoder().encode(
          JSON.stringify({
            id: node.url,
            type: "Container",
            totalItems: items.length,
            items: items.slice(start, start + pageSize).map((child) => ({
              id: child.url,
              type: child.kind === "container" ? "Container" : "DataResource",
              ...(child.kind === "container"
                ? {}
                : { format: child.contentType, size: child.body.byteLength }),
              modified: new Date(child.modified).toISOString(),
            })),
          }),
        ),
        contentType: "application/lws+json",
      };
    }
    const { namedNode, quad } = DataFactory;
    const self = namedNode(node.url);
    const quads: Quad[] = [
      quad(self, namedNode(RDF_TYPE), namedNode(`${LDP}Container`)),
      quad(self, namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      ...children(node.url).map((child) =>
        quad(self, namedNode(`${LDP}contains`), namedNode(child.url)),
      ),
    ];
    return {
      bytes: new TextEncoder().encode(await serializeQuads(quads, "text/turtle")),
      contentType: "text/turtle",
      next: null,
    };
  }

  /** Resolve a read target: an LWS `container?page=N` URL addresses one page of a container. */
  function target(method: string, url: string): { node: Node; page: number } {
    const match = lws ? /^(.*\/)\?page=([1-9]\d{0,8})$/.exec(url) : null;
    // Only containers end in '/', so a matched base is always a container.
    const node = need(method, match ? (match[1] as string) : url);
    // Snapshot: later mutations replace fields, they never alter this copy.
    return {
      node: { ...node, links: [...node.links], types: [...node.types] },
      page: match ? Number(match[2]) : 1,
    };
  }

  function readResult(
    node: Node,
    status: 200 | 206 | 304,
    bytes: Uint8Array | null,
    contentType: string,
    next: string | null,
    requestUrl: string,
  ): ReadResult {
    const data = bytes ?? new Uint8Array();
    const links = headerLinks(node);
    if (next !== null) links.set("next", [{ target: next, params: {} }]);
    return {
      url: requestUrl,
      status,
      etag: node.etag,
      contentType,
      lastModified: new Date(node.modified),
      body: bytes === null ? null : new Blob([data.slice()]).stream(),
      bytes: async () => data.slice(),
      text: async () => new TextDecoder().decode(data),
      blob: async () => new Blob([data.slice()], { type: contentType }),
      links,
      parent: node.parent,
      metadataUrl: metadataUrl(node.url),
      kind: node.kind,
      allow: lws ? null : { read: true, write: true, append: true, control: true },
    };
  }

  function nameFor(method: string, url: string, name: string | undefined): string | undefined {
    if (name === undefined) return undefined;
    if (
      name === "" ||
      name === "." ||
      name === ".." ||
      [...name].some((char) => (char.codePointAt(0) as number) < 0x20)
    ) {
      throw fail("bad-request", method, url, 400, {
        message: `Invalid name: ${JSON.stringify(name)}`,
      });
    }
    return encodeURIComponent(name);
  }

  function freeUrl(parent: string, base: string, kind: ResourceKind): string {
    const suffix = kind === "container" ? "/" : "";
    let candidate = `${parent}${base}${suffix}`;
    for (
      let n = 1;
      nodes.has(candidate) || nodes.has(candidate.replace(/\/$/, "")) || nodes.has(`${candidate}/`);
      n++
    ) {
      candidate = `${parent}${base}-${n}${suffix}`;
    }
    return candidate;
  }

  function ensureContainers(method: string, url: string): void {
    // Never called for the root, so a parent always exists.
    const parent = pathParent(url, root) as string;
    if (nodes.has(parent)) {
      container(method, parent);
      return;
    }
    ensureContainers(method, parent);
    if (nodes.has(parent.slice(0, -1))) {
      throw fail("conflict", method, url, 409, { message: `${parent.slice(0, -1)} is a resource` });
    }
    const time = clock();
    nodes.set(parent, {
      url: parent,
      kind: "container",
      parent: pathParent(parent, root),
      body: new Uint8Array(),
      contentType: null,
      etag: nextEtag(),
      metaEtag: nextEtag(),
      modified: time,
      types: [],
      links: [],
    });
    touch(pathParent(parent, root));
  }

  function listPage(url: string, cursor: PageCursor | undefined): Page<Entry> {
    const node = container("GET", url);
    const items = children(url);
    if (!lws) {
      if (cursor !== undefined)
        throw fail("bad-request", "GET", cursor.url, 400, {
          message: "Solid listings have one page",
        });
      return { items: items.map(entry), next: null, total: items.length, etag: node.etag };
    }
    let page = 1;
    if (cursor !== undefined) {
      const match = /^(.*)\?page=([1-9]\d*)$/.exec(cursor.url);
      if (!match || match[1] !== url) {
        throw fail("bad-request", "GET", cursor.url, 400, { message: "Unknown page cursor" });
      }
      page = Number(match[2]);
    }
    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    return {
      items: slice.map(entry),
      next: start + pageSize < items.length ? { url: `${url}?page=${page + 1}` } : null,
      total: items.length,
      etag: node.etag,
    };
  }

  /** `url` is `base` itself, a fragment of it, or (for a container base) a descendant. */
  const within = (url: string, base: string): boolean =>
    url === base || url.startsWith(`${base}#`) || (base.endsWith("/") && url.startsWith(base));

  function relocate(node: Node, from: string, to: string, parent: string): void {
    for (const moved of subtree(node.url)) {
      nodes.delete(moved.url);
      const url = to + moved.url.slice(from.length);
      moved.parent = moved === node ? parent : to + (moved.parent as string).slice(from.length);
      for (const link of moved.links) {
        if (within(link.anchor, from)) link.anchor = to + link.anchor.slice(from.length);
      }
      moved.url = url;
      moved.etag = nextEtag();
      moved.metaEtag = nextEtag();
      nodes.set(url, moved);
    }
  }

  // Mutations run one at a time, like a server applying requests atomically: an ETag check and
  // the commit can never be split by another mutation across an await.
  let queue: Promise<unknown> = Promise.resolve();
  // A queued caller whose signal fires is rejected at once; its turn then fails fast in begin().
  const serial =
    <A extends [string, ...unknown[]], R>(method: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      const run = queue.then(() => fn(...args));
      queue = run.catch(() => undefined);
      const options = args.at(-1) as { signal?: unknown } | null | undefined;
      const signal = options?.signal instanceof AbortSignal ? options.signal : undefined;
      if (!signal) return run;
      return new Promise<R>((resolve, reject) => {
        const abort = () => {
          try {
            throwIfAborted(method, args[0], signal);
          } catch (error) {
            reject(error);
          }
        };
        signal.addEventListener("abort", abort, { once: true });
        abort();
        run.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    };

  const client: MemoryStorage = {
    protocol,
    root,
    features,

    async list(url, opts = {}) {
      begin("GET", url, opts.signal);
      return listPage(url, opts.cursor);
    },

    listAll(url, opts = {}) {
      return paginate(
        url,
        async (cursor) => client.list(url, { cursor, signal: opts.signal }),
        opts.signal,
      );
    },

    async head(url, opts = {}) {
      begin("HEAD", url, opts.signal);
      const { node, page } = target("HEAD", url);
      const { contentType, next } = await representation(node, page);
      return readResult(node, 200, null, contentType, next, url);
    },

    async read(url, opts = {}) {
      begin("GET", url, opts.signal);
      const { node, page } = target("GET", url);
      const { bytes, contentType, next } = await representation(node, page);
      if (
        opts.ifNoneMatch !== undefined &&
        (opts.ifNoneMatch === "*" || opts.ifNoneMatch === node.etag)
      ) {
        return readResult(node, 304, null, contentType, next, url);
      }
      if (opts.range) {
        const { start, end = bytes.byteLength - 1 } = opts.range;
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          start >= bytes.byteLength ||
          !Number.isSafeInteger(end) ||
          end < start
        ) {
          throw fail("bad-request", "GET", url, 416, { message: "Range not satisfiable" });
        }
        return readResult(
          node,
          206,
          bytes.slice(start, Math.min(end, bytes.byteLength - 1) + 1),
          contentType,
          null,
          url,
        );
      }
      return readResult(node, 200, bytes, contentType, next, url);
    },

    async readRdf(url, opts = {}): Promise<RdfReadResult> {
      const result = await client.read(url, opts);
      const type = mediaType(result.contentType as string);
      if (type === null || !RDF_READABLE.has(type)) {
        throw fail("not-rdf", "GET", url, null, {
          message: `${url} is ${result.contentType}, not RDF`,
        });
      }
      if (result.status === 304) {
        return {
          url,
          etag: result.etag,
          contentType: type,
          dataset: new Store(),
          notModified: true,
        };
      }
      try {
        const dataset = await parseRdf(await result.text(), result.contentType, { baseIRI: url });
        return { url, etag: result.etag, contentType: type, dataset };
      } catch (cause) {
        throw fail("not-rdf", "GET", url, null, { cause, message: `${url} is not valid ${type}` });
      }
    },

    write: serial("PUT", async (url, body, opts) => {
      begin("PUT", url, opts?.signal);
      if (typeof opts?.contentType !== "string" || opts.contentType === "") {
        throw new TypeError(`PUT ${url}: contentType is required`);
      }
      const ifMatch = conditional("PUT", url, opts.ifMatch, true);
      if (url.endsWith("/")) {
        throw fail("method-not-allowed", "PUT", url, 405, {
          message: "Containers have no writable body",
        });
      }
      const node = nodes.get(url);
      if (lws && !node) {
        throw fail(
          ifMatch === "*" ? "not-found" : "precondition-failed",
          "PUT",
          url,
          ifMatch === "*" ? 404 : 412,
        );
      }
      checkEtag("PUT", url, node, ifMatch);
      const bytes = await toBytes(body, opts.signal, "PUT", url);
      throwIfAborted("PUT", url, opts.signal);
      if (node) {
        node.body = bytes;
        node.contentType = opts.contentType;
        node.etag = nextEtag();
        node.modified = clock();
        return { url, etag: node.etag, created: false };
      }
      if (nodes.has(`${url}/`))
        throw fail("conflict", "PUT", url, 409, { message: `${url}/ is a container` });
      ensureContainers("PUT", url);
      const created: Node = {
        url,
        kind: "resource",
        parent: pathParent(url, root),
        body: bytes,
        contentType: opts.contentType,
        etag: nextEtag(),
        metaEtag: nextEtag(),
        modified: clock(),
        types: [],
        links: [],
      };
      nodes.set(url, created);
      touch(created.parent);
      return { url, etag: created.etag, created: true };
    }),

    async writeRdf(url, dataset, opts) {
      const contentType = opts?.contentType ?? "text/turtle";
      if (contentType !== "application/ld+json" && !WRITABLE_RDF.has(contentType)) {
        throw fail("unsupported", "PUT", url, null, {
          feature: "rdfConneg",
          message: `Serialising ${contentType} is not supported; use text/turtle`,
        });
      }
      const text = await serializeQuads(dataset, contentType, opts?.prefixes);
      return client.write(url, text, { ...opts, contentType });
    },

    create: serial("POST", async (url, body, opts: CreateOptions = {}) => {
      begin("POST", url, opts.signal);
      const parent = container("POST", url);
      const kind = opts.kind ?? "resource";
      if (
        kind === "resource" &&
        (typeof opts.contentType !== "string" || opts.contentType === "")
      ) {
        throw new TypeError(`POST ${url}: contentType is required for a resource`);
      }
      const name = nameFor("POST", url, opts.name);
      let target: string;
      if (!lws && name !== undefined) {
        target = `${url}${name}${kind === "container" ? "/" : ""}`;
        if (nodes.has(target) || nodes.has(target.replace(/\/$/, "")) || nodes.has(`${target}/`)) {
          throw fail("conflict", "PUT", target, 409, { message: `${target} already exists` });
        }
      } else {
        target = freeUrl(url, name ?? slug(), kind);
      }
      const links = lws ? (opts.links ?? []) : [];
      const bytes =
        kind === "resource" && body !== null
          ? await toBytes(body, opts.signal, "POST", url)
          : new Uint8Array();
      throwIfAborted("POST", url, opts.signal);
      const created: Node = {
        url: target,
        kind,
        parent: parent.url,
        body: bytes,
        contentType: kind === "resource" ? (opts.contentType as string) : null,
        etag: nextEtag(),
        metaEtag: nextEtag(),
        modified: clock(),
        types: links.filter((link) => link.rel === "type").map((link) => link.target),
        links: links
          .filter((link) => !LWS_SERVER_RELS.has(link.rel))
          .map((link) => ({ anchor: target, rel: link.rel, href: link.target })),
      };
      nodes.set(target, created);
      touch(parent.url);
      return { url: target, etag: created.etag, created: true };
    }),

    patch: serial("PATCH", async (url, patch: Patch, opts) => {
      begin("PATCH", url, opts?.signal);
      const ifMatch = conditional("PATCH", url, opts?.ifMatch);
      const node = need("PATCH", url);
      checkEtag("PATCH", url, node, ifMatch);
      if (node.kind === "container") {
        throw fail("method-not-allowed", "PATCH", url, 405, {
          message: "Containers cannot be patched",
        });
      }
      const type = mediaType(node.contentType as string);
      let bytes: Uint8Array;
      if (patch.kind === "rdf") {
        if (patch.where !== undefined && patch.where.length > 0) {
          throw fail("unsupported", "PATCH", url, null, {
            feature: "patch",
            message: "The memory backend applies inserts/deletes only",
          });
        }
        if (type === null || !WRITABLE_RDF.has(type)) {
          throw fail("unsupported-media-type", "PATCH", url, 415);
        }
        let store: Store;
        try {
          store = await parseRdf(new TextDecoder().decode(node.body), node.contentType, {
            baseIRI: url,
          });
        } catch (cause) {
          throw fail("conflict", "PATCH", url, 409, {
            cause,
            message: "Stored RDF could not be parsed",
          });
        }
        try {
          applyQuadPatch(store, patch.inserts, patch.deletes, TRIPLE_FORMATS.has(type));
        } catch (error) {
          const patchError = error as RdfPatchError;
          throw fail(
            patchError.kind === "conflict" ? "conflict" : "bad-request",
            "PATCH",
            url,
            patchError.kind === "conflict" ? 409 : 422,
            {
              cause: error,
              message: patchError.message,
            },
          );
        }
        bytes = new TextEncoder().encode(await serializeQuads(store, type));
      } else {
        const ops =
          patch.kind === "json"
            ? patch.ops
            : patch.mediaType.split(";")[0]?.trim().toLowerCase() === "application/json-patch+json"
              ? (() => {
                  try {
                    return JSON.parse(patch.body);
                  } catch (cause) {
                    throw fail("bad-request", "PATCH", url, 400, {
                      cause,
                      message: "Malformed JSON Patch",
                    });
                  }
                })()
              : undefined;
        if (ops === undefined) throw fail("unsupported-media-type", "PATCH", url, 415);
        if (type === null || !(type === "application/json" || type.endsWith("+json"))) {
          throw fail("unsupported-media-type", "PATCH", url, 415, {
            message: "JSON Patch needs a JSON resource",
          });
        }
        let document: unknown;
        try {
          document = JSON.parse(new TextDecoder().decode(node.body));
        } catch (cause) {
          throw fail("conflict", "PATCH", url, 409, {
            cause,
            message: "Stored JSON could not be parsed",
          });
        }
        try {
          bytes = new TextEncoder().encode(JSON.stringify(applyJsonPatch(document, ops)));
        } catch (error) {
          const patchError = error as JsonPatchError;
          throw fail(
            patchError.kind === "conflict" ? "conflict" : "bad-request",
            "PATCH",
            url,
            patchError.kind === "conflict" ? 409 : 400,
            {
              cause: error,
              message: patchError.message,
            },
          );
        }
      }
      throwIfAborted("PATCH", url, opts?.signal);
      node.body = bytes;
      node.etag = nextEtag();
      node.modified = clock();
      return { url, etag: node.etag, created: false };
    }),

    move: serial("MOVE", async (url, destination, opts = {}) => {
      begin("MOVE", url, opts.signal);
      begin("MOVE", destination, opts.signal);
      if (lws && !moveResource) {
        throw fail("unsupported", "MOVE", url, null, {
          feature: "move",
          message: "MoveResource is not advertised",
        });
      }
      const ifMatch = conditional("MOVE", url, opts.ifMatch);
      const node = need("MOVE", url);
      if (url === root) throw fail("method-not-allowed", "MOVE", url, 405);
      const target = container("MOVE", destination);
      checkEtag("MOVE", url, node, ifMatch);
      if (node.kind === "container" && destination.startsWith(url)) {
        throw fail("conflict", "MOVE", url, 409, {
          message: "Cannot move a container into itself",
        });
      }
      // The stored, already-encoded last segment: never decoded (it need not be UTF-8).
      const base = node.url.slice((node.parent as string).length).replace(/\/$/, "");
      let newUrl: string;
      if (lws) {
        newUrl = freeUrl(target.url, base, node.kind);
      } else {
        const name = nameFor("MOVE", url, opts.name) ?? base;
        newUrl = `${target.url}${name}${node.kind === "container" ? "/" : ""}`;
        if (nodes.has(newUrl) || nodes.has(newUrl.replace(/\/$/, "")) || nodes.has(`${newUrl}/`)) {
          throw fail("conflict", "MOVE", newUrl, 409, { message: `${newUrl} already exists` });
        }
        if (subtree(url).length > MAX_EMULATED_MOVE) {
          throw fail("unsupported", "MOVE", url, null, {
            feature: "move",
            message: `Emulated moves are capped at ${MAX_EMULATED_MOVE} resources`,
          });
        }
      }
      const oldParent = node.parent;
      relocate(node, url, newUrl, target.url);
      touch(oldParent);
      touch(target.url);
      return { url: newUrl, etag: node.etag, created: true };
    }),

    delete: serial("DELETE", async (url, opts = {}) => {
      begin("DELETE", url, opts.signal);
      const ifMatch = conditional("DELETE", url, opts.ifMatch);
      const node = need("DELETE", url);
      if (url === root) throw fail("method-not-allowed", "DELETE", url, 405);
      checkEtag("DELETE", url, node, ifMatch);
      if (node.kind === "container" && children(url).length > 0 && opts.recursive !== true) {
        throw fail("conflict", "DELETE", url, 409, { message: `${url} is not empty` });
      }
      for (const removed of subtree(url)) nodes.delete(removed.url);
      touch(node.parent);
    }),

    async metadata(url): Promise<Metadata> {
      begin("GET", url);
      const node = need("GET", url);
      const links = new Map<string, Map<string, MetadataLink[]>>();
      const add = (anchor: string, rel: string, href: string) => {
        const rels = links.get(anchor) ?? new Map<string, MetadataLink[]>();
        rels.set(rel, [...(rels.get(rel) ?? []), { href, params: {} }]);
        links.set(anchor, rels);
      };
      if (lws) {
        for (const [rel, targets] of headerLinks(node)) {
          if (rel !== "linkset") for (const { target } of targets) add(url, rel, target);
        }
      }
      for (const link of node.links) add(link.anchor, link.rel, link.href);
      let raw: unknown;
      if (lws) {
        raw = {
          linkset: [...links].map(([anchor, rels]) => ({
            anchor,
            ...Object.fromEntries(
              [...rels].map(([rel, targets]) => [rel, targets.map(({ href }) => ({ href }))]),
            ),
          })),
        };
      } else {
        const { namedNode, quad } = DataFactory;
        raw = new Store(
          node.links.map((link) =>
            quad(namedNode(link.anchor), namedNode(link.rel), namedNode(link.href)),
          ),
        );
      }
      return { url: metadataUrl(url), etag: node.metaEtag, links, raw };
    },

    setMetadata: serial("PATCH", async (url, ops: readonly MetadataOp[], opts) => {
      begin("PATCH", metadataUrl(url));
      const ifMatch = conditional("PATCH", metadataUrl(url), opts?.ifMatch);
      const node = need("PATCH", url);
      if (ifMatch !== undefined && ifMatch !== "*" && ifMatch !== node.metaEtag) {
        throw fail("precondition-failed", "PATCH", metadataUrl(url), 412, { etag: node.metaEtag });
      }
      const next = [...node.links];
      for (const op of ops) {
        const anchor = op.anchor ?? url;
        if (!isWithin(anchor, root)) throw fail("scope", "PATCH", anchor, null);
        if (lws && LWS_SERVER_RELS.has(op.rel)) {
          throw fail("unsupported", "PATCH", metadataUrl(url), null, {
            ...(op.rel === "up" ? { feature: "move" as const } : {}),
            message: `${op.rel} is server-managed; use move() to change containment`,
          });
        }
        const rel = lws ? op.rel : relIri(op.rel);
        const index = next.findIndex(
          (link) => link.anchor === anchor && link.rel === rel && link.href === op.href,
        );
        if (op.op === "add" && index === -1) next.push({ anchor, rel, href: op.href });
        if (op.op === "remove" && index !== -1) next.splice(index, 1);
      }
      node.links = next;
      node.metaEtag = nextEtag();
      return { etag: node.metaEtag };
    }),

    async parentOf(url) {
      begin("HEAD", url);
      if (!lws) return pathParent(url, root);
      return need("HEAD", url).parent;
    },

    isWithinStorage(url) {
      return isWithin(url, root);
    },
  };
  return client;
}
