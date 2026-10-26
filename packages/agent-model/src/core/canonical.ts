// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Content identity for terms, actions and records: RFC 8785 JSON Canonicalization
 * Scheme + SHA-256.
 *
 * A digest identifies EXACT content (terms version, action, evidence) so an acceptance,
 * approval or decision can refer to what was actually reviewed. It is NOT a signature and
 * says nothing about who produced the content.
 */
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { createHash, randomUUID } from "crypto";

export type Digest = `sha-256:${string}`;

/** RFC 8785 canonical JSON text. Throws on values JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const invalid = (): never => {
    throw new TypeError("value is not canonicalisable JSON");
  };
  const string = (value: string): string => {
    // With /u a surrogate pair is one code point; this matches only lone surrogates.
    if (/[\uD800-\uDFFF]/u.test(value)) return invalid();
    return JSON.stringify(value);
  };
  const serialize = (value: unknown): string => {
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "string") return string(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return invalid();
      return JSON.stringify(value);
    }
    if (typeof value !== "object" || ancestors.has(value)) return invalid();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) return invalid();
    const keys = Reflect.ownKeys(value);
    const member = (key: string): string => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // JSON data has own enumerable data properties, never getters or coercion hooks.
      if (!descriptor?.enumerable || !("value" in descriptor)) return invalid();
      return serialize(descriptor.value);
    };
    ancestors.add(value);
    try {
      if (array) {
        // Reject holes and extra properties instead of silently dropping their content.
        if (keys.length !== value.length + 1) return invalid();
        return `[${Array.from({ length: value.length }, (_, index) => member(String(index))).join(",")}]`;
      }
      if (keys.some((key) => typeof key !== "string")) return invalid();
      // Default sorting compares UTF-16 code units as required by RFC 8785.
      return `{${(keys as string[])
        .sort()
        .map((key) => `${string(key)}:${member(key)}`)
        .join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  };
  return serialize(value);
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
  return `urn:agent:${kind}:${digestOf(value).slice("sha-256:".length, "sha-256:".length + 32)}`;
}

const IRI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: IRIs must reject all C0 controls and DEL.
const IRI_FORBIDDEN = /[\u0000-\u0020\u007F\s<>"{}|\\^`]/;

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
 * `urn:agent:<kind>:<digest of {scope,label}>:<label>`.
 */
export function scopedUrn(kind: string, scope: string, label: string): string {
  if (!LABEL.test(label) || !/^[a-z][a-z0-9-]{0,31}$/.test(kind))
    throw new Error(
      `invalid identifier label ${JSON.stringify(label)} or kind ${JSON.stringify(kind)}`,
    );
  return `${derivedUrn(kind, { scope, label })}:${label}`;
}
