// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs + protocol constants for the NL→RDF intent / SHACL-PD / upgrade-
// handshake surface (M2 of the agentic-Solid roadmap). This is the single source
// of the string IRIs the typed wrappers, the deterministic translator, the SHACL
// shape builder, the Protocol Document builder and the handshake codec all key on.
//
// Vocabulary policy (LD/SW best practice — reuse standards; mint a MINIMAL
// `@jeswr/` extension only for the intent-glue terms that have no standard
// equivalent). Standards used:
//   - schema.org Action vocabulary (schema:ReadAction / CreateAction / …,
//     schema:object / schema:target / schema:agent / schema:recipient) — the
//     verbs map onto these where one fits.
//   - LDP (ldp:Container / ldp:Resource) — the resource/container target types.
//   - ACL/WAC modes (acl:Read / Write / Append / Control) — the grant modes.
//   - SHACL (sh:…) — the shapes that bind the request/response RDF.
// The minted `a2a:` extension (https://w3id.org/jeswr/a2a#) carries ONLY the few
// intent-glue terms standards do not provide (the Intent class, a parameter
// reification, and the action subtypes — Append/List/Grant/Subscribe/Query — that
// schema.org has no Action subclass for). Each minted term is documented below.

/** schema.org namespace. */
export const SCHEMA = "https://schema.org/" as const;
/** LDP namespace. */
export const LDP = "http://www.w3.org/ns/ldp#" as const;
/** ACL / WAC namespace. */
export const ACL = "http://www.w3.org/ns/auth/acl#" as const;
/** SHACL namespace. */
export const SH = "http://www.w3.org/ns/shacl#" as const;
/** XSD namespace (datatypes). */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;
/** RDF namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;
/** RDFS namespace. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#" as const;
/** Dublin Core terms namespace. */
export const DCTERMS = "http://purl.org/dc/terms/" as const;

/**
 * The minimal minted `@jeswr/` extension vocabulary for the agent-to-agent (A2A)
 * intent surface. Hosted under the user's `w3id.org/jeswr` home (NEVER `@solid/`,
 * which is the W3C Solid org's scope). Kept deliberately small — only terms with
 * no standard equivalent live here:
 *   - `a2a:Intent`            — the intent node class (the request envelope; there
 *                               is no standard "agent intent" class).
 *   - `a2a:action`            — links an Intent to its action node (a schema:Action
 *                               subclass). Distinct from schema:object/target so the
 *                               action verb is first-class on the intent.
 *   - `a2a:parameter`         — links an Intent to a typed key/value parameter node.
 *   - `a2a:paramKey` / `a2a:paramValue` — the parameter reification (no standard
 *                               key/value parameter pair fits an arbitrary agent arg).
 *   - `a2a:mode`              — links a grant intent to an acl: mode (acl has no
 *                               "requested mode on an action" predicate).
 *   - `a2a:AppendAction` / `a2a:ListAction` / `a2a:GrantAction` /
 *     `a2a:SubscribeAction` / `a2a:QueryAction` — the action subtypes schema.org
 *                               lacks a direct subclass for (schema covers
 *                               Read/Create/Update/Delete only).
 */
export const A2A = "https://w3id.org/jeswr/a2a#" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

// --- schema.org Action subclasses (standard verbs) -----------------------
/** `schema:ReadAction` — read/get/fetch. */
export const SCHEMA_READ_ACTION = `${SCHEMA}ReadAction` as const;
/** `schema:CreateAction` — create/write/put/add. */
export const SCHEMA_CREATE_ACTION = `${SCHEMA}CreateAction` as const;
/** `schema:UpdateAction` — update/modify/change. */
export const SCHEMA_UPDATE_ACTION = `${SCHEMA}UpdateAction` as const;
/** `schema:DeleteAction` — delete/remove. */
export const SCHEMA_DELETE_ACTION = `${SCHEMA}DeleteAction` as const;

// --- minted action subclasses (no schema.org equivalent) -----------------
/** `a2a:AppendAction` — append (acl:Append). */
export const A2A_APPEND_ACTION = `${A2A}AppendAction` as const;
/** `a2a:ListAction` — enumerate a container's members. */
export const A2A_LIST_ACTION = `${A2A}ListAction` as const;
/** `a2a:GrantAction` — share / give-access (carries acl modes + a recipient). */
export const A2A_GRANT_ACTION = `${A2A}GrantAction` as const;
/** `a2a:SubscribeAction` — subscribe / watch / notify. */
export const A2A_SUBSCRIBE_ACTION = `${A2A}SubscribeAction` as const;
/** `a2a:QueryAction` — query / search / find. */
export const A2A_QUERY_ACTION = `${A2A}QueryAction` as const;

// --- intent-glue predicates / classes (minted) ---------------------------
/** `a2a:Intent` — the intent node class. */
export const A2A_INTENT = `${A2A}Intent` as const;
/** `a2a:action` — Intent → action node. */
export const A2A_ACTION = `${A2A}action` as const;
/** `a2a:parameter` — Intent → parameter node. */
export const A2A_PARAMETER = `${A2A}parameter` as const;
/** `a2a:Parameter` — a typed key/value parameter node class. */
export const A2A_PARAMETER_CLASS = `${A2A}Parameter` as const;
/** `a2a:paramKey` — parameter key (literal). */
export const A2A_PARAM_KEY = `${A2A}paramKey` as const;
/** `a2a:paramValue` — parameter value (literal). */
export const A2A_PARAM_VALUE = `${A2A}paramValue` as const;
/** `a2a:mode` — grant action → requested acl: mode. */
export const A2A_MODE = `${A2A}mode` as const;

