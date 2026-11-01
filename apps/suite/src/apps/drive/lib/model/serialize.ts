// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-drive (original author: Claude Opus 4.8).
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Writer } from "n3";

const { namedNode } = DataFactory;

/**
 * Serialise a set of quads to Turtle. Prefixes are emitted for the vocabularies
 * the drive uses, so the output is human-readable. Rejects if the underlying
 * serialiser surfaces an error (the `error` argument to n3.Writer's `end`
 * callback) — surfaced as a rejection so callers never receive a partial
 * document.
 */
export function quadsToTurtle(quads: Iterable<Quad>): Promise<string> {
  const writer = new Writer({
    prefixes: {
      rdf: NS.RDF,
      ldp: NS.LDP,
      posix: NS.POSIX,
      dcterms: NS.DCT,
      solid: NS.SOLID,
      poddrive: NS.POD_DRIVE,
    },
  });
  for (const q of quads) {
    writer.addQuad(q);
  }
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/** A named-node term — the single place the write path mints an IRI subject/object. */
export function iri(value: string) {
  const safe = safeHttpIri(value);
  if (safe === undefined) throw new TypeError("Expected an absolute HTTP(S) IRI");
  return namedNode(safe);
}
