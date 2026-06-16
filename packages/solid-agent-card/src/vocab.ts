// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs + protocol constants for the Solid agent-pointer surface (M1 of the
// agentic-Solid roadmap). This is the single source of the string IRIs / paths
// the typed wrappers, the builder, the discoverer and the validator all key on.
//
// Vocabularies used (all EXTERNAL standards — no bespoke `@jeswr/…` agent vocab
// is minted here; M1 deliberately reuses standard predicates so the pointer is
// readable by industry (A2A) and RDF (ANP/Solid) tooling alike):
//   - schema.org  (`schema:agent` person→agent link, agent metadata)
//   - Solid Interop / SAI (`interop:hasAuthorizationAgent` — "the agent that
//     represents you", discovered from the WebID profile)
//   - ANP Agent Description Protocol JSON-LD context (the RDF-reach descriptor)
//   - A2A Agent Card (the industry-reach JSON descriptor — a constant path/schema)
//   - foaf / rdf / dcterms for the profile graph

/** schema.org namespace. */
export const SCHEMA = "https://schema.org/" as const;
/** schema.org (http) — the legacy/alternate base some profiles use. */
export const SCHEMA_HTTP = "http://schema.org/" as const;
/** Solid Interoperability (SAI) namespace. */
export const INTEROP = "http://www.w3.org/ns/solid/interop#" as const;
/** FOAF namespace. */
export const FOAF = "http://xmlns.com/foaf/0.1/" as const;
/** Dublin Core terms namespace. */
export const DCTERMS = "http://purl.org/dc/terms/" as const;
/** RDF namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;
/** RDFS namespace. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#" as const;

/**
 * The ANP Agent Description Protocol vocabulary namespace.
 *
 * ANP (the W3C CG "AI Agent Protocol", https://w3c-cg.github.io/ai-agent-protocol/)
 * publishes its Agent Description (ADP) terms under this base. The exact context
 * URL is pinned at {@link ANP_CONTEXT_URL}; this `ad:` base is what the JSON-LD
 * `@context` expands its terms to. Treated as a config constant (the spec is a
 * fast-moving CG draft — pin + watch).
 */
export const ANP_AD = "https://w3id.org/agent-description#" as const;

/**
 * The published JSON-LD `@context` URL the ANP Agent Description references.
 * Pinned as a constant so a context/path churn is a one-line config change
 * (roadmap M1 risk: "A2A well-known path / card schema churn — pin a dated
 * spec URL and treat the path as a config constant"). Exposed for consumers who
 * want to reference the remote context; the document this package EMITS uses the
 * self-contained {@link ANP_INLINE_CONTEXT} instead (see below).
 */
export const ANP_CONTEXT_URL = "https://w3id.org/agent-description/v1" as const;

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
export const ANP_INLINE_CONTEXT: Readonly<Record<string, unknown>> = {
  ad: ANP_AD,
  AgentDescription: `${ANP_AD}AgentDescription`,
  Skill: `${ANP_AD}Skill`,
  SecurityScheme: `${ANP_AD}SecurityScheme`,
  name: `${ANP_AD}name`,
  description: `${ANP_AD}description`,
  url: { "@id": `${ANP_AD}url`, "@type": "@id" },
  did: `${ANP_AD}did`,
  owner: { "@id": `${ANP_AD}owner`, "@type": "@id" },
  protocolSource: { "@id": `${ANP_AD}protocolSource`, "@type": "@id" },
  skill: { "@id": `${ANP_AD}skill`, "@type": "@id" },
  securityScheme: { "@id": `${ANP_AD}securityScheme`, "@type": "@id" },
  skillId: `${ANP_AD}skillId`,
  schemeType: `${ANP_AD}schemeType`,
} as const;

/**
 * The well-known discovery path for agent descriptions, aligned with ANP's
 * `/.well-known/agent-descriptions` (DO NOT mint a bespoke path — roadmap M1:
 * "align to ANP's `.well-known/agent-descriptions` rather than a parallel
 * convention"). Relative; resolve against the pod/host origin.
 */
