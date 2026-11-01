// AUTHORED-BY Codex GPT-6
import type { Quad, Term } from "@rdfjs/types";
import { Parser, Writer } from "n3";
import { isSafeAbsoluteIri, isTurtleBlankNodeLabel, isTurtlePrefixName } from "./guards.js";
import { ManifestError } from "./manifest.js";

// RFC 5646 well-formed tags (including private-use and grandfathered forms).
// Registry membership is deliberately not a network-dependent check.
const GRANDFATHERED = new Set([
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);
function isLanguageTag(value: string): boolean {
  if (/[^A-Za-z0-9-]/.test(value) || !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(value)) return false;
  const tag = value.toLowerCase();
  if (GRANDFATHERED.has(tag)) return true;
  if (/^x(?:-[a-z0-9]{1,8})+$/.test(tag)) return true;
  const match =
    /^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?((?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*)((?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*)(?:-x(?:-[a-z0-9]{1,8})+)?$/.exec(
      tag,
    );
  if (!match) return false;
  const variants = (match[1] ?? "").split("-").filter(Boolean);
  const singletons = (match[2] ?? "").split("-").filter((s) => s.length === 1);
  return (
    new Set(variants).size === variants.length && new Set(singletons).size === singletons.length
  );
}

/** Shared fail-closed term/position validation for both writer boundaries. */
export function assertWritableQuads(quads: readonly Quad[]): void {
  for (const quad of quads) {
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      switch (term.termType) {
        case "NamedNode":
          if (!isSafeAbsoluteIri(term.value))
            throw new TypeError("NamedNode must be a safe absolute IRI");
          break;
        case "BlankNode":
          if (!isTurtleBlankNodeLabel(term.value))
            throw new TypeError("invalid Turtle blank-node label");
          break;
        case "Literal":
          if (term.datatype.termType !== "NamedNode" || !isSafeAbsoluteIri(term.datatype.value))
            throw new TypeError("literal datatype must be a safe absolute IRI");
          if (term.language && !isLanguageTag(term.language))
            throw new TypeError("invalid literal language tag");
          break;
        case "DefaultGraph":
          if (term.value !== "") throw new TypeError("invalid default graph");
          break;
        default:
          throw new TypeError("unsupported RDF term kind");
      }
    }
    if (
      !["NamedNode", "BlankNode"].includes(quad.subject.termType) ||
      quad.predicate.termType !== "NamedNode" ||
      !["NamedNode", "BlankNode", "Literal"].includes(quad.object.termType) ||
      !["NamedNode", "BlankNode", "DefaultGraph"].includes(quad.graph.termType)
    )
      throw new TypeError("invalid RDF term position");
  }
}

/**
 * Verify the emitted quad SET in linear time, including literal lexical identity.
 * Writer emits explicit blank labels; Parser's fixed prefix supplies a known
 * bijection back to those labels, so no graph-isomorphism search is necessary.
 * Any future writer that changes labels without this bijection fails closed.
 */
export function assertSerializedQuads(quads: readonly Quad[], serialized: string): void {
  const prefix = "roundtrip_";
  const termKey = (term: Term, parsed: boolean): unknown => {
    if (term.termType === "BlankNode") {
      if (parsed && !term.value.startsWith(prefix))
        throw new TypeError("unknown output blank node");
      return [term.termType, parsed ? term.value.slice(prefix.length) : term.value];
    }
    return term.termType === "Literal"
      ? [
          term.termType,
          term.value,
          term.language.toLowerCase(),
          term.datatype.value,
          "direction" in term ? term.direction : "",
        ]
      : [term.termType, term.value];
  };
  const keys = (qs: readonly Quad[], parsed: boolean) =>
    new Set(
      qs.map((q) =>
        JSON.stringify([q.subject, q.predicate, q.object, q.graph].map((t) => termKey(t, parsed))),
      ),
    );
  try {
    const expected = keys(quads, false);
    const actual = keys(new Parser({ blankNodePrefix: prefix }).parse(serialized), true);
    if (expected.size !== actual.size || [...expected].some((key) => !actual.has(key)))
      throw new TypeError("serialization changed the RDF quad set");
  } catch (cause) {
    throw new TypeError("RDF serialization failed its round-trip integrity check", { cause });
  }
}

/** The only runtime serialization boundary. Call AFTER migrating read aliases. */
export function serializeTurtle(
  quads: Iterable<Quad>,
  prefixes: Record<string, string>,
  aliases: readonly string[] = [],
): Promise<string> {
  const output = [...quads];
  // Snapshot mutable inputs and validate exactly what will reach N3. Reject rather
  // than escape/canonicalize: repairing an IRI would change RDF identity.
  const namespaces = { ...prefixes };
  for (const [label, iri] of Object.entries(namespaces)) {
    if (!isTurtlePrefixName(label)) throw new ManifestError("invalid Turtle prefix name");
    if (!isSafeAbsoluteIri(iri))
      throw new TypeError("prefix namespace must be a safe absolute IRI");
  }
  assertWritableQuads(output);
  const emittedPrefixes = Object.fromEntries(
    Object.entries(namespaces).filter(([, iri]) => !aliases.some((alias) => alias.startsWith(iri))),
  );
  const writer = new Writer({ prefixes: emittedPrefixes });
  writer.addQuads(output);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => {
      if (error) return reject(new TypeError("RDF serialization failed", { cause: error }));
      try {
        assertSerializedQuads(output, result);
        resolve(result);
      } catch (cause) {
        reject(cause);
      }
    });
  });
}
