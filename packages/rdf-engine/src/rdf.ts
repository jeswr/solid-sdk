// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store, Writer } from "n3";
import type { ParseOptions, QuadSource, RdfMediaType, SerializeOptions } from "./types.js";

export const formats = {
  "text/turtle": "turtle",
  "application/trig": "trig",
  "application/n-triples": "ntriples",
  "application/n-quads": "nquads",
  "application/ld+json": "jsonld",
} as const;

export function formatName(mediaType: RdfMediaType): (typeof formats)[RdfMediaType] {
  if (!Object.hasOwn(formats, mediaType))
    throw new TypeError(`Unsupported RDF media type: ${mediaType}`);
  return formats[mediaType];
}

export function decode(input: string | Uint8Array): string {
  return typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true }).decode(input);
}

export function parseN3(input: string, format: RdfMediaType, opts?: ParseOptions): Store {
  return new Store(new Parser({ format, baseIRI: opts?.baseIri }).parse(input));
}

export function writeN3(data: QuadSource, format: RdfMediaType, opts?: SerializeOptions): string {
  const writer = new Writer({ format, prefixes: opts?.prefixes });
  const quads = [...data].filter(
    (q) =>
      !["text/turtle", "application/n-triples"].includes(format) ||
      q.graph.termType === "DefaultGraph",
  );
  writer.addQuads(quads);
  // The pinned n3 string writer calls end synchronously (no external output stream).
  let output = "";
  writer.end((_error, result) => {
    output = result;
  });
  return output;
}

/** SHACL validates graphs; fold dataset graph names without changing RDF terms. */
export function graphDocument(data: QuadSource): string {
  return writeN3(
    [...data].map((q) => DataFactory.quad(q.subject, q.predicate, q.object)),
    "application/n-triples",
  );
}

export function hasBlankNode(term: Term): boolean {
  return (
    term.termType === "BlankNode" ||
    (term.termType === "Quad" &&
      [term.subject, term.predicate, term.object, term.graph].some(hasBlankNode))
  );
}

export function groundCanonical(quads: Quad[]): string {
  // n3's Writer emits valid N-Quads, but its escape spelling is not always canonical.
  // Normalize only escapes/control characters; ordinary RDF serialization stays in Writer.
  const canonical = writeN3(quads, "application/n-quads").replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Canonical N-Quads must escape these controls.
    /\\(?:U[0-9a-fA-F]{8}|u[0-9a-fA-F]{4}|.)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    (encoded) => {
      if (encoded.startsWith("\\U"))
        return String.fromCodePoint(Number.parseInt(encoded.slice(2), 16));
      if (encoded.startsWith("\\u")) return `\\u${encoded.slice(2).toUpperCase()}`;
      if (encoded.startsWith("\\")) return encoded;
      return `\\u${encoded.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    },
  );
  const lines = canonical.split("\n").filter(Boolean);
  return [...new Set(lines)]
    .sort(compareCodepoints)
    .map((line) => `${line}\n`)
    .join("");
}

function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) as number);
  const b = Array.from(right, (character) => character.codePointAt(0) as number);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = (a[i] as number) - (b[i] as number);
    if (difference) return difference;
  }
  return a.length - b.length;
}
