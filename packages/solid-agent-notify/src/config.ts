// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * config.ts — the single source of truth for every limit and runtime constant.
 *
 * No magic numbers scattered across files; every value has a coded default and
 * an env override. These bounds are load-bearing for the SSRF / resource-exhaustion
 * defence: the body cap stops a hostile inbox from OOMing us, the redirect cap stops
 * a redirect-bounce attack, the timeout bounds a slowloris.
 */

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

// ─── Fetch / guardedFetch limits ──────────────────────────────────────────────

/** Total fetch timeout per request in ms (covers DNS + connect + TLS + response body). */
export const FETCH_TIMEOUT_MS = envInt("AGENT_NOTIFY_FETCH_TIMEOUT_MS", 8_000);

/** Max HTTP redirects followed per fetch; each hop is re-SSRF-classified. */
export const MAX_REDIRECTS = envInt("AGENT_NOTIFY_MAX_REDIRECTS", 3);

/** Max response body size for a WebID profile document in bytes (256 KiB). */
export const MAX_BYTES_PROFILE = envInt(
  "AGENT_NOTIFY_MAX_BYTES_PROFILE",
  256 * 1024
);

/** Max response body size for an inbox listing / a single notification in bytes (64 KiB). */
export const MAX_BYTES_INBOX = envInt(
  "AGENT_NOTIFY_MAX_BYTES_INBOX",
  64 * 1024
);

/** Max bytes of an LDN inbox's POST response body we will read (the receipt is tiny). */
export const MAX_BYTES_RESPONSE = envInt(
  "AGENT_NOTIFY_MAX_BYTES_RESPONSE",
  16 * 1024
);

/**
 * Descriptive User-Agent for every guardedFetch. A real UA string with a contact
 * URL is good crawler/sender citizenship and lets recipient operators identify us.
 */
export const FETCH_USER_AGENT = envStr(
  "AGENT_NOTIFY_USER_AGENT",
  "solid-agent-notify/0.1 (+https://github.com/jeswr/solid-agent-notify; SSRF-guarded LDN client)"
);

/**
 * Cloud-internal hostname suffixes denied on top of IP classification. A host whose
 * lowercased name equals or ends with one of these is refused BEFORE any DNS
 * resolution, so a name that an internal resolver would map to a metadata/cluster
 * endpoint can never be reached. Defence in depth: the IP classifier already blocks
 * the addresses these names resolve to, but a denied name is cheaper and closes
 * split-horizon DNS gaps.
 */
export const FETCH_HOSTNAME_DENYLIST: readonly string[] = envStr(
  "AGENT_NOTIFY_HOSTNAME_DENYLIST",
  [
    "metadata.google.internal",
    "metadata.goog",
    ".internal",
    ".svc.cluster.local",
    ".cluster.local",
    ".vercel-internal.com",
    "localhost",
    ".localhost",
    ".local",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * RDF serialisations accepted on the FINAL response of an RDF GET (profile / inbox /
 * notification). `text/html`/RDFa is excluded (smaller attack surface). Matched
 * against the bare media type (before `;`), case-insensitively.
 */
export const RDF_CONTENT_TYPES: readonly string[] = [
  "text/turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
];

/** The `Accept` header guardedFetch sends for RDF documents (mirrors {@link RDF_CONTENT_TYPES}). */
export const RDF_ACCEPT =
  "text/turtle, application/ld+json;q=0.9, application/n-triples;q=0.8";

/** The LDP inbox predicate (also `as:inbox` in AS2.0; the LDP one is canonical for LDN). */
export const LDP_INBOX = "http://www.w3.org/ns/ldp#inbox";

/** The ActivityStreams 2.0 namespace. */
export const AS = "https://www.w3.org/ns/activitystreams#";

/** The rdf:type predicate. */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** The LDP `contains` predicate (an inbox container lists its members with this). */
export const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";

// ─── Shared federation task model (https://w3id.org/jeswr/task) ────────────────
//
// The cross-app task/issue model the ecosystem (solid-issues, Pod Manager) agrees
// on, pinned by the federation vocab at https://w3id.org/jeswr/task. It is the
// canonical RE-USE of established vocabularies (NOT a new ontology): a task is a
// `wf:Task`, its lifecycle state is `rdf:type wf:Open|wf:Closed`, metadata is
// `dct:`, assignment is `wf:assignee`, and a cross-app task event is an
// `as:Announce` whose `as:object` is the task. The IRIs below are the OWNING
// vocabularies (the task vocab does not mint terms), so a notification carrying a
// `wf:Task` resolves against the real SolidOS workflow + Dublin Core ontologies.

/** The W3C SolidOS workflow ontology namespace (`wf:`) — the task class + state + assignee. */
export const WF = "http://www.w3.org/2005/01/wf/flow#";

/** Dublin Core Terms namespace (`dct:`) — task title / description / created / creator. */
export const DCT = "http://purl.org/dc/terms/";

/** The shared-task home vocab IRI (`https://w3id.org/jeswr/task`), for `rdfs:seeAlso` / provenance. */
export const TASK_VOCAB = "https://w3id.org/jeswr/task";
