// AUTHORED-BY Claude Opus 5.5
// Solid backend, read side (ADR-003 §6, T-021). Writes arrive with T-022.
import { parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import { LiteralAs, OptionalFrom } from "@rdfjs/wrapper";
import { Container, Resource } from "@solid/object/solid";
import { DataFactory, Store } from "n3";
import { StorageError } from "./errors.js";
import {
  allowOf,
  discard,
  failed,
  linksOf,
  mediaTypeOf,
  type ReadShape,
  readResultFrom,
  scoped,
  send,
} from "./http.js";
import { paginate, pathParent } from "./internal.js";
import type {
  AuthFetch,
  Entry,
  Metadata,
  MetadataLink,
  Page,
  RdfReadResult,
  ReadResult,
  StorageClient,
} from "./types.js";

const LDP = "http://www.w3.org/ns/ldp#";
const LDP_CONTAINERS = new Set([`${LDP}Container`, `${LDP}BasicContainer`]);
/** Server-side bookkeeping types that are not "extra" member types. */
const LDP_TYPES = new Set([...LDP_CONTAINERS, `${LDP}Resource`, `${LDP}RDFSource`]);
const DCT_FORMAT = "http://purl.org/dc/terms/format";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const POSIX_MTIME = "http://www.w3.org/ns/posix/stat#mtime";
const IANA_MEDIA_TYPE = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/([^#]+)#Resource$/;
/** RFC 6838 type/subtype without parameters. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";
const RDF_READABLE: ReadonlySet<string> = new Set(SUPPORTED_RDF_MEDIA_TYPES);

export interface SolidBackendOptions {
  /** Authenticated fetch (pod-auth). */
  fetch: AuthFetch;
  /** The storage root container URL; every request must stay within it. */
  root: string;
  /** Resolved features (capabilities()); default: an undescribed Solid storage. */
  features?: Features;
}

/** A listed member with the optional `dct:format` literal some servers emit. */
class Member extends Resource {
  get format(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_FORMAT, LiteralAs.string);
  }

  /** rdf:type IRIs; non-IRI objects are skipped instead of failing the whole member. */
  get typeIris(): string[] {
    const types: string[] = [];
    for (const q of this.dataset.match(
      DataFactory.namedNode(this.id),
      DataFactory.namedNode(RDF_TYPE),
    )) {
      if (q.object.termType === "NamedNode") types.push(q.object.value);
    }
    return types;
  }

  /** dc:modified, else posix:mtime (seconds since the epoch), each read independently. */
  get modifiedAt(): Date | undefined {
    const modified = tolerant(() => this.modified);
    if (modified && !Number.isNaN(modified.getTime())) return modified;
    const seconds = tolerant(() =>
      OptionalFrom.subjectPredicate(this, POSIX_MTIME, LiteralAs.number),
    );
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}

function tolerant<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function writesPending(method: string, url: string): Promise<never> {
  return Promise.reject(
    new StorageError("unsupported", {
      method,
      url,
      message: `${method} on the Solid backend is not available yet (T-022)`,
    }),
  );
}

/** Create the Solid StorageClient. Read operations only; mutations reject with `unsupported`. */
export function createSolidBackend(options: SolidBackendOptions): StorageClient {
  const { fetch } = options;
  const root = scoped(options.root, "GET", options.root);
  if (!root.endsWith("/") || new URL(root).search || new URL(root).hash) {
    throw new TypeError("root must be a container URL ending with '/'");
  }
  const features =
    options.features ??
    deriveFeatures({
      protocol: "solid",
      id: root,
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

  /** Shape a successful HEAD/GET; anything else throws the mapped error. */
  async function shapeOf(
    method: string,
    url: string,
    response: Response,
    expect: { range: boolean; conditional: boolean },
  ): Promise<ReadShape> {
    const expected =
      response.status === 200 ||
      (response.status === 206 && expect.range) ||
      (response.status === 304 && expect.conditional);
    if (!expected) {
      if (response.status < 200 || response.status >= 400) await failed(method, url, response);
      // Any other success or redirect (204, unsolicited 206/304, 3xx) is not a read result.
      discard(response.body);
      throw new StorageError("invalid-response", {
        method,
        url,
        status: response.status,
        message: `${method} ${url} answered an unexpected ${response.status}`,
      });
    }
    const links = linksOf(response, url);
    const types = (links.get("type") ?? []).map((link) => link.target);
    const describedBy = links.get("describedby")?.[0]?.target ?? null;
    const status = response.status as 200 | 206 | 304;
    return {
      status,
      kind:
        types.some((type) => LDP_CONTAINERS.has(type)) || url.endsWith("/")
          ? "container"
          : "resource",
      parent: pathParent(url, root),
      metadataUrl: describedBy,
      allow: allowOf(response),
      links,
      withBody: method === "GET" && status !== 304,
    };
  }

  async function get(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    range = false,
  ): Promise<ReadResult> {
    const target = scoped(root, "GET", url);
    const response = await send(fetch, "GET", target, headers, signal);
    const shape = await shapeOf("GET", target, response, {
      range,
      conditional: "If-None-Match" in headers,
    });
    return readResultFrom(response, target, shape, signal);
  }

  /** Parse an RDF body, mapping a non-RDF or unparsable body to `code`. */
  async function rdfBody(
    result: ReadResult,
    code: "not-rdf" | "invalid-response",
  ): Promise<{ type: string; dataset: Awaited<ReturnType<typeof parseRdf>> }> {
    const type = mediaTypeOf(result.contentType) ?? "";
    if (!RDF_READABLE.has(type)) {
      discard(result.body);
      throw new StorageError(code, {
        method: "GET",
        url: result.url,
        message: `${result.url} is ${result.contentType ?? "untyped"}, not RDF`,
      });
    }
    // Body transport failures surface as `network` (from bytes()), not as a parse error.
    const text = await result.text();
    try {
      return { type, dataset: await parseRdf(text, result.contentType, { baseIRI: result.url }) };
    } catch (cause) {
      throw new StorageError(code, {
        method: "GET",
        url: result.url,
        cause,
        message: `${result.url} is not valid ${type}`,
      });
    }
  }

  function entryOf(member: Member, container: string): Entry | null {
    // Fail closed: drop members outside the storage or not directly contained.
    if (!client.isWithinStorage(member.id) || pathParent(member.id, root) !== container) {
      return null;
    }
    const types = member.typeIris;
    const kind =
      member.id.endsWith("/") || types.some((type) => LDP_CONTAINERS.has(type))
        ? "container"
        : "resource";
    const iana = types.map((type) => IANA_MEDIA_TYPE.exec(type)?.[1]).find(Boolean);
    // Listing metadata is advisory: a malformed literal drops that field, never the member.
    const declared = tolerant(() => member.format);
    const format = declared !== undefined && MEDIA_TYPE.test(declared) ? declared : undefined;
    const size = tolerant(() => member.size);
    const modified = member.modifiedAt;
    return {
      url: member.id,
      kind,
      contentType: kind === "container" ? null : (format ?? iana ?? null),
      size: typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null,
      modified: modified ?? null,
      types: types.filter((type) => !LDP_TYPES.has(type) && !IANA_MEDIA_TYPE.test(type)),
    };
  }

  const client: StorageClient = {
    protocol: "solid",
    root,
    features,

    async list(url, opts = {}) {
      const container = scoped(root, "GET", url);
      if (opts.cursor !== undefined) {
        throw new StorageError("bad-request", {
          method: "GET",
          url: opts.cursor.url,
          message: "Solid listings have one page",
        });
      }
      const result = await get(container, { Accept: "text/turtle" }, opts.signal);
      if (result.kind !== "container") {
        discard(result.body);
        throw new StorageError("method-not-allowed", {
          method: "GET",
          url: container,
          message: `${container} is not a container`,
        });
      }
      const { dataset } = await rdfBody(result, "invalid-response");
      const listed = new Container(container, dataset, DataFactory);
      const items: Entry[] = [];
      // `contains` is a set of distinct members, so URLs are unique.
      for (const resource of listed.contains) {
        const entry = entryOf(new Member(resource.id, dataset, DataFactory), container);
        if (entry) items.push(entry);
      }
      items.sort((a, b) => (a.url < b.url ? -1 : 1));
      return { items, next: null, total: items.length, etag: result.etag } satisfies Page<Entry>;
    },

    listAll(url, opts = {}) {
      return paginate(
        url,
        (cursor) => client.list(url, { cursor, signal: opts.signal }),
        opts.signal,
      );
    },

    async head(url, opts = {}) {
      const target = scoped(root, "HEAD", url);
      const response = await send(fetch, "HEAD", target, { Accept: "*/*" }, opts.signal);
      const shape = await shapeOf("HEAD", target, response, { range: false, conditional: false });
      return readResultFrom(response, target, shape, opts.signal);
    },

    async read(url, opts = {}) {
      const headers: Record<string, string> = { Accept: opts.accept ?? "*/*" };
      if (opts.ifNoneMatch !== undefined) headers["If-None-Match"] = opts.ifNoneMatch;
      if (opts.range) {
        const { start, end } = opts.range;
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          (end !== undefined && (!Number.isSafeInteger(end) || end < start))
        ) {
          throw new RangeError("range must have 0 <= start <= end (safe integers)");
        }
        headers.Range = `bytes=${start}-${end ?? ""}`;
      }
      return get(url, headers, opts.signal, opts.range !== undefined);
    },

    async readRdf(url, opts = {}): Promise<RdfReadResult> {
      const headers: Record<string, string> = { Accept: RDF_ACCEPT };
      if (opts.ifNoneMatch !== undefined) headers["If-None-Match"] = opts.ifNoneMatch;
      const result = await get(url, headers, opts.signal);
      if (result.status === 304) {
        return {
          url: result.url,
          etag: result.etag,
          contentType: mediaTypeOf(result.contentType) ?? "",
          dataset: new Store(),
          notModified: true,
        };
      }
      const { type, dataset } = await rdfBody(result, "not-rdf");
      return { url: result.url, etag: result.etag, contentType: type, dataset };
    },

    write: (url) => writesPending("PUT", url),
    writeRdf: (url) => writesPending("PUT", url),
    create: (url) => writesPending("POST", url),
    patch: (url) => writesPending("PATCH", url),
    move: (url) => writesPending("MOVE", url),
    delete: (url) => writesPending("DELETE", url),
    setMetadata: (url) => writesPending("PATCH", url),

    async metadata(url): Promise<Metadata> {
      const described = await client.head(url);
      if (described.metadataUrl === null) {
        throw new StorageError("unsupported", {
          method: "GET",
          url: described.url,
          message: `${described.url} advertises no describedby metadata`,
        });
      }
      const document = await client.readRdf(described.metadataUrl);
      const links = new Map<string, Map<string, MetadataLink[]>>();
      for (const quad of document.dataset.match()) {
        if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
        const rels = links.get(quad.subject.value) ?? new Map<string, MetadataLink[]>();
        rels.set(quad.predicate.value, [
          ...(rels.get(quad.predicate.value) ?? []),
          { href: quad.object.value, params: {} },
        ]);
        links.set(quad.subject.value, rels);
      }
      return { url: document.url, etag: document.etag, links, raw: document.dataset };
    },

    async parentOf(url) {
      return pathParent(scoped(root, "HEAD", url), root);
    },

    isWithinStorage(url) {
      return URL.canParse(url) && isWithinPodScope(root, url);
    },
  };
  return client;
}
