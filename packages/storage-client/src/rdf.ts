// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// RDF helpers shared by the backends: serialise through @jeswr/rdf-serialize (n3.Writer) and
// apply insert/delete quad patches to an n3 Store. Never hand-builds RDF text.

import type { DatasetCore, Quad, Term } from "@jeswr/fetch-rdf";
import { extractMediaType } from "@jeswr/fetch-rdf";
import { escapeIri, serialize } from "@jeswr/rdf-serialize";
import { DataFactory, type Store } from "n3";

/** Media types the n3 writer can produce, so stored RDF can be patched in place. */
export const WRITABLE_RDF = new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

/** Formats that cannot carry named graphs. */
export const TRIPLE_FORMATS = new Set(["text/turtle", "application/n-triples"]);

const inNamedGraph = (quad: Quad) => quad.graph.termType !== "DefaultGraph";

const BLANK_LABEL = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const LANGUAGE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;
/** Turtle PN_CHARS_BASE, and PN_CHARS (PN_CHARS_BASE plus `_`, `-`, digits and combining marks). */
const PN_CHARS_BASE =
  "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F" +
  "\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const PN_CHARS = `${PN_CHARS_BASE}_\\-0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040`;
/** Turtle PN_PREFIX, exactly (empty allowed): PN_CHARS_BASE ((PN_CHARS | '.')* PN_CHARS)? */
const PREFIX = new RegExp(`^(?:[${PN_CHARS_BASE}](?:[${PN_CHARS}.]*[${PN_CHARS}])?)?$`, "u");

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`RDF term ${field} must be a string`);
  return value;
}

/** An absolute IRI starts with a scheme; n3 would read `_:`, `?` or `"` ids as other terms. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function iriField(value: unknown, field: string): string {
  const iri = stringField(value, field);
  if (!SCHEME.test(iri)) throw new TypeError(`RDF term ${field} must be an absolute IRI`);
  return iri;
}

/**
 * Rebuild quads with n3's DataFactory from each term's termType, value, language, direction and
 * datatype only. n3 (Writer and Store) identifies its own term instances by a private string
 * `id` and re-derives term fields from it, so a caller's object, or any other property of it,
 * must never be used, and every field must be one n3 can encode faithfully: named-node and
 * datatype IRIs must be absolute, datatype IRIs are escaped (a `"` in one would end the literal
 * inside n3's id), language tags and base directions must be well formed, and every empty
 * blank-node label maps to one fresh label shared across `quads`. Anything else is a TypeError.
 */
function rebuildQuads(quads: readonly Quad[]): Quad[] {
  const { namedNode, blankNode, variable, literal, defaultGraph, quad } = DataFactory;
  let empty: Term | undefined;
  const rebuild = (value: Term): Term => {
    const lexical = stringField(value.value, "value");
    switch (value.termType) {
      case "NamedNode":
        return namedNode(iriField(lexical, "value"));
      case "BlankNode":
        if (lexical !== "") return blankNode(lexical);
        // n3 mints a new node for every blankNode(""); one empty label is one node, under a
        // label no other blank node in `quads` uses.
        if (empty === undefined) {
          const used = new Set(
            quads
              .flatMap((q) => [q.subject, q.object, q.graph])
              .filter((t) => t.termType === "BlankNode")
              .map((t) => t.value),
          );
          let index = 0;
          while (used.has(`empty${index}`)) index++;
          empty = blankNode(`empty${index}`);
        }
        return empty;
      case "Variable":
        return variable(lexical);
      case "Literal": {
        const language = stringField(value.language, "language");
        const baseDirection = (value as { direction?: unknown }).direction;
        // RDF/JS 1.1 literals have no direction field; some factories use null for none.
        const direction = stringField(
          baseDirection === undefined || baseDirection === null ? "" : baseDirection,
          "direction",
        );
        const datatype = escapeIri(iriField(value.datatype?.value, "datatype.value"));
        if (language) {
          if (!LANGUAGE.test(language)) {
            throw new TypeError(`Invalid language tag: ${JSON.stringify(language)}`);
          }
          if (direction && direction !== "ltr" && direction !== "rtl") {
            throw new TypeError(`Invalid base direction: ${JSON.stringify(direction)}`);
          }
          return literal(lexical, direction ? `${language}--${direction}` : language);
        }
        return literal(lexical, namedNode(datatype));
      }
      case "DefaultGraph":
        return defaultGraph();
      default:
        throw new TypeError(`${String(value.termType)} terms are not RDF/JS terms`);
    }
  };
  return quads.map((q) =>
    quad(
      rebuild(q.subject) as Quad["subject"],
      rebuild(q.predicate) as Quad["predicate"],
      rebuild(q.object) as Quad["object"],
      rebuild(q.graph) as Quad["graph"],
    ),
  );
}

/**
 * n3.Writer emits IRIs, blank-node labels and language tags verbatim, so a crafted value could
 * break out of `<…>` and forge triples. Rebuild every term first (see `rebuild`), then
 * percent-encode IRIREF-forbidden characters in every IRI (@jeswr/rdf-serialize `escapeIri`;
 * legitimate IRIs are unchanged) and relabel unsafe blank nodes consistently.
 */
