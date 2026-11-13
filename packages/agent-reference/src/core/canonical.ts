/**
 * Content identity for terms, actions and records: RFC 8785 JSON Canonicalization
 * Scheme (via the `canonicalize` reference implementation) + SHA-256.
 *
 * A digest identifies EXACT content (terms version, action, evidence) so an acceptance,
 * approval or decision can refer to what was actually reviewed. It is NOT a signature and
 * says nothing about who produced the content.
 */
import { createHash, randomUUID } from "node:crypto";
import canonicalizeModule from "canonicalize";

// `canonicalize` is CommonJS; under NodeNext its default import is the module object for
// the type checker but the function itself at runtime. Accept either shape.
type Serialize = (input: unknown) => string | undefined;
const canonicalize: Serialize =
  typeof canonicalizeModule === "function"
    ? (canonicalizeModule as unknown as Serialize)
    : (canonicalizeModule as unknown as { default: Serialize }).default;

export type Digest = `sha-256:${string}`;

/** RFC 8785 canonical JSON text. Throws on values JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  const text = canonicalize(value);
  if (typeof text !== "string") throw new TypeError("value is not canonicalisable JSON");
  return text;
}

/** `sha-256:<hex>` over the RFC 8785 canonical form of `value`. */
export function digestOf(value: unknown): Digest {
  return `sha-256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

/** `sha-256:<hex>` over raw bytes/text (for wire envelopes and raw provider input). */
export function digestBytes(bytes: string | Uint8Array): Digest {
  return `sha-256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** A fresh `urn:uuid:` identifier. */
export function newUrn(): string {
  return `urn:uuid:${randomUUID()}`;
}

/**
 * Deterministic `urn:` identifier derived from content, used where two parties must
 * compute the same id independently (e.g. an agreement id from offer + acceptance terms).
 */
export function derivedUrn(kind: string, value: unknown): string {
  return `urn:awp:${kind}:${digestOf(value).slice("sha-256:".length, "sha-256:".length + 32)}`;
}

const IRI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const IRI_FORBIDDEN = /[\s<>"{}|\\^`]/;

/**
 * Whether `value` is usable as an IRI identifier in this profile: a scheme, none of the
 * characters RFC 3987 excludes, and at most ONE `#` (so `<iri-with-fragment>#more` — which
 * earlier pilot versions minted — is rejected, never repaired).
 */
export function isIri(value: string): boolean {
  if (!IRI_SCHEME.test(value) || IRI_FORBIDDEN.test(value)) return false;
  const hash = value.indexOf("#");
  return hash < 0 || value.indexOf("#", hash + 1) < 0;
}

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

/**
 * Deterministic identifier for a named item that belongs to another identifier (a mandate
 * or rule of an actor, a representation statement, a policy target). Never concatenates
 * onto `scope` — which may already carry a fragment — so the result is always a valid IRI:
 * `urn:awp:<kind>:<digest of {scope,label}>:<label>`.
 */
export function scopedUrn(kind: string, scope: string, label: string): string {
  if (!LABEL.test(label) || !/^[a-z][a-z0-9-]{0,31}$/.test(kind))
    throw new Error(
      `invalid identifier label ${JSON.stringify(label)} or kind ${JSON.stringify(kind)}`,
    );
  return `${derivedUrn(kind, { scope, label })}:${label}`;
}
