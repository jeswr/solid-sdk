// AUTHORED-BY Claude Fable 5
/**
 * IRI safety guard for RDF serialisation.
 *
 * `n3.Writer` does NOT escape IRIs: a string handed to `namedNode()` is emitted
 * verbatim between `<…>`. It escapes newlines/tabs but NOT the delimiters that
 * matter for Turtle IRI-refs — `>` `<` `"` `{` `}` SPACE `|` `^` `` ` `` — so an
 * UNTRUSTED IRI containing a `>` (or a space) closes the IRI-ref early and injects
 * arbitrary triples into the serialised document. `SceneData` fields are plain,
 * caller-supplied, potentially-attacker-controlled strings; every one that becomes
 * an IRI must pass through this guard before reaching `namedNode()`.
 *
 * The scene model's IRI fields (`sceneDocument`, `thumbnail`, `about`,
 * `wasGeneratedBy`) are all semantically http(s) resource IRIs, so the guard both
 * rejects non-http(s) values and canonicalises the result. It parses with the WHATWG
 * `URL` (which rejects a raw space, `>`, `<`, `"`, `{`, `}` and percent-encodes them
 * in the path/query), then additionally percent-encodes the three characters `URL`
 * leaves untouched but Turtle forbids in an IRI-ref: `|` `^` `` ` ``.
 *
 * Mirrors the `safeHttpIri` pattern from `@jeswr/rdf-serialize` / `solid-dav-bridge`.
 */

/**
 * Canonicalise an untrusted string to a Turtle-safe http(s) IRI, or `undefined`
 * when the value is not a parseable http(s) IRI. A returned value is guaranteed to
 * contain none of the characters that could break out of a Turtle `<…>` IRI-ref.
 */
export function safeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  // `URL` already rejects/encodes `> < " { }` and whitespace, but leaves these
  // three — which are illegal in a Turtle IRIREF — in place. Encode them so the
  // serialised `<…>` cannot be broken out of.
  return u.href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
}
