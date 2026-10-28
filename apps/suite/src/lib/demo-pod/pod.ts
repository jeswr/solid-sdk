// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * An in-browser demo pod: a `fetch` implementation that behaves like a small
 * Solid (LDP) server over an in-memory resource map, so the suite's real data
 * layers (which all take an injected `fetch`) run unchanged before sign-in
 * exists. It is a fixture, not a server: there is no access control (every
 * request acts as the owner), but the HTTP surface the data layers rely on is
 * faithful to the Community Solid Server:
 *
 * - containers are paths ending in `/`; PUT creates missing parent containers;
 * - GET on a container returns Turtle with `ldp:contains` plus per-member
 *   `rdf:type`, `posix:size`, `posix:mtime` and `dct:modified`;
 * - strong ETags, `If-Match` / `If-None-Match` preconditions (412);
 * - POST with `Slug` (and a BasicContainer `Link` type) mints a child;
 * - DELETE of a non-empty container is 409; the root cannot be deleted;
 * - `Link` headers carry `rel="type"`, `rel="acl"` and the storage root type;
 * - `X-Solid-Demo-Access-Control: none` explicitly reports the lack of enforcement.
 *
 * Listings are serialised with `n3.Writer` the way a server would emit them.
 */

import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

const LDP = "http://www.w3.org/ns/ldp#";
const POSIX = "http://www.w3.org/ns/posix/stat#";
const DCT = "http://purl.org/dc/terms/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const IANA = "http://www.w3.org/ns/iana/media-types/";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";

class ListedResource extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get members(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${LDP}contains`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  set size(value: number) {
    RequiredAs.object(this, `${POSIX}size`, value, LiteralFrom.integer);
  }
  set mtime(value: number) {
    RequiredAs.object(this, `${POSIX}mtime`, value, LiteralFrom.integer);
  }
  set modified(value: Date) {
    RequiredAs.object(this, `${DCT}modified`, value, LiteralFrom.dateTime);
  }
}

/** One stored resource (containers carry no body; their listing is generated). */
export interface DemoResource {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
  readonly modified: number;
  readonly created: number;
}

/** A serialisable copy of the pod state (for IndexedDB persistence). */
export interface DemoPodSnapshot {
  readonly version: 1;
  readonly etagSeq: number;
  readonly resources: ReadonlyArray<readonly [string, DemoResource]>;
  readonly containers: ReadonlyArray<
    readonly [string, { modified: number; created: number; etag?: string }]
  >;
}

/** A resource to place in a fresh pod. Paths are relative to the pod root. */
export interface DemoSeedFile {
  readonly path: string;
  readonly body: Uint8Array | string;
  readonly contentType: string;
  /** Milliseconds since the epoch; defaults to the pod's clock. */
  readonly modified?: number;
}

export interface DemoPodOptions {
  /** Pod root, e.g. `https://alice.demo.pod/` (must end with `/`). */
  readonly root: string;
  readonly seed?: readonly DemoSeedFile[];
  readonly snapshot?: DemoPodSnapshot;
  /** Injectable clock for tests. */
  readonly now?: () => number;
  /** Simulated latency in milliseconds (0 in tests). */
  readonly latency?: number;
}

export type DemoPodListener = (url: string) => void;

export interface DemoPod {
  readonly root: string;
  readonly fetch: typeof globalThis.fetch;
  /** Current state for persistence. */
  snapshot(): DemoPodSnapshot;
  /** Called with the changed URL after every successful write or delete. */
  subscribe(listener: DemoPodListener): () => void;
  /** Whether a path (absolute URL) exists. */
  has(url: string): boolean;
}

const encoder = new TextEncoder();

async function bodyBytes(body: RequestInit["body"] | null | undefined): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === "string") return encoder.encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}

function parentOf(url: string): string | undefined {
  const { pathname } = new URL(url);
  if (pathname === "/") return undefined;
  const trimmed = url.endsWith("/") ? url.slice(0, -1) : url;
  return trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
}

function isContainerUrl(url: string): boolean {
  return url.endsWith("/");
}

/** Strip query and fragment; requests address resources, not fragments. */
function resourceUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  return url.href;
}

function quoteEtag(seq: number): string {
  return `"demo-${seq.toString(36)}"`;
}

/** Parse `If-Match` / `If-None-Match` lists; `*` is returned as-is. */
function etagList(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  return value
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .filter((tag) => tag.length > 0);
}

