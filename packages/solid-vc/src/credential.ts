// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Credential ↔ RDF lowering + round-trip, and the agent-authorization
// builder. `credentialToRdf` lowers a structured Credential to quads (via the
// typed GraphBuilder write path — never hand-built triples); `credentialToTurtle`
// /`credentialToJsonLd` serialise; `credentialFromRdf`/`parseCredential` read it
// back. All RDF reads/writes go through src/wrappers.ts.

import { randomUUID } from "node:crypto";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { digestRdfContent } from "./digest.js";
import { isAbsoluteIri, requireObjectIri, safeObjectIri } from "./iri.js";
import { serialize } from "./serialize.js";
import type {
  AgentAuthorization,
  BitstringStatusListEntry,
  Credential,
  CredentialSubject,
  JsonValue,
  RelatedResource,
} from "./types.js";
import {
  RDF_TYPE,
  SCHEMA_ENCODING_FORMAT,
  SEC_DIGEST_MULTIBASE,
  SEC_MULTIBASE,
  STATUS_BITSTRING_CREDENTIAL,
  STATUS_BITSTRING_ENTRY,
  STATUS_BITSTRING_LIST,
  STATUS_ENCODED_LIST,
  STATUS_LIST_CREDENTIAL,
  STATUS_LIST_INDEX,
  STATUS_PURPOSE,
  SVC_ACTION,
  SVC_AGENT_AUTHORIZATION,
  SVC_AUTHORIZES,
  SVC_INLINE_CONTEXT,
  SVC_POLICY,
  SVC_TARGET,
  VC_CREDENTIAL,
  VC_CREDENTIAL_STATUS,
  VC_CREDENTIAL_SUBJECT,
  VC_ISSUER,
  VC_RELATED_RESOURCE,
  VC_VALID_FROM,
  VC_VALID_UNTIL,
  XSD,
} from "./vocab.js";
import {
  type CredentialNode,
  firstIri,
  firstLiteral,
  GraphBuilder,
  iriRef,
  type NodeRef,
  wrapVc,
} from "./wrappers.js";

