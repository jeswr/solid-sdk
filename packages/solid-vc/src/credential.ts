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
import { isAbsoluteIri, requireObjectIri, safeObjectIri } from "./iri.js";
import { serialize } from "./serialize.js";
import type { AgentAuthorization, Credential, CredentialSubject, JsonValue } from "./types.js";
import {
  SVC_ACTION,
  SVC_AGENT_AUTHORIZATION,
  SVC_AUTHORIZES,
  SVC_INLINE_CONTEXT,
  SVC_POLICY,
  SVC_TARGET,
  VC_CREDENTIAL,
  VC_CREDENTIAL_SUBJECT,
  VC_ISSUER,
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
 * Return the JSON-LD form of a subject: identical when its id is absolute, but with a
 * BLANK id STRIPPED (so an anonymous subject carries no `@id`, matching the RDF blank
 * node). Throws (via {@link normalizeSubjectId}) on a present relative/malformed id.
 */
function jsonLdSubject(subject: CredentialSubject): CredentialSubject {
  if (normalizeSubjectId(subject.id) !== undefined) return subject; // valid absolute id → verbatim
  if (!("id" in subject)) return subject; // never had an id → nothing to strip
  const { id: _blank, ...rest } = subject; // blank id → drop it (anonymous)
  return rest;
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
    writeClaim(b, node, claim, value);
  }
}

/** The predicate IRI for a subject claim key (absolute IRI kept; bare name homed). */
function claimPredicate(claim: string): string {
  return looksLikeIri(claim) ? claim : `https://w3id.org/jeswr/solid-vc#${claim}`;
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
    // A type is an object-position IRI: canonicalise an http(s) type, escape a
    // non-http absolute type in place, and DROP a malformed one (never emit a
    // type IRI that could break out of the serialised `<…>`).
    const safe = safeObjectIri(iri);
    if (safe !== undefined) b.addType(subject, safe);
  }
  // The issuer is a REQUIRED, identity-bearing object IRI (a WebID, or a DID/URN —
  // all legitimate). Route it through the FAIL-CLOSED guard: canonicalise http(s),
  // escape a DID/URN, and THROW on a non-absolute / malformed / missing issuer —
  // NEVER silently drop the triple, which would let a credential be signed over a
  // graph carrying no issuer (a fail-open the verifier could not detect). A valid
  // issuer is canonicalised/escaped exactly as before, so valid credentials are
  // byte-unchanged.
  const issuerIri = requireObjectIri(credential.issuer, "issuer");
  b.addIri(subject, VC_ISSUER, issuerIri);
  if (credential.validFrom !== undefined) {
    b.addLiteral(subject, VC_VALID_FROM, credential.validFrom, `${XSD}dateTime`);
  }
  if (credential.validUntil !== undefined) {
    b.addLiteral(subject, VC_VALID_UNTIL, credential.validUntil, `${XSD}dateTime`);
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
  // raw issuer is kept (this projection does not canonicalise); the guard only
  // rejects the values the RDF path would refuse.
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
  const subjects = Array.isArray(credential.credentialSubject)
    ? credential.credentialSubject
    : [credential.credentialSubject];
  // NORMALISE each subject in lock-step with the RDF lowering (writeSubject): a
  // PRESENT relative/malformed id THROWS (fail closed); a BLANK id (empty `""` /
  // whitespace / absent) is OMITTED so the subject is anonymous — NOT copied through
  // as an empty-string `@id` (which is a present RELATIVE reference resolving against
  // the base, the parity gap this closes). A valid absolute id is byte-unchanged.
  const normalized = subjects.map(jsonLdSubject);
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
  };
  return credential;
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
