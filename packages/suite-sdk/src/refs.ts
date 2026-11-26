// AUTHORED-BY Claude Opus 5.5
/**
 * Route references (00-sdk-assumptions A-18): base64url (no padding) of an absolute http(s) URL,
 * used for every resource-addressing route segment such as `/drive/f/[ref]`.
 */

/** Thrown by `decodeRef`/`decodeIdentifierRef` for anything that is not an encoded http(s) URL. */
export class RefError extends Error {
  constructor(readonly ref: string) {
    super("Not a valid resource reference");
    this.name = "RefError";
  }
}

function assertHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError("http(s) only");
  return url;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes only the canonical encoding: `atob` ignores non-zero trailing bits, so several refs
 * would otherwise decode to the same text. Re-encoding and comparing rejects the aliases.
 */
function fromBase64Url(ref: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new RefError(ref);
  const binary = atob(ref.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (toBase64Url(text) !== ref) throw new RefError(ref);
  return text;
}

/**
 * Encodes the normalised form (`new URL(url).href`) of an absolute http(s) URL.
 * @throws {TypeError} When `url` is not an absolute http(s) URL.
 */
export function encodeRef(url: string): string {
  return toBase64Url(assertHttpUrl(url).href);
}

/**
 * Reverses `encodeRef`. Only canonical references decode: the base64url must be the canonical
 * encoding and the URL must already be in its normalised form, so each resource has exactly one
 * reference. A decoded URL can name any http(s) origin; scoping it to the user's storage is the
 * route's job.
 * @throws {RefError} For anything else; routes render their 404 page.
 */
export function decodeRef(ref: string): string {
  try {
    const href = fromBase64Url(ref);
    if (assertHttpUrl(href).href !== href) throw new RefError(ref);
    return href;
  } catch {
    throw new RefError(ref);
  }
}

/**
 * Lossless references for RDF identifiers (for example a message subject IRI). Unlike
 * `encodeRef`, the IRI is not normalised through `new URL().href`, so `#naïve` survives as written
 * and still matches the literal subject in the data. The value must still be an http(s) IRI.
 * @throws {TypeError} When `iri` is not an absolute http(s) IRI.
 */
export function encodeIdentifierRef(iri: string): string {
  assertHttpUrl(iri);
  return toBase64Url(iri);
}

/**
 * Reverses `encodeIdentifierRef`, returning the identifier exactly as encoded. Because the IRI is
 * not normalised, values the lenient URL parser would repair (control characters, whitespace,
 * backslashes) are rejected rather than returned: none of them can appear in an IRI.
 * @throws {RefError} For anything that is not a canonically encoded http(s) IRI.
 */
export function decodeIdentifierRef(ref: string): string {
  try {
    const iri = fromBase64Url(ref);
    if (/[\s\\\p{Cc}]/u.test(iri)) throw new RefError(ref);
    assertHttpUrl(iri);
    return iri;
  } catch {
    throw new RefError(ref);
  }
}