/** Whether a string looks like an absolute IRI (scheme + `:`). */
function looksLikeIri(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/** Resolve a (possibly relative) credential type to an absolute IRI. */
function typeIri(type: string): string {
  if (type === "VerifiableCredential") return VC_CREDENTIAL;
  if (type === "AgentAuthorizationCredential") return SVC_AGENT_AUTHORIZATION;
  // The Bitstring Status List classes — defined by the VC 2.0 base context, so
  // the bare names the JSON-LD projection keeps expand to these SAME IRIs.
  if (type === "BitstringStatusListCredential") return STATUS_BITSTRING_CREDENTIAL;
  if (type === "BitstringStatusList") return STATUS_BITSTRING_LIST;
  if (type === "BitstringStatusListEntry") return STATUS_BITSTRING_ENTRY;
  if (looksLikeIri(type)) return type;
  // A bare extension type name: home it under the @jeswr svc extension namespace.
  return `https://w3id.org/jeswr/solid-vc#${type}`;
}

/**
 * Normalise a credential-subject `id`, shared by the RDF ({@link writeSubject}) and
 * JSON-LD ({@link credentialToJsonLd}) projections so BOTH treat the id identically:
 *
 *  - a BLANK id (absent / empty `""` / whitespace-only) → `undefined` = an ANONYMOUS
 *    subject (a blank node in RDF; no `@id` in JSON-LD). Load-bearing for JSON-LD:
 *    an empty-string `@id` is a PRESENT RELATIVE reference that resolves against the
 *    document base, NOT an anonymous subject — so it must be OMITTED, not copied.
 *  - a PRESENT (non-blank) id → must be an absolute IRI, else THROW (fail closed on a
 *    relative / malformed identity). Returned VERBATIM — NO canonicalisation — so a
 *    valid id's bytes are unchanged and the two projections stay byte-for-byte in
 *    lock-step. Injection is separately neutralised by `escapeIri` at the write
 *    chokepoint; this is the semantic identity requirement.
 */
function normalizeSubjectId(id: string | undefined): string | undefined {
  if (typeof id !== "string" || id.trim().length === 0) return undefined;
  if (!isAbsoluteIri(id)) {
    throw new Error(
      `@jeswr/solid-vc: credentialSubject.id must be an absolute IRI, got ${JSON.stringify(
        id,
      )} — refusing to emit a credential subject with a relative/invalid id`,
    );
  }
  return id;
}

/**
 * Return the subject with its id NORMALISED to match the signed RDF graph: identical
 * when the id is absolute, but with a BLANK id (empty `""` / whitespace / absent)
 * STRIPPED so the subject is anonymous (no `@id`, matching the RDF blank node).
 * Throws (via {@link normalizeSubjectId}) on a present relative/malformed id. Used by
 * every OUTPUT projection — `credentialToJsonLd` AND the signed VC that `issue()`
 * returns — so the returned/serialised subject can never disagree with the blank-node
 * graph the proof was computed over.
 */
function subjectWithNormalizedId(subject: CredentialSubject): CredentialSubject {
  if (normalizeSubjectId(subject.id) !== undefined) return subject; // valid absolute id → verbatim
  if (!("id" in subject)) return subject; // never had an id → nothing to strip
  const { id: _blank, ...rest } = subject; // blank id → drop it (anonymous)
  return rest;
}

/**
 * Return a {@link Credential} whose `credentialSubject` id(s) are normalised EXACTLY
 * as the signed RDF graph normalises them ({@link subjectWithNormalizedId} on the
 * single subject or each element of a subject array): a blank id is stripped
 * (anonymous), a present non-blank id must be absolute (throws). `issue()` runs the
 * returned VC through this so the SIGNED graph (a blank node for a blank id) and the
 * RETURNED object agree — a whitespace-only `id` can never survive in the returned VC
 * as a present relative JSON-LD `@id`. Idempotent, and a no-op for a credential whose
 * subjects all carry a valid absolute id or no id.
 */
export function normalizeCredentialSubjects(credential: Credential): Credential {
  const cs = credential.credentialSubject;
  // `Array.isArray` narrows the array branch but not the single branch out of a
  // `readonly T[]` union member, so cast the single value (the branch is provably a
  // lone CredentialSubject). Shape (single vs array) is preserved.
  const credentialSubject = Array.isArray(cs)
    ? cs.map(subjectWithNormalizedId)
    : subjectWithNormalizedId(cs as CredentialSubject);
  return { ...credential, credentialSubject };
}

/**
 * Write one credential-subject node (its `id` and arbitrary claims) under the
 * credential `subject` via `cred:credentialSubject`. Claims whose value is an
 * absolute-IRI string are written as IRI objects; everything else as a typed
 * literal (so the JSON booleans/numbers round-trip with their XSD datatype).
 */
function writeSubject(b: GraphBuilder, credential: NodeRef, subject: CredentialSubject): void {
  // Shared rule: a valid absolute id is written verbatim; a BLANK id (empty /
  // whitespace / absent) becomes an anonymous blank node; a present relative id
  // FAILS CLOSED (throws).
  const idIri = normalizeSubjectId(subject.id);
  let node: NodeRef;
  if (idIri !== undefined) {
    node = iriRef(idIri);
    b.addIri(credential, VC_CREDENTIAL_SUBJECT, idIri);
  } else {
    node = b.linkBlankNode(credential, VC_CREDENTIAL_SUBJECT);
  }
  for (const [claim, value] of Object.entries(subject)) {
    if (claim === "id" || value === undefined) continue;
    // `type` on a subject is rdf:type (exactly as the VC 2.0 JSON-LD context
    // reads it — `type` is an alias of `@type`), NOT an svc#type claim: the
    // status list credential's subject carries `type: "BitstringStatusList"`,
    // and the Turtle/JSON-LD lock-step requires both projections to agree on
    // the class IRI. FAIL-CLOSED on a non-string entry — silently dropping a
    // type from the SIGNED graph would let two differently-typed subjects
    // canonicalise identically.
    if (claim === "type") {
      const types = Array.isArray(value) ? value : [value];
      for (const t of types) {
        if (typeof t !== "string" || t.length === 0) {
          throw new Error(
            "@jeswr/solid-vc: a credentialSubject `type` must be a non-empty string " +
              "(or an array of them)",
          );
        }
        b.addType(node, typeIri(t));
      }
      continue;
    }
    writeClaim(b, node, claim, value);
  }
}

/**
 * The bare subject-claim keys the VC 2.0 base context maps to the W3C status
 * vocabulary (the status list credential's subject uses them). Kept in
 * lock-step with the JSON-LD projection: the SAME pinned context expands the
 * SAME bare names to these IRIs.
 */
const STATUS_CLAIM_TERMS: Readonly<Record<string, string>> = {
  statusPurpose: STATUS_PURPOSE,
  encodedList: STATUS_ENCODED_LIST,
  statusListIndex: STATUS_LIST_INDEX,
  statusListCredential: STATUS_LIST_CREDENTIAL,
};

/** The predicate IRI for a subject claim key (absolute IRI kept; bare name homed). */
function claimPredicate(claim: string): string {
  if (looksLikeIri(claim)) return claim;
  const status = STATUS_CLAIM_TERMS[claim];
  if (status !== undefined) return status;
  return `https://w3id.org/jeswr/solid-vc#${claim}`;
}

/** Write one claim value (string IRI / typed literal / nested object / array). */
function writeClaim(b: GraphBuilder, subject: NodeRef, claim: string, value: JsonValue): void {
  const predicate = claimPredicate(claim);
  if (Array.isArray(value)) {
    for (const item of value) {
      writeClaim(b, subject, claim, item);
    }
    return;
  }
  if (value === null) {
    return; // RDF has no null; omit.
  }
  if (typeof value === "string") {
    // `encodedList` is a multibase literal (never an IRI): the VC 2.0 context
    // types it `sec:multibase`, and its `u…` value must not be mistaken for a
    // scheme'd IRI. Match the context's datatype so Turtle and JSON-LD agree.
    if (predicate === STATUS_ENCODED_LIST) {
      b.addLiteral(subject, predicate, value, SEC_MULTIBASE);
      return;
    }
    if (looksLikeIri(value)) {
      b.addIri(subject, predicate, value);
    } else {
      b.addLiteral(subject, predicate, value);
    }
    return;
  }
  if (typeof value === "boolean") {
    b.addLiteral(subject, predicate, String(value), `${XSD}boolean`);
    return;
  }
  if (typeof value === "number") {
    const dt = Number.isInteger(value) ? `${XSD}integer` : `${XSD}double`;
    b.addLiteral(subject, predicate, String(value), dt);
    return;
  }
  // A nested object → a fresh blank node carrying its own claims.
  const child = b.linkBlankNode(subject, predicate);
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    writeClaim(b, child, k, v as JsonValue);
  }
}

