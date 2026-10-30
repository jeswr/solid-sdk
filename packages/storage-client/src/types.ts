// AUTHORED-BY Claude Opus 5.5
// ADR-003 §1, verbatim except where marked "Extension".

import type { DatasetCore, Quad } from "@jeswr/fetch-rdf";
import type { DescriptionCache, Features, StorageDescription } from "@jeswr/storage-capabilities";

/** Injected authenticated fetch; pod-auth provides it. */
export type AuthFetch = typeof fetch;

export interface PodClientOptions {
  fetch: AuthFetch;
  /** Any URL inside the storage (WebID storage root, or a resource). */
  storage: string;
  capabilities?: DescriptionCache;
  /** Force a backend; default: chosen from the resolved description's `protocol`. */
  backend?: "solid" | "lws";
  clock?: () => number;
  signal?: AbortSignal;
}
export interface PodClient {
  storage: StorageClient;
  description: StorageDescription;
  features: Features;
}

export type ResourceKind = "container" | "resource";
export interface Entry {
  url: string;
  kind: ResourceKind;
  /** LWS `format`; Solid: from listing when present, else null. */
  contentType: string | null;
  size: number | null;
  modified: Date | null;
  /** Extra rdf:type IRIs (LWS `type` beyond Container/DataResource; Solid rdf:type of the member). */
  types: readonly string[];
}
export interface Page<T> {
  items: readonly T[];
  next: PageCursor | null;
  total: number | null;
  etag: string | null;
}
/** Opaque: the LWS `rel=next` URL. */
export type PageCursor = { readonly url: string };

export interface LinkTarget {
  target: string;
  params: Record<string, string>;
}
export interface ReadResult {
  /** After redirects (none are followed; equals the request url). */
  url: string;
  status: 200 | 206 | 304;
  etag: string | null;
  contentType: string | null;
  lastModified: Date | null;
  /** null on 304 / HEAD. */
  body: ReadableStream<Uint8Array> | null;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  /** rel → targets. */
  links: ReadonlyMap<string, readonly LinkTarget[]>;
  /** LWS `up`; Solid: path parent. */
  parent: string | null;
  /** LWS linkset; Solid describedby. */
  metadataUrl: string | null;
  kind: ResourceKind;
  /** WAC-Allow / linkset-derived permissions of the caller, when the server tells us. */
  allow: { read: boolean; write: boolean; append: boolean; control: boolean } | null;
}
export interface RdfReadResult {
  url: string;
  etag: string | null;
  contentType: string;
  dataset: DatasetCore;
  /**
   * Extension: true when `ifNoneMatch` matched (HTTP 304). `dataset` is then empty and the
   * caller keeps its copy; `etag` is the current one.
   */
  notModified?: boolean;
}

export type Body = string | Uint8Array | Blob | ReadableStream<Uint8Array>;
export interface WriteOptions {
  contentType: string;
  ifMatch: string | "*";
  signal?: AbortSignal;
}
export interface CreateOptions {
  /** Required for kind 'resource'. */
  contentType?: string;
  /** Default 'resource'. */
  kind?: ResourceKind;
  /** Name hint. Honoured on Solid (PUT container+name, If-None-Match:*). Sent as Slug on LWS; server decides. */
  name?: string;
  /** Initial user metadata (LWS: Link headers on POST; Solid: ignored unless describedby is writable). */
  links?: readonly { rel: string; target: string }[];
  signal?: AbortSignal;
}
export interface WriteResult {
  url: string;
  etag: string | null;
  created: boolean;
}

export type JsonPatchOp = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
};
export type Patch =
  /** Quads may contain Variables in `where`. */
  | { kind: "rdf"; inserts: readonly Quad[]; deletes: readonly Quad[]; where?: readonly Quad[] }
  /** RFC 6902. */
  | { kind: "json"; ops: readonly JsonPatchOp[] }
  /** Escape hatch. */
  | { kind: "raw"; mediaType: string; body: string };

export interface MetadataLink {
  href: string;
  params: Record<string, string>;
}
export interface Metadata {
  /** The metadata document (linkset / describedby). */
  url: string;
  etag: string | null;
  /** RFC 9264 link set normalised: anchor → rel → targets. */
  links: ReadonlyMap<string, ReadonlyMap<string, readonly MetadataLink[]>>;
  /** LWS linkset JSON; Solid: the RDF dataset. */
  raw: unknown;
}
export interface MetadataOp {
  op: "add" | "remove";
  anchor?: string;
  rel: string;
  href: string;
}

export interface StorageClient {
  readonly protocol: "solid" | "lws";
  readonly root: string;
  readonly features: Features;

  list(
    container: string,
    opts?: { cursor?: PageCursor; signal?: AbortSignal },
  ): Promise<Page<Entry>>;
  listAll(container: string, opts?: { signal?: AbortSignal }): AsyncIterable<Entry>;
  head(url: string, opts?: { signal?: AbortSignal }): Promise<ReadResult>;
  read(
    url: string,
    opts?: {
      accept?: string;
      ifNoneMatch?: string;
      range?: { start: number; end?: number };
      signal?: AbortSignal;
    },
  ): Promise<ReadResult>;
  /** read + parseRdf (fetch-rdf). Accept: text/turtle, application/ld+json. Throws 'not-rdf' when the body is not RDF. */
  readRdf(
    url: string,
    opts?: { ifNoneMatch?: string; signal?: AbortSignal },
  ): Promise<RdfReadResult>;
  write(url: string, body: Body, opts: WriteOptions): Promise<WriteResult>;
  /** Serialise with rdf-serialize (Turtle) and write. `ifMatch` mandatory. */
  writeRdf(
    url: string,
    dataset: DatasetCore | Iterable<Quad>,
    opts: Omit<WriteOptions, "contentType"> & {
      contentType?: "text/turtle" | "application/ld+json";
      prefixes?: Record<string, string>;
    },
  ): Promise<WriteResult>;
  create(container: string, body: Body | null, opts?: CreateOptions): Promise<WriteResult>;
  patch(
    url: string,
    patch: Patch,
    opts: { ifMatch: string; signal?: AbortSignal },
  ): Promise<WriteResult>;
  move(
    url: string,
    destinationContainer: string,
    opts?: { name?: string; ifMatch?: string; signal?: AbortSignal },
  ): Promise<WriteResult>;
  delete(
    url: string,
    opts?: { ifMatch?: string; recursive?: boolean; signal?: AbortSignal },
  ): Promise<void>;
  metadata(url: string): Promise<Metadata>;
  setMetadata(
    url: string,
    ops: readonly MetadataOp[],
    opts: { ifMatch: string },
  ): Promise<{ etag: string | null }>;

  /** Path helpers that respect the backend's containment model. LWS: `up` link (HEAD if unknown); Solid: path arithmetic. */
  parentOf(url: string): Promise<string | null>;
  isWithinStorage(url: string): boolean;
}
