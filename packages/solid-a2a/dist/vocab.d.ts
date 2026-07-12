/** schema.org namespace. */
export declare const SCHEMA: "https://schema.org/";
/** LDP namespace. */
export declare const LDP: "http://www.w3.org/ns/ldp#";
/** ACL / WAC namespace. */
export declare const ACL: "http://www.w3.org/ns/auth/acl#";
/** SHACL namespace. */
export declare const SH: "http://www.w3.org/ns/shacl#";
/** XSD namespace (datatypes). */
export declare const XSD: "http://www.w3.org/2001/XMLSchema#";
/** RDF namespace. */
export declare const RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDFS namespace. */
export declare const RDFS: "http://www.w3.org/2000/01/rdf-schema#";
/** Dublin Core terms namespace. */
export declare const DCTERMS: "http://purl.org/dc/terms/";
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
export declare const A2A: "https://w3id.org/jeswr/a2a#";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** `schema:ReadAction` — read/get/fetch. */
export declare const SCHEMA_READ_ACTION: "https://schema.org/ReadAction";
/** `schema:CreateAction` — create/write/put/add. */
export declare const SCHEMA_CREATE_ACTION: "https://schema.org/CreateAction";
/** `schema:UpdateAction` — update/modify/change. */
export declare const SCHEMA_UPDATE_ACTION: "https://schema.org/UpdateAction";
/** `schema:DeleteAction` — delete/remove. */
export declare const SCHEMA_DELETE_ACTION: "https://schema.org/DeleteAction";
/** `a2a:AppendAction` — append (acl:Append). */
export declare const A2A_APPEND_ACTION: "https://w3id.org/jeswr/a2a#AppendAction";
/** `a2a:ListAction` — enumerate a container's members. */
export declare const A2A_LIST_ACTION: "https://w3id.org/jeswr/a2a#ListAction";
/** `a2a:GrantAction` — share / give-access (carries acl modes + a recipient). */
export declare const A2A_GRANT_ACTION: "https://w3id.org/jeswr/a2a#GrantAction";
/** `a2a:SubscribeAction` — subscribe / watch / notify. */
export declare const A2A_SUBSCRIBE_ACTION: "https://w3id.org/jeswr/a2a#SubscribeAction";
/** `a2a:QueryAction` — query / search / find. */
export declare const A2A_QUERY_ACTION: "https://w3id.org/jeswr/a2a#QueryAction";
/** `a2a:Intent` — the intent node class. */
export declare const A2A_INTENT: "https://w3id.org/jeswr/a2a#Intent";
/** `a2a:action` — Intent → action node. */
export declare const A2A_ACTION: "https://w3id.org/jeswr/a2a#action";
/** `a2a:parameter` — Intent → parameter node. */
export declare const A2A_PARAMETER: "https://w3id.org/jeswr/a2a#parameter";
/** `a2a:Parameter` — a typed key/value parameter node class. */
export declare const A2A_PARAMETER_CLASS: "https://w3id.org/jeswr/a2a#Parameter";
/** `a2a:paramKey` — parameter key (literal). */
export declare const A2A_PARAM_KEY: "https://w3id.org/jeswr/a2a#paramKey";
/** `a2a:paramValue` — parameter value (literal). */
export declare const A2A_PARAM_VALUE: "https://w3id.org/jeswr/a2a#paramValue";
/** `a2a:mode` — grant action → requested acl: mode. */
export declare const A2A_MODE: "https://w3id.org/jeswr/a2a#mode";
/** `schema:object` — the action's direct object (the target resource/class). */
export declare const SCHEMA_OBJECT: "https://schema.org/object";
/** `schema:target` — the action's target (used for the container of a list). */
export declare const SCHEMA_TARGET: "https://schema.org/target";
/** `schema:agent` — the agent performing the action (the requester). */
export declare const SCHEMA_AGENT: "https://schema.org/agent";
/** `schema:recipient` — the recipient of a grant (the agent being granted access). */
export declare const SCHEMA_RECIPIENT: "https://schema.org/recipient";
/** `acl:Read`. */
export declare const ACL_READ: "http://www.w3.org/ns/auth/acl#Read";
/** `acl:Write`. */
export declare const ACL_WRITE: "http://www.w3.org/ns/auth/acl#Write";
/** `acl:Append`. */
export declare const ACL_APPEND: "http://www.w3.org/ns/auth/acl#Append";
/** `acl:Control`. */
export declare const ACL_CONTROL: "http://www.w3.org/ns/auth/acl#Control";
/** The closed set of ACL modes a grant intent can carry. */
export declare const ACL_MODES: readonly ["Read", "Write", "Append", "Control"];
/** An ACL mode short name. */
export type AclMode = (typeof ACL_MODES)[number];
/** Map a short ACL mode name to its full IRI. */
export declare const ACL_MODE_IRI: Readonly<Record<AclMode, string>>;
/** The set of valid ACL mode IRIs, for validation/round-trip. */
export declare const VALID_ACL_MODE_IRIS: ReadonlySet<string>;
/** `ldp:Container` — the target class of a list intent. */
export declare const LDP_CONTAINER: "http://www.w3.org/ns/ldp#Container";
/** `ldp:Resource`. */
export declare const LDP_RESOURCE: "http://www.w3.org/ns/ldp#Resource";
/**
 * The closed set of intent action kinds the deterministic translator + the
 * RDF/SHACL layer understand. A stable, machine-readable enum independent of the
 * (verbose) IRIs — the structured `Intent.action` carries one of these.
 */
export declare const INTENT_ACTIONS: readonly ["read", "create", "update", "append", "delete", "list", "grant", "subscribe", "query"];
/** An intent action kind. */
export type IntentAction = (typeof INTENT_ACTIONS)[number];
/** The set of valid intent action kinds, for validation. */
export declare const VALID_INTENT_ACTIONS: ReadonlySet<string>;
/** Map an intent action kind to its RDF action-type IRI (schema.org or minted). */
export declare const ACTION_TYPE_IRI: Readonly<Record<IntentAction, string>>;
/** The reverse map: action-type IRI → intent action kind (for round-trip read). */
export declare const IRI_TO_ACTION: Readonly<Record<string, IntentAction>>;
/**
 * A SELF-CONTAINED inline JSON-LD `@context` for the intent graph. Like M1, the
 * emitted JSON-LD embeds this rather than a bare remote `@context` URL, so the
 * document parses with NO network (offline + deterministic) and carries no
 * SSRF / availability dependency on a remote (CG-draft) context endpoint.
 * Object/IRI-valued terms carry `"@type": "@id"` so a `{ "@id": … }` value parses
 * as an IRI node, not a string literal.
 */
export declare const A2A_INLINE_CONTEXT: Readonly<Record<string, unknown>>;
/**
 * The hash algorithm used to content-address (hash-pin) a Protocol Document. The
 * original AGORA paper (arXiv:2410.11905) pins by SHA1; this package uses
 * **SHA-256** — the modern, collision-resistant choice (SHA1 is broken for
 * collision resistance, which is the exact property a content hash relies on).
 * Exposed as a constant + the {@link PROTOCOL_HASH_PREFIX} so a verifier knows the
 * algorithm a pin was computed with.
 */
export declare const PROTOCOL_HASH_ALGORITHM: "sha256";
/** The prefix a {@link PROTOCOL_HASH_ALGORITHM} hash string carries (`sha256:`). */
export declare const PROTOCOL_HASH_PREFIX: "sha256:";
//# sourceMappingURL=vocab.d.ts.map