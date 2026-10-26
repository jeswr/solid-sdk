// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// Solid backend, read side (ADR-003 §6, T-021). Writes arrive with T-022.
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import { LiteralAs, OptionalFrom } from "@rdfjs/wrapper";
import { Container, Resource } from "@solid/object/solid";
import { DataFactory } from "n3";
import { StorageError } from "./errors.js";
import { allowOf, discard, linksOf, type ReadShape, scoped } from "./http.js";
import { paginate, pathParent } from "./internal.js";
import {
  acceptReadStatus,
  createReadOperations,
  MEDIA_TYPE,
  type ReadExpectation,
  rdfBody,
} from "./read.js";
import type { AuthFetch, Entry, Metadata, MetadataLink, Page, StorageClient } from "./types.js";

const LDP = "http://www.w3.org/ns/ldp#";
const LDP_CONTAINERS = new Set([`${LDP}Container`, `${LDP}BasicContainer`]);
/** Server-side bookkeeping types that are not "extra" member types. */
const LDP_TYPES = new Set([...LDP_CONTAINERS, `${LDP}Resource`, `${LDP}RDFSource`]);
const DCT_FORMAT = "http://purl.org/dc/terms/format";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const POSIX_MTIME = "http://www.w3.org/ns/posix/stat#mtime";
const IANA_MEDIA_TYPE = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/([^#]+)#Resource$/;
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
    expect: ReadExpectation,
  ): Promise<ReadShape> {
    await acceptReadStatus(method, url, response, expect);
    const links = linksOf(response, url);
    const types = (links.get("type") ?? []).map((link) => link.target);
    const describedBy = links.get("describedby")?.[0]?.target ?? null;
    const status = response.status as 200 | 206 | 304;
    return {
      status,
      kind:
        types.some((type) => LDP_CONTAINERS.has(type)) || new URL(url).pathname.endsWith("/")
          ? "container"
          : "resource",
      parent: pathParent(url, root),
      metadataUrl: describedBy,
      allow: allowOf(response),
      links,
      withBody: method === "GET" && status !== 304,
    };
  }

  const { get, head, read, readRdf } = createReadOperations(fetch, root, shapeOf);

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
      // A query or fragment (even an empty `?` or `#`, which URL.search/hash report as "") would
      // name a different RDF subject than the container. In a canonical href both are delimiters.
      if (/[?#]/.test(container)) {
        throw new StorageError("bad-request", {
          method: "GET",
          url: container,
          message: "list() takes a container URL without a query or fragment",
        });
      }
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

    head,
    read,
    readRdf,

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
