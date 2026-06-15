/**
 * config.ts — the single source of truth for every limit and runtime constant.
 *
 * No magic numbers scattered across files; every value has a coded default and
 * an env override. These bounds are load-bearing for the SSRF / resource-exhaustion
 * defence: the body cap stops a hostile inbox from OOMing us, the redirect cap stops
 * a redirect-bounce attack, the timeout bounds a slowloris.
 */
/** Total fetch timeout per request in ms (covers DNS + connect + TLS + response body). */
export declare const FETCH_TIMEOUT_MS: number;
/** Max HTTP redirects followed per fetch; each hop is re-SSRF-classified. */
export declare const MAX_REDIRECTS: number;
/** Max response body size for a WebID profile document in bytes (256 KiB). */
export declare const MAX_BYTES_PROFILE: number;
/** Max response body size for an inbox listing / a single notification in bytes (64 KiB). */
export declare const MAX_BYTES_INBOX: number;
/** Max bytes of an LDN inbox's POST response body we will read (the receipt is tiny). */
export declare const MAX_BYTES_RESPONSE: number;
/**
 * Descriptive User-Agent for every guardedFetch. A real UA string with a contact
 * URL is good crawler/sender citizenship and lets recipient operators identify us.
 */
export declare const FETCH_USER_AGENT: string;
/**
 * Cloud-internal hostname suffixes denied on top of IP classification. A host whose
 * lowercased name equals or ends with one of these is refused BEFORE any DNS
 * resolution, so a name that an internal resolver would map to a metadata/cluster
 * endpoint can never be reached. Defence in depth: the IP classifier already blocks
 * the addresses these names resolve to, but a denied name is cheaper and closes
 * split-horizon DNS gaps.
 */
export declare const FETCH_HOSTNAME_DENYLIST: readonly string[];
/**
 * RDF serialisations accepted on the FINAL response of an RDF GET (profile / inbox /
 * notification). `text/html`/RDFa is excluded (smaller attack surface). Matched
 * against the bare media type (before `;`), case-insensitively.
 */
export declare const RDF_CONTENT_TYPES: readonly string[];
/** The `Accept` header guardedFetch sends for RDF documents (mirrors {@link RDF_CONTENT_TYPES}). */
export declare const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9, application/n-triples;q=0.8";
/** The LDP inbox predicate (also `as:inbox` in AS2.0; the LDP one is canonical for LDN). */
export declare const LDP_INBOX = "http://www.w3.org/ns/ldp#inbox";
/** The ActivityStreams 2.0 namespace. */
export declare const AS = "https://www.w3.org/ns/activitystreams#";
/** The rdf:type predicate. */
export declare const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** The LDP `contains` predicate (an inbox container lists its members with this). */
export declare const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
/** The W3C SolidOS workflow ontology namespace (`wf:`) — the task class + state + assignee. */
export declare const WF = "http://www.w3.org/2005/01/wf/flow#";
/** Dublin Core Terms namespace (`dct:`) — task title / description / created / creator. */
export declare const DCT = "http://purl.org/dc/terms/";
/** The shared-task home vocab IRI (`https://w3id.org/jeswr/task`), for `rdfs:seeAlso` / provenance. */
export declare const TASK_VOCAB = "https://w3id.org/jeswr/task";
//# sourceMappingURL=config.d.ts.map