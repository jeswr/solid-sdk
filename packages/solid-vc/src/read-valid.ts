// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// FAIL-CLOSED structural validation of a credential parsed from RDF.
//
// The lenient readers ({@link credentialFromRdf} / {@link credentialMetaFromNode})
// are deliberately permissive — they return the FIRST credential node and a
// possibly HALF-POPULATED metadata object (issuer `undefined`, no
// `VerifiableCredential` type, no subject) with NO validation. That is correct for
// a caller that just wants to inspect whatever graph it was handed, but it is a
// FAIL-OPEN surface for a caller that must decide "is this a well-formed credential
// I can trust the shape of?": a hostile graph could (a) omit the issuer, (b) omit
// the subject, or — the dangerous one — (c) inject a SECOND credential node so the
// "first" one silently chosen is the attacker's.
//
// {@link readValidCredential} closes that gap: it REJECTS a malformed / ambiguous /
// partial credential with a discriminated `{ valid: false; error }` result instead
// of returning a half-populated object. It NEVER throws on hostile input — a throw
// in a parse/validate path is itself a fail-open surface (the caller cannot tell a
// validator bug from an invalid credential), so every internal error maps to
// `{ valid: false }`.
//
// This does STRUCTURAL validation only (shape + identity fields well-formed). It
// does NOT verify the signature — a structurally-valid credential still MUST be
// passed to {@link verifyCredential} before its claims are trusted.

import type { DatasetCore } from "@rdfjs/types";
import { parseCredentialRdf } from "./credential.js";
import { isAbsoluteIri } from "./iri.js";
import { VC_CREDENTIAL, VC_CREDENTIAL_SUBJECT, VC_ISSUER } from "./vocab.js";
import { type CredentialNode, wrapVc } from "./wrappers.js";

/**
 * The result of {@link readValidCredential} — a discriminated union so an invalid
 * credential is a VALUE, never a thrown exception. On `valid: false` the `error`
 * string names the specific structural defect (distinct per rejection reason).
 */
export type ValidCredentialResult =
  | {
      readonly valid: true;
      readonly credential: {
        /** The credential node's IRI (`@id`); a blank node's label when anonymous. */
        readonly id: string;
        /** The single, absolute issuer IRI. */
        readonly issuer: string;
        /** `validFrom` when present and a well-formed `xsd:dateTime`. */
        readonly validFrom?: string;
        /** `validUntil` when present and a well-formed `xsd:dateTime`. */
        readonly validUntil?: string;
        /** Every `rdf:type` IRI on the node (includes `VerifiableCredential`). */
        readonly types: string[];
        /** The underlying typed node, for callers that need the claim graph. */
        readonly node: CredentialNode;
      };
    }
  | { readonly valid: false; readonly error: string };

/**
 * The XSD `dateTime` lexical space (structural): an optional leading `-`, a
 * ≥4-digit year, month, day, `T`, `hh:mm:ss`, an optional fractional second, and
 * an optional `Z` / `±hh:mm` timezone. We additionally require the value to parse
 * to a real instant (`Date.parse` non-NaN) so an in-range-shape-but-impossible
 * date (e.g. month 13) is still rejected.
 */