/**
 * Write one VCDM 2.0 `relatedResource` entry into the SIGNED claim graph:
 * `credential cred:relatedResource <resource>` plus the resource's
 * `sec:digestMultibase` (and `schema:encodingFormat` media type) triples. The
 * resource `id` is a REQUIRED, binding-bearing object IRI, so it routes through
 * the FAIL-CLOSED {@link requireObjectIri} — silently dropping it would silently
 * UNBIND the policy the credential claims to bind (a fail-open the verifier
 * could not detect). The digest/mediaType are plain literals (typed for the
 * digest, per the VC 2.0 context's `sec:multibase` datatype).
 */
function writeRelatedResource(
  b: GraphBuilder,
  credential: NodeRef,
  related: RelatedResource,
): void {
  const idIri = requireObjectIri(related.id, "relatedResource.id");
  b.addIri(credential, VC_RELATED_RESOURCE, idIri);
  const node = iriRef(idIri);
  if (related.digestMultibase !== undefined) {
    b.addLiteral(node, SEC_DIGEST_MULTIBASE, related.digestMultibase, SEC_MULTIBASE);
  }
  if (related.mediaType !== undefined) {
    b.addLiteral(node, SCHEMA_ENCODING_FORMAT, related.mediaType);
  }
}

/** Normalise a credential's one-or-many `credentialStatus` to an array. */
export function credentialStatusesOf(
  credentialStatus: Credential["credentialStatus"],
): readonly BitstringStatusListEntry[] {
  if (credentialStatus === undefined) return [];
  return Array.isArray(credentialStatus)
    ? (credentialStatus as readonly BitstringStatusListEntry[])
    : [credentialStatus as BitstringStatusListEntry];
}

