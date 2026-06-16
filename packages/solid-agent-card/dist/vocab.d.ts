/** schema.org namespace. */
export declare const SCHEMA: "https://schema.org/";
/** schema.org (http) — the legacy/alternate base some profiles use. */
export declare const SCHEMA_HTTP: "http://schema.org/";
/** Solid Interoperability (SAI) namespace. */
export declare const INTEROP: "http://www.w3.org/ns/solid/interop#";
/** FOAF namespace. */
export declare const FOAF: "http://xmlns.com/foaf/0.1/";
/** Dublin Core terms namespace. */
export declare const DCTERMS: "http://purl.org/dc/terms/";
/** RDF namespace. */
export declare const RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDFS namespace. */
export declare const RDFS: "http://www.w3.org/2000/01/rdf-schema#";
/**
 * The ANP Agent Description Protocol vocabulary namespace.
 *
 * ANP (the W3C CG "AI Agent Protocol", https://w3c-cg.github.io/ai-agent-protocol/)
 * publishes its Agent Description (ADP) terms under this base. The exact context
 * URL is pinned at {@link ANP_CONTEXT_URL}; this `ad:` base is what the JSON-LD
 * `@context` expands its terms to. Treated as a config constant (the spec is a
 * fast-moving CG draft — pin + watch).
 */
export declare const ANP_AD: "https://w3id.org/agent-description#";
/**
 * The published JSON-LD `@context` URL the ANP Agent Description references.
 * Pinned as a constant so a context/path churn is a one-line config change
 * (roadmap M1 risk: "A2A well-known path / card schema churn — pin a dated
 * spec URL and treat the path as a config constant"). Exposed for consumers who
 * want to reference the remote context; the document this package EMITS uses the
 * self-contained {@link ANP_INLINE_CONTEXT} instead (see below).
 */
export declare const ANP_CONTEXT_URL: "https://w3id.org/agent-description/v1";
/**
 * A SELF-CONTAINED inline JSON-LD `@context` mapping the ANP Agent Description
 * terms to their IRIs. The emitted JSON-LD embeds this rather than a bare remote
 * `@context` URL, for two load-bearing reasons:
 *   1. **Offline / deterministic parsing** — a remote `@context` makes the
 *      document un-parseable without dereferencing the (CG-draft, possibly
 *      unresolvable) URL, and is an SSRF/availability dependency on a third party.
 *      An inline context parses with no network and is reproducible.
 *   2. **Stability** — the ANP context is a fast-moving CG draft; inlining pins
 *      the exact term→IRI mapping this package emits, decoupled from upstream
 *      churn. (When ANP's context stabilises, switch to the remote URL.)
 * Object/IRI-valued terms carry `"@type": "@id"` so a `{ "@id": … }` value parses
 * as an IRI node rather than a string literal.
 */
export declare const ANP_INLINE_CONTEXT: Readonly<Record<string, unknown>>;
/**
 * The well-known discovery path for agent descriptions, aligned with ANP's
 * `/.well-known/agent-descriptions` (DO NOT mint a bespoke path — roadmap M1:
 * "align to ANP's `.well-known/agent-descriptions` rather than a parallel
 * convention"). Relative; resolve against the pod/host origin.
 */
export declare const WELL_KNOWN_AGENT_DESCRIPTIONS: "/.well-known/agent-descriptions";
/**
 * The A2A Agent Card well-known path (RFC 8615), `/.well-known/agent-card.json`.
 * The A2A spec is Linux-Foundation-governed and fast-moving — this path + the
 * card schema are a pinned watch item (roadmap M1 risk). Relative; resolve
 * against the agent host origin.
 */
export declare const WELL_KNOWN_AGENT_CARD: "/.well-known/agent-card.json";
/**
 * The A2A protocol version this builder targets. A pinned constant (watch item).
 * Emitted as the Agent Card's `protocolVersion`.
 */
export declare const A2A_PROTOCOL_VERSION: "0.3.0";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/**
 * The person→agent pointer predicates, in priority order. A WebID profile links
 * the person (the WebID subject) to the agent that represents them. We read /
 * write the standard predicates rather than a bespoke one:
 *   1. `interop:hasAuthorizationAgent` — the SAI "agent that represents you"
 *      (the most precise; roadmap M1's primary predicate).
 *   2. `schema:agent` — the schema.org person→agent link (industry reach).
 */
export declare const HAS_AUTHORIZATION_AGENT: "http://www.w3.org/ns/solid/interop#hasAuthorizationAgent";
export declare const SCHEMA_AGENT: "https://schema.org/agent";
export declare const SCHEMA_AGENT_HTTP: "http://schema.org/agent";
/** The ordered set of predicates {@link discoverAgent} reads as a person→agent link. */
export declare const AGENT_POINTER_PREDICATES: readonly ["http://www.w3.org/ns/solid/interop#hasAuthorizationAgent", "https://schema.org/agent", "http://schema.org/agent"];
/** ANP Agent Description classes / properties used by the builder + wrappers. */
export declare const AD_AGENT_DESCRIPTION: "https://w3id.org/agent-description#AgentDescription";
export declare const AD_NAME: "https://w3id.org/agent-description#name";
export declare const AD_DESCRIPTION: "https://w3id.org/agent-description#description";
export declare const AD_URL: "https://w3id.org/agent-description#url";
export declare const AD_DID: "https://w3id.org/agent-description#did";
export declare const AD_OWNER: "https://w3id.org/agent-description#owner";
export declare const AD_SECURITY_SCHEME: "https://w3id.org/agent-description#securityScheme";
export declare const AD_PROTOCOL_SOURCE: "https://w3id.org/agent-description#protocolSource";
export declare const AD_SKILL: "https://w3id.org/agent-description#skill";
/** ANP Skill class / properties. */
export declare const AD_SKILL_CLASS: "https://w3id.org/agent-description#Skill";
export declare const AD_SKILL_ID: "https://w3id.org/agent-description#skillId";
/** ANP SecurityScheme class / properties. */
export declare const AD_SECURITY_SCHEME_CLASS: "https://w3id.org/agent-description#SecurityScheme";
export declare const AD_SCHEME_TYPE: "https://w3id.org/agent-description#schemeType";
/**
 * The security-scheme types this builder understands. `solid-oidc` is the Solid
 * default (WebID + Solid-OIDC + DPoP, RFC 9449); `public` means unauthenticated
 * read; `bearer`/`oauth2` cover the generic A2A cases. M1 uses a PLAIN own-WebID
 * Solid-OIDC DPoP token — delegation (`act`-chain) is deferred to the gated
 * CORE-PSS milestone M5(b), so it is deliberately NOT a scheme type here.
 */
export declare const SECURITY_SCHEME_TYPES: readonly ["solid-oidc", "public", "bearer", "oauth2"];
/** A security-scheme type. */
export type SecuritySchemeType = (typeof SECURITY_SCHEME_TYPES)[number];
/** The set of valid security-scheme types, for validation. */
export declare const VALID_SECURITY_SCHEME_TYPES: ReadonlySet<string>;
//# sourceMappingURL=vocab.d.ts.map