// --- schema.org action predicates (standard) -----------------------------
/** `schema:object` — the action's direct object (the target resource/class). */
export const SCHEMA_OBJECT = `${SCHEMA}object` as const;
/** `schema:target` — the action's target (used for the container of a list). */
export const SCHEMA_TARGET = `${SCHEMA}target` as const;
/** `schema:agent` — the agent performing the action (the requester). */
export const SCHEMA_AGENT = `${SCHEMA}agent` as const;
/** `schema:recipient` — the recipient of a grant (the agent being granted access). */
export const SCHEMA_RECIPIENT = `${SCHEMA}recipient` as const;

// --- ACL / WAC modes (standard) ------------------------------------------
/** `acl:Read`. */
export const ACL_READ = `${ACL}Read` as const;
/** `acl:Write`. */
export const ACL_WRITE = `${ACL}Write` as const;
/** `acl:Append`. */
export const ACL_APPEND = `${ACL}Append` as const;
/** `acl:Control`. */
export const ACL_CONTROL = `${ACL}Control` as const;

/** The closed set of ACL modes a grant intent can carry. */
export const ACL_MODES = ["Read", "Write", "Append", "Control"] as const;
/** An ACL mode short name. */
export type AclMode = (typeof ACL_MODES)[number];
/** Map a short ACL mode name to its full IRI. */
export const ACL_MODE_IRI: Readonly<Record<AclMode, string>> = {
  Read: ACL_READ,
  Write: ACL_WRITE,
  Append: ACL_APPEND,
  Control: ACL_CONTROL,
};
/** The set of valid ACL mode IRIs, for validation/round-trip. */
export const VALID_ACL_MODE_IRIS: ReadonlySet<string> = new Set(Object.values(ACL_MODE_IRI));

// --- LDP target types (standard) -----------------------------------------
/** `ldp:Container` — the target class of a list intent. */
export const LDP_CONTAINER = `${LDP}Container` as const;
/** `ldp:Resource`. */
export const LDP_RESOURCE = `${LDP}Resource` as const;

/**
 * The closed set of intent action kinds the deterministic translator + the
 * RDF/SHACL layer understand. A stable, machine-readable enum independent of the
 * (verbose) IRIs — the structured `Intent.action` carries one of these.
 */
export const INTENT_ACTIONS = [
  "read",
  "create",
  "update",
  "append",
  "delete",
  "list",
  "grant",
  "subscribe",
  "query",
] as const;
/** An intent action kind. */
export type IntentAction = (typeof INTENT_ACTIONS)[number];
/** The set of valid intent action kinds, for validation. */
export const VALID_INTENT_ACTIONS: ReadonlySet<string> = new Set(INTENT_ACTIONS);

/** Map an intent action kind to its RDF action-type IRI (schema.org or minted). */
export const ACTION_TYPE_IRI: Readonly<Record<IntentAction, string>> = {
  read: SCHEMA_READ_ACTION,
  create: SCHEMA_CREATE_ACTION,
  update: SCHEMA_UPDATE_ACTION,
  append: A2A_APPEND_ACTION,
  delete: SCHEMA_DELETE_ACTION,
  list: A2A_LIST_ACTION,
  grant: A2A_GRANT_ACTION,
  subscribe: A2A_SUBSCRIBE_ACTION,
  query: A2A_QUERY_ACTION,
};

/** The reverse map: action-type IRI → intent action kind (for round-trip read). */
export const IRI_TO_ACTION: Readonly<Record<string, IntentAction>> = Object.fromEntries(
  Object.entries(ACTION_TYPE_IRI).map(([k, v]) => [v, k as IntentAction]),
) as Readonly<Record<string, IntentAction>>;

/**
 * A SELF-CONTAINED inline JSON-LD `@context` for the intent graph. Like M1, the
 * emitted JSON-LD embeds this rather than a bare remote `@context` URL, so the
 * document parses with NO network (offline + deterministic) and carries no
 * SSRF / availability dependency on a remote (CG-draft) context endpoint.
 * Object/IRI-valued terms carry `"@type": "@id"` so a `{ "@id": … }` value parses
 * as an IRI node, not a string literal.
 */
export const A2A_INLINE_CONTEXT: Readonly<Record<string, unknown>> = {
  a2a: A2A,
  schema: SCHEMA,
  acl: ACL,
  ldp: LDP,
  Intent: A2A_INTENT,
  Parameter: A2A_PARAMETER_CLASS,
  action: { "@id": A2A_ACTION, "@type": "@id" },
  parameter: { "@id": A2A_PARAMETER, "@type": "@id" },
  paramKey: A2A_PARAM_KEY,
  paramValue: A2A_PARAM_VALUE,
  mode: { "@id": A2A_MODE, "@type": "@id" },
  object: { "@id": SCHEMA_OBJECT, "@type": "@id" },
  target: { "@id": SCHEMA_TARGET, "@type": "@id" },
  agent: { "@id": SCHEMA_AGENT, "@type": "@id" },
  recipient: { "@id": SCHEMA_RECIPIENT, "@type": "@id" },
} as const;

/**
 * The hash algorithm used to content-address (hash-pin) a Protocol Document. The
 * original AGORA paper (arXiv:2410.11905) pins by SHA1; this package uses
 * **SHA-256** — the modern, collision-resistant choice (SHA1 is broken for
 * collision resistance, which is the exact property a content hash relies on).
 * Exposed as a constant + the {@link PROTOCOL_HASH_PREFIX} so a verifier knows the
 * algorithm a pin was computed with.
 */
export const PROTOCOL_HASH_ALGORITHM = "sha256" as const;
/** The prefix a {@link PROTOCOL_HASH_ALGORITHM} hash string carries (`sha256:`). */
export const PROTOCOL_HASH_PREFIX = "sha256:" as const;
