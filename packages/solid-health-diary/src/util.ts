// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Tiny shared helpers used by every entity module — factored out so a plain data
 * projection reads as a flat list of field copies rather than a wall of
 * `if (x !== undefined)` branches, and so the "copy an optional field through,
 * omitting it when absent" pattern has exactly one reviewed home.
 *
 * Pure, no platform, no RDF — client-safe.
 */

/**
 * Assign `target[key] = value` ONLY when `value` is defined. Typed so each call
 * still binds a single named field of `T` to a value of that field's exact type
 * (no widening, no `any`). Ported from the `@jeswr/solid-task-model` template.
 */
export function setIfDefined<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Return `value` only if it is a VALID `Date`, else `undefined`. `@rdfjs/wrapper`'s
 * `LiteralAs.date` reads a date literal as `new Date(term.value)`, which yields a
 * truthy but broken `Invalid Date` (`getTime()` ⇒ `NaN`) for a malformed lexical.
 * A bare truthiness check would let such a value through and corrupt lag / review
 * logic (or serialise back as an invalid literal). Use this on EVERY parsed `Date`:
 * reject the record when a REQUIRED date is invalid; drop an invalid OPTIONAL one.
 */
export function validDateOrUndefined(value: Date | undefined): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

/**
 * Run `read` and return its result, or `undefined` if it THREW. The typed
 * `@rdfjs/wrapper` accessors (`LiteralAs.*` / `NamedNodeAs.*`) throw on a
 * wrong-term-type / wrong-datatype object — e.g. a literal where a NamedNode is
 * expected, or a `schema:startTime` that is not an `xsd:dateTime`. A hostile or
 * malformed pod document must never CRASH a parse: wrap each entity parser's body
 * in this guard so such a document fails CLOSED to `undefined` (the record is
 * dropped) instead of throwing out of the reader.
 */
export function tryRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