/**
 * Write ONE `credentialStatus` entry (a W3C Bitstring Status List v1.0
 * `BitstringStatusListEntry`) into the SIGNED claim graph:
 *
 *   credential cred:credentialStatus  <entry | _:entry> .
 *   entry      rdf:type               status:BitstringStatusListEntry ;
 *              status:statusPurpose   "revocation" ;
 *              status:statusListIndex "94567" ;
 *              status:statusListCredential <https://issuer.example/status/1> .
 *
 * STRICT + FAIL-CLOSED (all throws): only the `BitstringStatusListEntry` type
 * is supported (an unknown status type cannot be lowered faithfully — silently
 * writing a half-shaped entry would sign a status binding the verifier cannot
 * check); `statusPurpose` must be a non-empty string; `statusListIndex` must
 * be a string NON-NEGATIVE INTEGER (per spec); `statusListCredential` is a
 * REQUIRED, binding-bearing object IRI ({@link requireObjectIri} — dropping it
 * would sign an uncheckable, dangling status entry).
 */
function writeCredentialStatus(
  b: GraphBuilder,
  credential: NodeRef,
  status: BitstringStatusListEntry,
): void {
  if (status === null || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("@jeswr/solid-vc: credentialStatus entry must be an object");
  }
  if (status.type !== "BitstringStatusListEntry") {
    throw new Error(
      `@jeswr/solid-vc: unsupported credentialStatus type ${JSON.stringify(
        status.type,
      )} — only "BitstringStatusListEntry" (W3C Bitstring Status List v1.0) can be lowered`,
    );
  }
  if (typeof status.statusPurpose !== "string" || status.statusPurpose.length === 0) {
    throw new Error("@jeswr/solid-vc: credentialStatus.statusPurpose must be a non-empty string");
  }
  if (
    typeof status.statusListIndex !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(status.statusListIndex)
  ) {
    throw new Error(
      "@jeswr/solid-vc: credentialStatus.statusListIndex must be a string non-negative integer",
    );
  }
  const listIri = requireObjectIri(
    status.statusListCredential,
    "credentialStatus.statusListCredential",
  );
  let node: NodeRef;
  if (status.id !== undefined) {
    const idIri = requireObjectIri(status.id, "credentialStatus.id");
    b.addIri(credential, VC_CREDENTIAL_STATUS, idIri);
    node = iriRef(idIri);
  } else {
    node = b.linkBlankNode(credential, VC_CREDENTIAL_STATUS);
  }
  b.addType(node, STATUS_BITSTRING_ENTRY);
  b.addLiteral(node, STATUS_PURPOSE, status.statusPurpose);
  b.addLiteral(node, STATUS_LIST_INDEX, status.statusListIndex);
  b.addIri(node, STATUS_LIST_CREDENTIAL, listIri);
}

/**
 * Lower a structured {@link Credential} (the UNSIGNED claim graph — no proof) to
 * RDF quads via the typed write path. The credential gets an `@id` (a random
 * `urn:uuid:` when omitted) so it is an addressable named node the proof can bind
 * to. `validFrom` defaults to now ONLY at the {@link issue} step, not here — this
 * is a pure projection of exactly what the caller supplied.
 */
export function credentialToRdf(credential: Credential): Quad[] {
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const subject = iriRef(id);
  const b = new GraphBuilder();
  b.addType(subject, VC_CREDENTIAL);
  for (const t of credential.type ?? []) {
    const iri = typeIri(t);
    if (iri === VC_CREDENTIAL) continue;
    // A type is an object-position IRI: preserve an http(s) type LEXICALLY (escape
    // for injection, no URL-canonicalisation), escape a non-http absolute type in
    // place, and DROP a malformed one (never emit a type IRI that could break out
    // of the serialised `<…>`).
    const safe = safeObjectIri(iri);
    if (safe !== undefined) b.addType(subject, safe);
  }
  // The issuer is a REQUIRED, identity-bearing object IRI (a WebID, or a DID/URN —
  // all legitimate). Route it through the FAIL-CLOSED guard: preserve an http(s)
  // issuer LEXICALLY (escape for injection, NO URL-canonicalisation — so it agrees
  // byte-for-byte with the JSON-LD projection below, which emits the issuer
  // verbatim, and with external verifiers), escape a DID/URN, and THROW on a
  // non-absolute / malformed / missing issuer — NEVER silently drop the triple,
  // which would let a credential be signed over a graph carrying no issuer (a
  // fail-open the verifier could not detect). A valid issuer is escaped in place,
  // so a canonical issuer is byte-unchanged.
  const issuerIri = requireObjectIri(credential.issuer, "issuer");
  b.addIri(subject, VC_ISSUER, issuerIri);
  if (credential.validFrom !== undefined) {
    b.addLiteral(subject, VC_VALID_FROM, credential.validFrom, `${XSD}dateTime`);
  }
  if (credential.validUntil !== undefined) {
    b.addLiteral(subject, VC_VALID_UNTIL, credential.validUntil, `${XSD}dateTime`);
  }
  for (const related of credential.relatedResource ?? []) {
    writeRelatedResource(b, subject, related);
  }
  for (const status of credentialStatusesOf(credential.credentialStatus)) {
    writeCredentialStatus(b, subject, status);
  }
  const subjects = Array.isArray(credential.credentialSubject)
    ? credential.credentialSubject
    : [credential.credentialSubject];
  for (const s of subjects) {
    writeSubject(b, subject, s);
  }
  return b.quads();
}