function injectionSafe(quads: readonly Quad[]): Quad[] {
  const { namedNode, blankNode, literal, quad } = DataFactory;
  const labels = new Map<string, string>();
  const term = (value: Term): Term => {
    switch (value.termType) {
      case "NamedNode":
        return namedNode(escapeIri(value.value));
      case "BlankNode": {
        if (BLANK_LABEL.test(value.value)) return value;
        let label = labels.get(value.value);
        if (label === undefined) {
          label = `x${labels.size}_${crypto.randomUUID().replaceAll("-", "")}`;
          labels.set(value.value, label);
        }
        return blankNode(label);
      }
      case "Literal":
        return value.language
          ? value
          : literal(value.value, namedNode(escapeIri(value.datatype.value)));
      case "DefaultGraph":
        return value;
      default:
        throw new TypeError(`${value.termType} terms cannot be serialised`);
    }
  };
  return rebuildQuads(quads).map((q) =>
    quad(
      term(q.subject) as Quad["subject"],
      term(q.predicate) as Quad["predicate"],
      term(q.object) as Quad["object"],
      term(q.graph) as Quad["graph"],
    ),
  );
}

/** Lower-cased media type without parameters, or null when absent/invalid. */
export function mediaType(contentType: string): string | null {
  return extractMediaType(contentType)?.toLowerCase() ?? null;
}

/** Serialise quads in a WRITABLE_RDF format or expanded, context-free JSON-LD. */
export function serializeQuads(
  dataset: DatasetCore | Iterable<Quad>,
  format: string,
  prefixes: Record<string, string> = {},
): Promise<string> {
  const quads = [...(dataset as Iterable<Quad>)];
  if (format === "application/ld+json") {
    // JSON-LD validates RDF/JS fields itself. Avoid n3 rebuilding, which can discard
    // inconsistent language/datatype or direction fields before the writer sees them.
    return serialize(quads, { format });
  }
  if (TRIPLE_FORMATS.has(format) && quads.some(inNamedGraph)) {
    // n3.Writer would emit graph blocks, which are not valid in a triple-only format.
    throw new TypeError(
      `${format} cannot carry named graphs; use application/n-quads or application/trig`,
    );
  }
  const safe = injectionSafe(quads);
  // n3.Writer copies an IRI matching `^(?:name:)[^/]*$` for a declared prefix verbatim, building
  // that pattern from the unescaped name. So a prefix is dropped (the output stays correct, merely
  // unabbreviated) whenever some IRI starts with `name:`, and a dotted name is always dropped: its
  // `.` would act as a regex wildcard (and n3's lexer also rejects `..`). Without dots, every
  // valid PN_PREFIX character is literal in that pattern, so `startsWith` covers every match.
  const iris = new Set<string>();
  for (const q of safe) {
    for (const t of [q.subject, q.predicate, q.object, q.graph]) {
      if (t.termType === "NamedNode") iris.add(t.value);
      if (t.termType === "Literal") iris.add(t.datatype.value);
    }
  }
  const safePrefixes: Record<string, string> = {};
  for (const [name, namespace] of Object.entries(prefixes)) {
    if (!PREFIX.test(name)) throw new TypeError(`Invalid prefix name: ${JSON.stringify(name)}`);
    if (name.includes(".") || [...iris].some((iri) => iri.startsWith(`${name}:`))) continue;
    const iri = escapeIri(namespace);
    // n3.Writer escapes only `]/()*+?.\$` when it builds its namespace regex; any other regex
    // metacharacter surviving escapeIri (`[`, as in IPv6 hosts) would corrupt unrelated IRIs.
    if (/[[{}|^]/.test(iri)) continue;
    safePrefixes[name] = iri;
  }
  return serialize(safe, {
    format,
    prefixes: safePrefixes,
    emptyAsEmptyString: false,
  });
}

function hasTerm(quad: Quad, termType: Term["termType"]): boolean {
  return [quad.subject, quad.predicate, quad.object, quad.graph].some(
    (term) => term.termType === termType,
  );
}

/** Why an RDF patch was refused: `invalid` (malformed) or `conflict` (a deletion is absent). */
export class RdfPatchError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "RdfPatchError";
  }
}

/**
 * Apply N3-Patch-equivalent inserts/deletes (no `where`) to `store`, atomically: every deletion
 * must be present (else `conflict`, like N3 Patch's 409); variables are refused anywhere, and
 * blank nodes are refused in deletions (they cannot identify an existing node); `triplesOnly`
 * refuses named graphs for Turtle / N-Triples resources.
 */
export function applyQuadPatch(
  store: Store,
  inserts: readonly Quad[],
  deletes: readonly Quad[],
  triplesOnly = false,
): void {
  // Rebuild before any Store lookup or mutation: n3.Store matches n3 terms by their private `id`.
  let rebuiltInserts: Quad[];
  let rebuiltDeletes: Quad[];
  try {
    rebuiltInserts = rebuildQuads(inserts);
    rebuiltDeletes = rebuildQuads(deletes);
  } catch (error) {
    throw new RdfPatchError("invalid", (error as Error).message);
  }
  inserts = rebuiltInserts;
  deletes = rebuiltDeletes;
  for (const quad of [...inserts, ...deletes]) {
    if (hasTerm(quad, "Variable")) {
      throw new RdfPatchError("invalid", "Variables are only allowed in `where`");
    }
    if (triplesOnly && inNamedGraph(quad)) {
      throw new RdfPatchError("invalid", "Named graphs cannot be patched into a triple format");
    }
  }
  for (const quad of deletes) {
    if (hasTerm(quad, "BlankNode")) {
      throw new RdfPatchError("invalid", "Blank nodes cannot be deleted by value");
    }
    if (store.countQuads(quad.subject, quad.predicate, quad.object, quad.graph) === 0) {
      throw new RdfPatchError("conflict", "A quad to delete is not present");
    }
  }
  store.removeQuads([...deletes]);
  store.addQuads([...inserts]);
}
