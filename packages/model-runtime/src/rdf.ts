// AUTHORED-BY Codex GPT-6
import type { Quad } from "@rdfjs/types";
import { Writer } from "n3";
import { isSafeAbsoluteIri, isTurtlePrefixName } from "./guards.js";
import { ManifestError } from "./manifest.js";

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
  for (const quad of output) {
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      if (term.termType === "NamedNode" && !isSafeAbsoluteIri(term.value)) {
        throw new TypeError("NamedNode must be a safe absolute IRI");
      }
      if (term.termType === "Literal" && !isSafeAbsoluteIri(term.datatype.value)) {
        throw new TypeError("literal datatype must be a safe absolute IRI");
      }
    }
  }
  const emittedPrefixes = Object.fromEntries(
    Object.entries(namespaces).filter(([, iri]) => !aliases.some((alias) => alias.startsWith(iri))),
  );
  const writer = new Writer({ prefixes: emittedPrefixes });
  writer.addQuads(output);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