/** Serialise a credential's claim graph to Turtle (default) or another n3 format. */
export function credentialToTurtle(credential: Credential, format?: string): Promise<string> {
  return serialize(credentialToRdf(credential), format);
}

/**
 * Build the VC 2.0 JSON-LD document for a credential's claim graph (no proof): a
 * deterministic projection kept in lock-step with the RDF quads, with the pinned
 * inline `@context`. A consumer can parse it back via `@jeswr/fetch-rdf`.
 */
export function credentialToJsonLd(credential: Credential): Record<string, unknown> {
  // FAIL CLOSED on a missing/invalid issuer here too — the JSON-LD projection must
  // never emit a document with no valid issuer (parity with the RDF lowering). The
  // raw issuer is kept verbatim, and the RDF path now ALSO preserves the issuer
  // lexically (safeHttpIri no longer URL-canonicalises), so the two projections
  // agree on the issuer IRI BYTE-FOR-BYTE; the guard only rejects the values the
  // RDF path would refuse.
  requireObjectIri(credential.issuer, "issuer");
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const types = ["VerifiableCredential", ...(credential.type ?? [])];
  const doc: Record<string, unknown> = {
    "@context": SVC_INLINE_CONTEXT,
    id,
    type: [...new Set(types)],
    issuer: credential.issuer,
  };
  if (credential.validFrom !== undefined) doc.validFrom = credential.validFrom;
  if (credential.validUntil !== undefined) doc.validUntil = credential.validUntil;
  if (credential.relatedResource !== undefined && credential.relatedResource.length > 0) {
    // Lock-step with the RDF lowering: a relatedResource with an invalid id is
    // refused there (requireObjectIri throws), so refuse it here too rather than
    // emit a JSON-LD projection the RDF path could never have signed.
    for (const related of credential.relatedResource) {
      requireObjectIri(related.id, "relatedResource.id");
    }
    doc.relatedResource = credential.relatedResource.map((related) => ({
      id: related.id,
      ...(related.digestMultibase !== undefined
        ? { digestMultibase: related.digestMultibase }
        : {}),
      ...(related.mediaType !== undefined ? { mediaType: related.mediaType } : {}),
    }));
  }
  if (credential.credentialStatus !== undefined) {
    // Lock-step with the RDF lowering: run each entry through the SAME strict
    // validation writeCredentialStatus applies (an entry the RDF path would
    // refuse to sign must not appear in the JSON-LD projection either). The
    // validated entries project verbatim — every key is a VC 2.0 base-context
    // term, so the JSON-LD expands to the same quads the Turtle carries.
    const entries = credentialStatusesOf(credential.credentialStatus);
    const check = new GraphBuilder();
    for (const status of entries) {
      writeCredentialStatus(check, iriRef(id), status);
    }
    const projected = entries.map((status) => ({
      ...(status.id !== undefined ? { id: status.id } : {}),
      type: status.type,
      statusPurpose: status.statusPurpose,
      statusListIndex: status.statusListIndex,
      statusListCredential: status.statusListCredential,
    }));
    doc.credentialStatus =
      !Array.isArray(credential.credentialStatus) && projected.length === 1
        ? projected[0]
        : projected;
  }
  const subjects = Array.isArray(credential.credentialSubject)
    ? credential.credentialSubject
    : [credential.credentialSubject];
  // NORMALISE each subject in lock-step with the RDF lowering (writeSubject): a
  // PRESENT relative/malformed id THROWS (fail closed); a BLANK id (empty `""` /
  // whitespace / absent) is OMITTED so the subject is anonymous — NOT copied through
  // as an empty-string `@id` (which is a present RELATIVE reference resolving against
  // the base, the parity gap this closes). A valid absolute id is byte-unchanged.
  const normalized = subjects.map(subjectWithNormalizedId);
  doc.credentialSubject = normalized.length === 1 ? normalized[0] : normalized;
  return doc;
}