export const WELL_KNOWN_AGENT_DESCRIPTIONS = "/.well-known/agent-descriptions" as const;

/**
 * The A2A Agent Card well-known path (RFC 8615), `/.well-known/agent-card.json`.
 * The A2A spec is Linux-Foundation-governed and fast-moving — this path + the
 * card schema are a pinned watch item (roadmap M1 risk). Relative; resolve
 * against the agent host origin.
 */
export const WELL_KNOWN_AGENT_CARD = "/.well-known/agent-card.json" as const;

/**
 * The A2A protocol version this builder targets. A pinned constant (watch item).
 * Emitted as the Agent Card's `protocolVersion`.
 */
export const A2A_PROTOCOL_VERSION = "0.3.0" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

/**
 * The person→agent pointer predicates, in priority order. A WebID profile links
 * the person (the WebID subject) to the agent that represents them. We read /
 * write the standard predicates rather than a bespoke one:
 *   1. `interop:hasAuthorizationAgent` — the SAI "agent that represents you"
 *      (the most precise; roadmap M1's primary predicate).
 *   2. `schema:agent` — the schema.org person→agent link (industry reach).
 */
export const HAS_AUTHORIZATION_AGENT = `${INTEROP}hasAuthorizationAgent` as const;
export const SCHEMA_AGENT = `${SCHEMA}agent` as const;
export const SCHEMA_AGENT_HTTP = `${SCHEMA_HTTP}agent` as const;

/** The ordered set of predicates {@link discoverAgent} reads as a person→agent link. */
export const AGENT_POINTER_PREDICATES = [
  HAS_AUTHORIZATION_AGENT,
  SCHEMA_AGENT,
  SCHEMA_AGENT_HTTP,
] as const;

/** ANP Agent Description classes / properties used by the builder + wrappers. */
export const AD_AGENT_DESCRIPTION = `${ANP_AD}AgentDescription` as const;
export const AD_NAME = `${ANP_AD}name` as const;
export const AD_DESCRIPTION = `${ANP_AD}description` as const;
export const AD_URL = `${ANP_AD}url` as const;
export const AD_DID = `${ANP_AD}did` as const;
export const AD_OWNER = `${ANP_AD}owner` as const;
export const AD_SECURITY_SCHEME = `${ANP_AD}securityScheme` as const;
export const AD_PROTOCOL_SOURCE = `${ANP_AD}protocolSource` as const;
export const AD_SKILL = `${ANP_AD}skill` as const;

/** ANP Skill class / properties. */
export const AD_SKILL_CLASS = `${ANP_AD}Skill` as const;
export const AD_SKILL_ID = `${ANP_AD}skillId` as const;

/** ANP SecurityScheme class / properties. */
export const AD_SECURITY_SCHEME_CLASS = `${ANP_AD}SecurityScheme` as const;
export const AD_SCHEME_TYPE = `${ANP_AD}schemeType` as const;

/**
 * The security-scheme types this builder understands. `solid-oidc` is the Solid
 * default (WebID + Solid-OIDC + DPoP, RFC 9449); `public` means unauthenticated
 * read; `bearer`/`oauth2` cover the generic A2A cases. M1 uses a PLAIN own-WebID
 * Solid-OIDC DPoP token — delegation (`act`-chain) is deferred to the gated
 * CORE-PSS milestone M5(b), so it is deliberately NOT a scheme type here.
 */
export const SECURITY_SCHEME_TYPES = ["solid-oidc", "public", "bearer", "oauth2"] as const;

/** A security-scheme type. */
export type SecuritySchemeType = (typeof SECURITY_SCHEME_TYPES)[number];

/** The set of valid security-scheme types, for validation. */
export const VALID_SECURITY_SCHEME_TYPES: ReadonlySet<string> = new Set(SECURITY_SCHEME_TYPES);