const XSD_DATETIME_RE = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** Whether a string is a structurally well-formed `xsd:dateTime`. */
function isXsdDateTime(value: string): boolean {
  if (!XSD_DATETIME_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function reject(error: string): ValidCredentialResult {
  return { valid: false, error };
}

/**
 * Read an OPTIONAL `xsd:dateTime` property (validFrom / validUntil) FAIL-CLOSED:
 *  - absent → `{ ok: true }` (nothing to validate);
 *  - present but not exactly one value → `{ ok: false }` (ambiguous);
 *  - present but not a Literal (e.g. an IRI where a dateTime is required) → reject;
 *  - present Literal that is not a well-formed `xsd:dateTime` → reject.
 */
function readOptionalDateTime(
  terms: ReadonlySet<{ termType: string; value: string }>,
  field: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  const all = [...terms];
  if (all.length === 0) return { ok: true };
  if (all.length > 1) {
    return { ok: false, error: `credential ${field} has more than one value — ambiguous` };
  }
  const term = all[0];
  if (term === undefined) return { ok: true };
  if (term.termType !== "Literal") {
    return { ok: false, error: `credential ${field} must be an xsd:dateTime literal` };
  }
  if (!isXsdDateTime(term.value)) {
    return {
      ok: false,
      error: `credential ${field} "${term.value}" is not a well-formed xsd:dateTime`,
    };
  }
  return { ok: true, value: term.value };
}

/**
 * Whether the dataset contains any node SHAPED like a credential (carrying a
 * `cred:issuer` or `cred:credentialSubject` predicate) — used only to give a
 * credential that is missing its `VerifiableCredential` type a DISTINCT rejection
 * reason from a dataset that contains no credential at all. Reading `predicate`
 * values off the quad stream is a read, not a hand-built triple.
 */
function hasCredentialShapedNode(dataset: DatasetCore): boolean {
  for (const quad of dataset) {
    if (quad.predicate.value === VC_ISSUER || quad.predicate.value === VC_CREDENTIAL_SUBJECT) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that a parsed RDF dataset contains EXACTLY ONE well-formed Verifiable
 * Credential and project its metadata, FAIL-CLOSED. Returns a discriminated result
 * — `{ valid: true; credential }` or `{ valid: false; error }` — and NEVER throws
 * on hostile input (any internal error is mapped to a `valid: false` result).
 *
 * Rejections (each with a distinct reason):
 *  - no `VerifiableCredential` node in the dataset;
 *  - MORE THAN ONE `VerifiableCredential` node (ambiguous — a hostile graph could
 *    inject a second credential; picking "the first" silently is a fail-open);
 *  - a credential-shaped node missing the `VerifiableCredential` type;
 *  - issuer missing / not exactly one / not a NamedNode / not an absolute IRI;
 *  - no `credentialSubject`;
 *  - `validFrom` / `validUntil` present but not a well-formed `xsd:dateTime`.
 */
export function readValidCredential(dataset: DatasetCore): ValidCredentialResult {
  try {
    return readValidCredentialInner(dataset);
  } catch (e) {
    // FAIL-CLOSED: any unexpected error (a hostile RDF shape making a wrapper
    // throw, etc.) becomes an invalid result — never an escaping exception.
    return reject(`credential could not be read: ${(e as Error).message}`);
  }
}

function readValidCredentialInner(dataset: DatasetCore): ValidCredentialResult {
  const nodes = wrapVc(dataset).credentials();

  // Ambiguity FIRST: more than one VerifiableCredential node is a fail-open if we
  // silently take the first — a hostile graph could inject a second credential.
  if (nodes.length > 1) {
    return reject(
      `dataset contains ${nodes.length} VerifiableCredential nodes — ambiguous, refusing to pick one`,
    );
  }
  if (nodes.length === 0) {
    // Distinguish "a credential is here but untyped" from "no credential at all".
    return hasCredentialShapedNode(dataset)
      ? reject("credential node is missing the required VerifiableCredential type")
      : reject("no VerifiableCredential node in the dataset");
  }

  const node = nodes[0];
  if (node === undefined) {
    return reject("no VerifiableCredential node in the dataset");
  }

  // Types (every rdf:type NamedNode). The VerifiableCredential type is guaranteed
  // present by `credentials()` (it filters on it), but assert it explicitly so the
  // invariant is enforced here rather than relied upon from another module.
  const types: string[] = [];
  for (const t of node.types) {
    if (t.termType === "NamedNode") types.push(t.value);
  }
  if (!types.includes(VC_CREDENTIAL)) {
    return reject("credential node is missing the required VerifiableCredential type");
  }

  // Issuer: exactly one, a NamedNode, an absolute IRI.
  const issuerTerms = [...node.issuers];
  if (issuerTerms.length === 0) {
    return reject("credential has no issuer");
  }
  if (issuerTerms.length > 1) {
    return reject("credential has more than one issuer — ambiguous");
  }
  const issuerTerm = issuerTerms[0];
  if (issuerTerm === undefined) {
    return reject("credential has no issuer");
  }
  if (issuerTerm.termType !== "NamedNode") {
    return reject("credential issuer must be an IRI (a NamedNode), not a literal or blank node");
  }
  if (!isAbsoluteIri(issuerTerm.value)) {
    return reject(`credential issuer "${issuerTerm.value}" is not an absolute IRI`);
  }
  const issuer = issuerTerm.value;

  // Subject: at least one credentialSubject.
  if (node.subjects.size === 0) {
    return reject("credential has no credentialSubject");
  }

  // validFrom / validUntil: structural xsd:dateTime when present.
  const validFrom = readOptionalDateTime(node.validFroms, "validFrom");
  if (!validFrom.ok) return reject(validFrom.error);
  const validUntil = readOptionalDateTime(node.validUntils, "validUntil");
  if (!validUntil.ok) return reject(validUntil.error);

  return {
    valid: true,
    credential: {
      id: node.value,
      issuer,
      ...(validFrom.value !== undefined ? { validFrom: validFrom.value } : {}),
      ...(validUntil.value !== undefined ? { validUntil: validUntil.value } : {}),
      types,
      node,
    },
  };
}

/**
 * Parse a credential graph (Turtle / JSON-LD string) AND validate it FAIL-CLOSED
 * in one call — the string-front companion to {@link readValidCredential}. A parse
 * failure (malformed RDF, wrong content type) is caught and returned as
 * `{ valid: false }`; this never throws.
 */
export async function parseAndValidateCredential(
  body: string,
  contentType = "text/turtle",
): Promise<ValidCredentialResult> {
  let dataset: DatasetCore;
  try {
    dataset = await parseCredentialRdf(body, contentType);
  } catch (e) {
    return reject(`credential body could not be parsed as ${contentType}: ${(e as Error).message}`);
  }
  return readValidCredential(dataset);
}