/**
 * Read the credential METADATA (issuer / validity / types / id) back from a
 * parsed credential node. The full `credentialSubject` claim graph is intentionally
 * NOT projected back to a structured object here (it is arbitrary RDF); verification
 * works over the quads directly. Callers that need typed claims use the M-specific
 * helpers (e.g. {@link agentAuthorizationFromRdf}).
 */
export function credentialMetaFromNode(node: CredentialNode): {
  id: string;
  issuer: string | undefined;
  validFrom: string | undefined;
  validUntil: string | undefined;
  types: string[];
} {
  const types: string[] = [];
  for (const t of node.types) {
    if (t.termType === "NamedNode") types.push(t.value);
  }
  return {
    id: node.value,
    issuer: firstIri(node.issuers),
    // validFrom / validUntil are xsd:dateTime literals — read as the first literal.
    validFrom: firstLiteral(node.validFroms),
    validUntil: firstLiteral(node.validUntils),
    types,
  };
}

/** Parse a credential graph (Turtle/JSON-LD string) into an RDF dataset. */
export async function parseCredentialRdf(
  body: string,
  contentType = "text/turtle",
): Promise<DatasetCore> {
  return (await parseRdf(body, contentType)) as unknown as DatasetCore;
}

/** Find the first credential node in a parsed dataset, or `undefined`. */
export function credentialFromRdf(dataset: DatasetCore): CredentialNode | undefined {
  return wrapVc(dataset).credentials()[0];
}

// --- the agent-authorization headline use case ----------------------------

/**
 * Build the structured {@link Credential} for the headline M4 case — "principal
 * authorizes agent for action(s) over target under ODRL policy" — as an
 * `AgentAuthorizationCredential`. The issuer IS the principal (a WebID signs that
 * it delegates to the agent). Compose with `@jeswr/solid-agent-card` (the `agent`
 * IRI) and `@jeswr/solid-odrl` (the `policy` IRI).
 */
export function buildAgentAuthorizationCredential(auth: AgentAuthorization): Credential {
  // FAIL CLOSED: this SYNC builder cannot compute the policy-content digest
  // (canonicalization is async). Silently ignoring `policyContent` would return
  // a credential the caller believes is content-bound but is not — the exact
  // policy-substitution fail-open G1 exists to close. Route to the async
  // builder instead.
  if (auth.policyContent !== undefined) {
    throw new Error(
      "@jeswr/solid-vc: buildAgentAuthorizationCredential cannot bind policyContent (digest " +
        "computation is async) — use buildBoundAgentAuthorizationCredential / " +
        "issueAgentAuthorization, which emit the relatedResource digest binding",
    );
  }
  const actions = Array.isArray(auth.action) ? auth.action : [auth.action];
  const subject: Record<string, JsonValue> = {
    [SVC_AUTHORIZES]: auth.agent,
    [SVC_ACTION]: actions.length === 1 ? (actions[0] as string) : (actions as JsonValue),
  };
  if (auth.target !== undefined) subject[SVC_TARGET] = auth.target;
  if (auth.policy !== undefined) subject[SVC_POLICY] = auth.policy;
  // The subject `id` is the principal: the WebID that holds the authority and is
  // delegating it. The credential ASSERTS, signed by the same WebID as issuer.
  const credentialSubject: CredentialSubject = { id: auth.principal, ...subject };
  const credential: Credential = {
    issuer: auth.principal,
    type: ["AgentAuthorizationCredential"],
    credentialSubject,
    ...(auth.id !== undefined ? { id: auth.id } : {}),
    ...(auth.validFrom !== undefined ? { validFrom: auth.validFrom } : {}),
    ...(auth.validUntil !== undefined ? { validUntil: auth.validUntil } : {}),
    ...(auth.credentialStatus !== undefined ? { credentialStatus: auth.credentialStatus } : {}),
  };
  return credential;
}