export function createDemoPod(options: DemoPodOptions): DemoPod {
  const root = new URL(options.root).href;
  if (!root.endsWith("/")) throw new Error("Demo pod root must end with '/'");
  const now = options.now ?? (() => Date.now());
  const latency = options.latency ?? 0;
  const resources = new Map<string, DemoResource>();
  const containers = new Map<string, { modified: number; created: number; etag?: string }>();
  const listeners = new Set<DemoPodListener>();
  let etagSeq = 0;

  const touch = (container: string, at: number) => {
    const meta = containers.get(container);
    if (meta) {
      etagSeq += 1;
      containers.set(container, {
        ...meta,
        modified: at,
        etag: `"demo-c-${etagSeq.toString(36)}"`,
      });
    }
  };

  const ensureContainer = (url: string, at: number) => {
    let current: string | undefined = url;
    const missing: string[] = [];
    while (current !== undefined && !containers.has(current)) {
      missing.push(current);
      current = parentOf(current);
    }
    for (const container of missing.reverse()) {
      etagSeq += 1;
      containers.set(container, {
        modified: at,
        created: at,
        etag: `"demo-c-${etagSeq.toString(36)}"`,
      });
      const parent = parentOf(container);
      if (parent) touch(parent, at);
    }
  };

  const putResource = (url: string, body: Uint8Array, contentType: string, at: number) => {
    const parent = parentOf(url) as string;
    ensureContainer(parent, at);
    const existing = resources.get(url);
    etagSeq += 1;
    resources.set(url, {
      body,
      contentType,
      etag: quoteEtag(etagSeq),
      modified: at,
      created: existing?.created ?? at,
    });
    touch(parent, at);
  };

  if (options.snapshot) {
    for (const [url, meta] of options.snapshot.containers) containers.set(url, { ...meta });
    for (const [url, resource] of options.snapshot.resources) {
      resources.set(url, { ...resource, body: new Uint8Array(resource.body) });
    }
    etagSeq = options.snapshot.etagSeq;
  }
  ensureContainer(root, now());
  if (!options.snapshot) {
    for (const file of options.seed ?? []) {
      const url = new URL(file.path, root).href;
      const at = file.modified ?? now();
      if (isContainerUrl(url)) ensureContainer(url, at);
      else {
        const body = typeof file.body === "string" ? encoder.encode(file.body) : file.body;
        putResource(url, body, file.contentType, at);
      }
    }
  }

  const children = (container: string): string[] => {
    const out: string[] = [];
    for (const url of [...containers.keys(), ...resources.keys()]) {
      if (url !== container && parentOf(url) === container) out.push(url);
    }
    return out.sort();
  };

  const containerEtag = (container: string): string => {
    const meta = containers.get(container) as { modified: number; etag?: string };
    return meta.etag ?? `"demo-c-${meta.modified.toString(36)}-${children(container).length}"`;
  };

  const listing = (container: string): Promise<string> => {
    const dataset = new Store();
    const writer = new Writer({
      format: "text/turtle",
      prefixes: { ldp: LDP, posix: POSIX, dct: DCT, xsd: XSD },
    });
    const self = new ListedResource(container, dataset, DataFactory);
    const describe = (url: string, modified: number, resource: DemoResource | undefined) => {
      const subject = new ListedResource(url, dataset, DataFactory);
      const size = resource?.body.byteLength;
      if (resource === undefined) {
        subject.types.add(`${LDP}Container`);
        subject.types.add(`${LDP}BasicContainer`);
      } else {
        // CSS advertises the stored media type as an IANA media-type class.
        // Splitting a string always yields at least one segment, including for "".
        const essence = (resource.contentType.split(";")[0] as string).trim().toLowerCase();
        if (/^[\w.+-]+\/[\w.+-]+$/.test(essence)) {
          subject.types.add(`${IANA}${essence}#Resource`);
        }
      }
      subject.types.add(`${LDP}Resource`);
      if (size !== undefined) subject.size = size;
      subject.mtime = Math.floor(modified / 1000);
      subject.modified = new Date(modified);
    };
    const meta = containers.get(container) as { modified: number };
    describe(container, meta.modified, undefined);
    if (container === root) self.types.add(PIM_STORAGE);
    for (const child of children(container)) {
      self.members.add(child);
      const resource = resources.get(child);
      const childMeta = resource ?? (containers.get(child) as { modified: number });
      describe(child, childMeta.modified, resource);
    }
    writer.addQuads([...dataset]);
    return new Promise((resolve, reject) => {
      writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
  };

  const linkHeader = (url: string): string => {
    const links = [`<${LDP}Resource>; rel="type"`];
    if (isContainerUrl(url)) {
      links.push(`<${LDP}Container>; rel="type"`, `<${LDP}BasicContainer>; rel="type"`);
    }
    if (url === root) links.push(`<${PIM_STORAGE}>; rel="type"`);
    if (!url.endsWith(".acl")) links.push(`<${url}.acl>; rel="acl"`);
    return links.join(", ");
  };

  const notify = (url: string) => {
    for (const listener of listeners) listener(url);
  };

  const respond = (status: number, headers: Record<string, string> = {}, body?: BodyInit) =>
    new Response(status === 204 || status === 205 || status === 304 ? null : (body ?? null), {
      status,
      headers: { "x-solid-demo-access-control": "none", ...headers },
    });

  const currentEtag = (url: string): string | undefined =>
    resources.get(url)?.etag ?? (containers.has(url) ? containerEtag(url) : undefined);

  const preconditionFails = (url: string, headers: Headers): boolean => {
    const current = currentEtag(url);
    const ifMatch = etagList(headers.get("if-match"));
    if (ifMatch && (current === undefined || !(ifMatch.includes("*") || ifMatch.includes(current))))
      return true;
    const ifNoneMatch = etagList(headers.get("if-none-match"));
    if (ifNoneMatch && current !== undefined) {
      if (ifNoneMatch.includes("*") || ifNoneMatch.includes(current)) return true;
    }
    return false;
  };

  const read = async (url: string, head: boolean): Promise<Response> => {
    const resource = resources.get(url);
    if (resource) {
      const headers = {
        "content-type": resource.contentType,
        etag: resource.etag,
        "last-modified": new Date(resource.modified).toUTCString(),
        "content-length": String(resource.body.byteLength),
        link: linkHeader(url),
        "wac-allow": 'user="read write append control",public=""',
      };
      return respond(200, headers, head ? undefined : new Uint8Array(resource.body));
    }
    if (containers.has(url)) {
      const meta = containers.get(url) as { modified: number };
      const headers = {
        "content-type": "text/turtle",
        etag: containerEtag(url),
        "last-modified": new Date(meta.modified).toUTCString(),
        link: linkHeader(url),
        "wac-allow": 'user="read write append control",public=""',
      };
      return respond(200, headers, head ? undefined : await listing(url));
    }
    return respond(404);
  };

  const write = async (url: string, init: RequestInit, headers: Headers): Promise<Response> => {
    // All asynchronous body work precedes the precondition and mutation. No
    // await is allowed in the critical section below (including notifications).
    const body = await bodyBytes(init.body);
    if (preconditionFails(url, headers)) return respond(412);
    // A path through an existing file cannot become a container.
    for (let parent = parentOf(url); parent; parent = parentOf(parent)) {
      if (resources.has(parent.slice(0, -1))) return respond(409);
    }
    const at = now();
    if (isContainerUrl(url)) {
      if (containers.has(url)) return respond(205);
      if (resources.has(url.slice(0, -1))) return respond(409);
      ensureContainer(url, at);
      notify(url);
      return respond(201, { location: url, etag: containerEtag(url) });
    }
    if (containers.has(`${url}/`)) return respond(409);
    const existed = resources.has(url);
    const contentType = headers.get("content-type") ?? "application/octet-stream";
    putResource(url, body, contentType, at);
    notify(url);
    const etag = (resources.get(url) as DemoResource).etag;
    return respond(existed ? 205 : 201, { location: url, etag });
  };

  const post = async (url: string, init: RequestInit, headers: Headers): Promise<Response> => {
    const body = await bodyBytes(init.body);
    if (!containers.has(url)) return respond(404);
    const asContainer = /BasicContainer|ldp#Container/.test(headers.get("link") ?? "");
    const slug = (headers.get("slug") ?? "").replace(/[/\\]/g, "-").trim();
    const base = encodeURIComponent(slug || crypto.randomUUID());
    let candidate = `${url}${base}${asContainer ? "/" : ""}`;
    for (let n = 1; resources.has(candidate) || containers.has(candidate); n += 1) {
      candidate = `${url}${base}-${n}${asContainer ? "/" : ""}`;
    }
    const childHeaders = new Headers();
    childHeaders.set("if-none-match", "*");
    const contentType = headers.get("content-type");
    if (contentType) childHeaders.set("content-type", contentType);
    const response = await write(candidate, { ...init, body: new Uint8Array(body) }, childHeaders);
    // A concurrent POST can claim the same slug while write materialises its body.
    return response.status === 412
      ? post(url, { ...init, body: new Uint8Array(body) }, headers)
      : response;
  };

  const remove = (url: string): Response => {
    if (url === root) return respond(405);
    if (resources.delete(url)) {
      touch(parentOf(url) as string, now());
      notify(url);
      return respond(205);
    }
    if (containers.has(url)) {
      if (children(url).length > 0) return respond(409);
      containers.delete(url);
      touch(parentOf(url) as string, now());
      notify(url);
      return respond(205);
    }
    return respond(404);
  };

  const podFetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = resourceUrl(input);
    const request = input instanceof Request ? input : undefined;
    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? request?.headers);
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    if (!url.startsWith(root)) return respond(404);
    const effectiveInit: RequestInit =
      init.body === undefined && request && method !== "GET" && method !== "HEAD"
        ? { ...init, body: await request.arrayBuffer() }
        : init;
    switch (method) {
      case "GET":
        return read(url, false);
      case "HEAD":
        return read(url, true);
      case "PUT":
        return write(url, effectiveInit, headers);
      case "POST":
        return post(url, effectiveInit, headers);
      case "DELETE":
        if (preconditionFails(url, headers)) return respond(412);
        return remove(url);
      case "OPTIONS":
        return respond(204, { allow: "GET, HEAD, PUT, POST, DELETE, OPTIONS" });
      default:
        return respond(405, { allow: "GET, HEAD, PUT, POST, DELETE, OPTIONS" });
    }
  };

  return {
    root,
    fetch: podFetch,
    snapshot: () => ({
      version: 1,
      etagSeq,
      resources: [...resources.entries()].map(([url, r]) => [url, { ...r }] as const),
      containers: [...containers.entries()].map(([url, m]) => [url, { ...m }] as const),
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    has: (url) => resources.has(url) || containers.has(url),
  };
}
