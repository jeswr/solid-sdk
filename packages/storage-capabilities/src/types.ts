// AUTHORED-BY Codex GPT-6.1-Sol
export type Protocol = "solid" | "lws";

export interface ServiceEntry {
  /** Expanded IRIs. Bare LWS terms expand to `https://www.w3.org/ns/lws#<Term>`. */
  type: readonly string[];
  endpoint: string; // absolute URL
  id?: string;
  conformsTo?: readonly string[];
  /** Every other JSON member / RDF property, keys as expanded IRIs for RDF sources, raw keys for JSON. */
  extra: Readonly<Record<string, unknown>>;
}
export interface CapabilityEntry {
  type: readonly string[];
  id?: string;
  extra: Readonly<Record<string, unknown>>;
}
export type DescriptionSource =
  | "lws-cid" // application/lws+cid (or application/cid, application/ld+json) at the lws#storage Link target
  | "solid-description" // RDF at the solid:storageDescription Link target (incl. notifications + service-description terms)
  | "probe"; // headers of HEAD/OPTIONS on the root container

export interface StorageDescription {
  protocol: Protocol;
  /** Canonical storage id: LWS `id`; Solid: the pim:Storage container URL. */
  id: string;
  /** Root container: LWS StorageRoot endpoint; Solid: same as id. */
  root: string;
  descriptionUrl: string | null; // where the description was fetched from
  services: readonly ServiceEntry[];
  capabilities: readonly CapabilityEntry[];
  sources: readonly DescriptionSource[];
  /** Resolver evidence for an assumed root or a notification-only foreign description. */
  evidence?: readonly string[];
  fetchedAt: number; // Date.now()
  etag: string | null;
  maxAgeMs: number; // from Cache-Control max-age, else DEFAULT_TTL_MS (3_600_000)
  /** Verification methods (CID) for webhook signature checks; LWS only. */
  verificationMethods: readonly {
    id: string;
    type: string;
    controller: string;
    publicKeyJwk: JsonWebKey;
    /** CID revocation timestamp; verifiers must enforce this when using the method. */
    revoked?: string;
    /** CID expiration timestamp; verifiers must enforce this even for cached descriptions. */
    expires?: string;
  }[];
}

export type FeatureState = "available" | "unavailable" | "unknown";
export interface Feature<T = undefined> {
  state: FeatureState;
  /** Which entry/header justified the state; for logs and the share-dialog copy. */
  evidence: string;
  detail: T;
}

export interface Features {
  protocol: Protocol;
  /** Live change notifications a browser can consume without a relay. */
  liveUpdates: Feature<{
    channels: ("websocket" | "sse" | "webhook" | "legacy-ws")[];
    endpoint?: string;
  }>;
  /** A CRDT sync service (Yjs) is advertised. */
  realtimeCollab: Feature<{ endpoint?: string; protocols: string[] }>;
  /** Server-side SPARQL over the pod with access control. */
  serverSearch: Feature<{ endpoint?: string }>;
  /** Server-managed type index / type search (LWS) or client type index (Solid). */
  typeIndex: Feature<{
    mode: "server" | "client";
    indexEndpoint?: string;
    searchEndpoint?: string;
  }>;
  accessRequests: Feature<{ endpoint?: string; profiles: string[] }>;
  accessGrants: Feature<{ endpoint?: string; profiles: string[] }>;
  /** Which access-control model `pod-access` must use. */
  accessControl: Feature<{ model: "wac" | "acp" | "odrl-grants" | "none" }>;
  versioning: Feature<{ endpoint?: string }>;
  trash: Feature<{ endpoint?: string }>;
  move: Feature<{ native: boolean; containers: boolean; preservesIdentifier: boolean | null }>;
  patch: Feature<{
    formats: Readonly<
      Record<string /*resource media type*/, readonly string[] /*patch media types*/>
    >;
  }>;
  resumableUploads: Feature;
  recursiveDelete: Feature;
  pagination: Feature;
  /** RDF can be stored and content-negotiated (always available on Solid; on LWS bodies are opaque). */
  rdfConneg: Feature<{ formats: string[] }>;
}

export interface ResolveOptions {
  fetch: typeof fetch; // the app's authenticated fetch (guarded)
  cache?: DescriptionCache; // default: in-memory Map; `createIndexedDbCache()` from './cache'
  /** Headers of a response for `url` the caller already has — avoids one HEAD. */
  seedHeaders?: Headers;
  maxAncestorProbes?: number; // default 8 (Solid ancestor walk)
  signal?: AbortSignal;
  now?: () => number;
}

export interface DescriptionCache {
  get(
    storageId: string,
  ): Promise<{ description: StorageDescription; probe?: ProbeResult } | undefined>;
  set(
    storageId: string,
    v: { description: StorageDescription; probe?: ProbeResult },
  ): Promise<void>;
  delete(storageId: string): Promise<void>;
  /** Maps resource URL prefix → storageId so the next lookup for a sibling needs no network. */
  rememberPrefix(root: string, storageId: string): Promise<void>;
  lookupPrefix(url: string): Promise<string | undefined>;
}

/** Access modes reported by WAC-Allow. */
export type WacMode = "read" | "write" | "append" | "control";
/** Raw response header supporting a probe observation. */
export interface ProbeEvidence {
  readonly header: string;
  readonly value: string;
}
/** Parsed observations from one probe response. */
export interface ProbeResult {
  /** URL that was probed (normalised, no fragment). */
  readonly url: string;
  /** Epoch milliseconds when the probe response was received. */
  readonly observedAt: number;
  /** Media types from Accept-Patch, lower-cased, parameters stripped; undefined if header absent. */
  readonly acceptPatch?: readonly string[];
  /** Media types from Accept-Post (same normalisation). */
  readonly acceptPost?: readonly string[];
  /** Methods from Allow, upper-cased. */
  readonly allow?: readonly string[];
  /** Parsed WAC-Allow header; undefined if absent or unparsable. */
  readonly wacAllow?: { readonly user: readonly WacMode[]; readonly public: readonly WacMode[] };
  /** Absolute target of Link rel="acl". */
  readonly aclLink?: string;
  /** Absolute target of Link rel="http://www.w3.org/ns/solid/acp#accessControl". */
  readonly acpLink?: string;
  /** Raw headers that produced the fields above, in response order. */
  readonly evidence: readonly ProbeEvidence[];
}