/**
 * Build a POLICY-CONTENT-BOUND `AgentAuthorizationCredential` (the G1 binding):
 * like {@link buildAgentAuthorizationCredential}, but the exact ODRL
 * Agreement/policy content is cryptographically bound into the (to-be-signed)
 * claim graph as a VCDM 2.0 `relatedResource` entry — the policy IRI plus the
 * `digestMultibase` of the content's RDFC-1.0 canonical form (see
 * {@link digestRdfContent}). A verifier recomputes the digest over the policy it
 * is presented and compares fail-closed ({@link verifyRelatedResources} / the
 * `presentedResources` option of `verifyCredential`), so a substituted or
 * mutated policy behind the (mutable) `svc:policy` IRI can no longer verify.
 *
 * FAIL-CLOSED requirements (both throw):
 *  - `policyContent` requires `policy` (the digest must bind to a named
 *    resource IRI — there is nothing to hang an anonymous digest on);
 *  - the content must parse to a NON-EMPTY graph (digestRdfContent's guard).
 *
 * Async because RDFC-1.0 canonicalization is async. When `policyContent` is
 * absent this degrades to exactly {@link buildAgentAuthorizationCredential}
 * (the bare-IRI form — which binds only the pointer, not the content; the
 * accountable-agent-runtime marks that form `policyIntegrityProvisional`).
 */
export async function buildBoundAgentAuthorizationCredential(
  auth: AgentAuthorization,
): Promise<Credential> {
  if (auth.policyContent === undefined) {
    return buildAgentAuthorizationCredential(auth);
  }
  if (auth.policy === undefined) {
    throw new Error(
      "@jeswr/solid-vc: policyContent requires a policy IRI — the content digest binds to the " +
        "relatedResource id, so an anonymous policy cannot be content-bound",
    );
  }
  const contentType = auth.policyContentType ?? "text/turtle";
  const digestMultibase = await digestRdfContent(auth.policyContent, contentType);
  const { policyContent: _c, policyContentType: _ct, ...bare } = auth;
  const credential = buildAgentAuthorizationCredential(bare);
  const related: RelatedResource = {
    id: auth.policy,
    digestMultibase,
    mediaType: contentType,
  };
  return { ...credential, relatedResource: [related] };
}

/**
 * Read the `relatedResource` digest bindings back from a parsed credential node
 * — the typed inverse of the {@link credentialToRdf} relatedResource lowering.
 * Returns one entry per `cred:relatedResource` object IRI, with its
 * `sec:digestMultibase` / media type when present. An entry WITHOUT a digest is
 * still returned (so a caller can see it) — but the VERIFIER treats a presented
 * resource whose entry lacks a digest as unbound and fails closed.
 */
export function relatedResourcesFromNode(node: CredentialNode): RelatedResource[] {
  const dataset = node.dataset as unknown as DatasetCore;
  const out: RelatedResource[] = [];
  for (const quad of dataset.match()) {
    if (quad.subject.termType !== "NamedNode" || quad.subject.value !== node.value) continue;
    if (quad.predicate.value !== VC_RELATED_RESOURCE) continue;
    if (quad.object.termType !== "NamedNode") continue;
    const id = quad.object.value;
    let digestMultibase: string | undefined;
    let mediaType: string | undefined;
    for (const q of dataset.match()) {
      if (q.subject.termType !== "NamedNode" || q.subject.value !== id) continue;
      if (q.object.termType !== "Literal") continue;
      if (q.predicate.value === SEC_DIGEST_MULTIBASE) digestMultibase = q.object.value;
      if (q.predicate.value === SCHEMA_ENCODING_FORMAT) mediaType = q.object.value;
    }
    out.push({
      id,
      ...(digestMultibase !== undefined ? { digestMultibase } : {}),
      ...(mediaType !== undefined ? { mediaType } : {}),
    });
  }
  return out;
}

/**
 * Read the Bitstring status entries back from a parsed credential node — the
 * typed inverse of the {@link credentialToRdf} `credentialStatus` lowering.
 * Returns one entry per `cred:credentialStatus` object (IRI or blank node)
 * that is a well-formed `status:BitstringStatusListEntry` (type + non-empty
 * purpose + integer-string index + an IRI list URL). A malformed / alien-typed
 * entry is SKIPPED here (this is a reader, not the gate) — but note the
 * VERIFIER does the opposite: `resolveBitstringStatus` treats a present entry
 * it cannot make sense of as `unreachable`, fail-closed.
 */
