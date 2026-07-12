// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Write-path serialisation for the Pod Drive data layer.
//
// The only sanctioned RDF-out path: build quads through the n3 DataFactory
// (never string concatenation), then serialise with n3.Writer. The resulting
// Turtle is what the app conditionally PUTs/PATCHes back to the pod (the HTTP
// write itself, with `If-Match: <etag>`, is the UI layer's job — kept out of
// this pure data module so it stays trivially testable and auth-agnostic).

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
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      ldp: "http://www.w3.org/ns/ldp#",
      posix: "http://www.w3.org/ns/posix/stat#",
      dcterms: "http://purl.org/dc/terms/",
      solid: "http://www.w3.org/ns/solid/terms#",
      poddrive: "https://w3id.org/jeswr/pod-drive#",
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
  return namedNode(value);
}