export function credentialStatusFromNode(node: CredentialNode): BitstringStatusListEntry[] {
  const dataset = node.dataset as unknown as DatasetCore;
  const out: BitstringStatusListEntry[] = [];
  for (const quad of dataset.match()) {
    if (quad.subject.termType !== "NamedNode" || quad.subject.value !== node.value) continue;
    if (quad.predicate.value !== VC_CREDENTIAL_STATUS) continue;
    const entryTerm = quad.object;
    if (entryTerm.termType !== "NamedNode" && entryTerm.termType !== "BlankNode") continue;
    let isEntry = false;
    let statusPurpose: string | undefined;
    let statusListIndex: string | undefined;
    let statusListCredential: string | undefined;
    for (const q of dataset.match()) {
      if (q.subject.termType !== entryTerm.termType || q.subject.value !== entryTerm.value) {
        continue;
      }
      if (
        q.predicate.value === RDF_TYPE &&
        q.object.termType === "NamedNode" &&
        q.object.value === STATUS_BITSTRING_ENTRY
      ) {
        isEntry = true;
      }
      if (q.predicate.value === STATUS_PURPOSE && q.object.termType === "Literal") {
        statusPurpose = q.object.value;
      }
      if (q.predicate.value === STATUS_LIST_INDEX && q.object.termType === "Literal") {
        statusListIndex = q.object.value;
      }
      if (q.predicate.value === STATUS_LIST_CREDENTIAL && q.object.termType === "NamedNode") {
        statusListCredential = q.object.value;
      }
    }
    if (
      !isEntry ||
      statusPurpose === undefined ||
      statusPurpose.length === 0 ||
      statusListIndex === undefined ||
      !/^(0|[1-9][0-9]*)$/.test(statusListIndex) ||
      statusListCredential === undefined
    ) {
      continue;
    }
    out.push({
      ...(entryTerm.termType === "NamedNode" ? { id: entryTerm.value } : {}),
      type: "BitstringStatusListEntry",
      statusPurpose,
      statusListIndex,
      statusListCredential,
    });
  }
  return out;
}

/**
 * Read the agent-authorization claim back from a parsed credential node — the
 * typed inverse of {@link buildAgentAuthorizationCredential}. Returns `undefined`
 * if the node is not an `AgentAuthorizationCredential` with the required terms.
 */
export function agentAuthorizationFromRdf(
  node: CredentialNode,
): Pick<AgentAuthorization, "principal" | "agent" | "action" | "target" | "policy"> | undefined {
  const meta = credentialMetaFromNode(node);
  if (!meta.types.includes(SVC_AGENT_AUTHORIZATION)) return undefined;
  const subjectTerm = [...node.subjects].find((t) => t.termType === "NamedNode");
  if (subjectTerm === undefined) return undefined;
  const subjectIri = subjectTerm.value;
  const dataset = node.dataset as unknown as DatasetCore;
  const reads = readSubjectClaims(dataset, subjectIri);
  if (reads.authorizes === undefined || reads.action.length === 0) return undefined;
  return {
    principal: subjectIri,
    agent: reads.authorizes,
    action: reads.action.length === 1 ? (reads.action[0] as string) : reads.action,
    ...(reads.target !== undefined ? { target: reads.target } : {}),
    ...(reads.policy !== undefined ? { policy: reads.policy } : {}),
  };
}

/** Read the agent-authz claims for a subject IRI directly from the quads. */
function readSubjectClaims(
  dataset: DatasetCore,
  subjectIri: string,
): { authorizes?: string; action: string[]; target?: string; policy?: string } {
  let authorizes: string | undefined;
  const action: string[] = [];
  let target: string | undefined;
  let policy: string | undefined;
  for (const quad of dataset.match()) {
    if (quad.subject.termType !== "NamedNode" || quad.subject.value !== subjectIri) continue;
    if (quad.object.termType !== "NamedNode") continue;
    switch (quad.predicate.value) {
      case SVC_AUTHORIZES:
        authorizes = quad.object.value;
        break;
      case SVC_ACTION:
        action.push(quad.object.value);
        break;
      case SVC_TARGET:
        target = quad.object.value;
        break;
      case SVC_POLICY:
        policy = quad.object.value;
        break;
      default:
        break;
    }
  }
  return {
    ...(authorizes !== undefined ? { authorizes } : {}),
    action,
    ...(target !== undefined ? { target } : {}),
    ...(policy !== undefined ? { policy } : {}),
  };
}
