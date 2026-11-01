// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { escapeIri } from "./iri.js";

const LANGUAGE = /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject IRIREF-forbidden characters and lone surrogates.
const FORBIDDEN_IRI = /[\u0000-\u0020<>"{}|^`\\\uD800-\uDFFF]/u;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const PN_CHARS_BASE =
  "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F" +
  "\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const PN_CHARS = `${PN_CHARS_BASE}_\\-0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040`;
const PREFIX = new RegExp(`^(?:[${PN_CHARS_BASE}](?:[${PN_CHARS}.]*[${PN_CHARS}])?)?$`, "u");
const BLANK_LABEL = new RegExp(`^[${PN_CHARS_BASE}_0-9](?:[${PN_CHARS}.]*[${PN_CHARS}])?$`, "u");
// Preserve N3 Patch formula variables, including callers using the line-mode writer.
const VARIABLE = new RegExp(
  `^[${PN_CHARS_BASE}_][${PN_CHARS_BASE}_0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040]*$`,
  "u",
);

function stringField(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("RDF term fields must be strings");
  return value;
}

function iri(value: unknown): string {
  const result = stringField(value);
  // Relative references (`<>` for a POSTed resource, `<#me>`) stay legal Turtle; only
  // IRIREF-forbidden characters can break out of the angle brackets. N3 identifies
  // variables as `?x` and blank nodes as `_:x`, so relative references spelled that way
  // would compare equal to those terms when the writer groups subjects and predicates.
  if (FORBIDDEN_IRI.test(result) || result.startsWith("?") || result.startsWith("_:")) {
    throw new TypeError("RDF terms require IRIs without IRIREF-forbidden characters");
  }
  return result;
}

/** Datatypes, prefix namespaces and named graphs must be absolute: relative ones change meaning. */
function absoluteIri(value: unknown): string {
  const result = iri(value);
  if (!SCHEME.test(result)) throw new TypeError("Expected an absolute IRI");
  return result;
}

/** Snapshot RDF/JS fields into factory terms; never pass caller objects or methods to N3. */
export function injectionSafe(quads: readonly Quad[]): Quad[] {
  const { namedNode, blankNode, variable, literal, defaultGraph, quad } = DataFactory;
  // Snapshot blank labels once before allocating replacements, including the empty label.
  const labels = new Map<string, string>();
  const nodes = new Map<string, ReturnType<typeof blankNode>>();
  let nextIndex = 0;
  const variableTerm = (value: unknown) => {
    const name = stringField(value);
    if (!VARIABLE.test(name)) throw new TypeError("Invalid N3 variable name");
    return variable(name);
  };
  const node = (term: Term): Quad["subject"] => {
    if (term.termType === "NamedNode") return namedNode(iri(term.value));
    if (term.termType === "Variable") return variableTerm(term.value);
    if (term.termType !== "BlankNode") throw new TypeError("Expected a named or blank node");
    const value = stringField(term.value);
    // Temporary nonempty labels avoid n3's fresh-node semantics for blankNode("").
    let result = nodes.get(value);
    if (result === undefined) {
      result = blankNode(`snapshot${nodes.size}`);
      nodes.set(value, result);
      labels.set(result.value, value);
    }
    return result;
  };
  const object = (term: Quad["object"]): Quad["object"] => {
    if (term.termType !== "Literal") return node(term);
    const value = stringField(term.value);
    const language = stringField(term.language);
    if (term.datatype?.termType !== "NamedNode") throw new TypeError("Expected a datatype IRI");
    const datatype = absoluteIri(term.datatype.value);
    if (language !== "") {
      const direction = (term as { direction?: unknown }).direction ?? "";
      if (direction !== "" && direction !== "ltr" && direction !== "rtl") {
        throw new TypeError("Invalid literal direction");
      }
      if (
        !LANGUAGE.test(language) ||
        datatype !== `${RDF}${direction ? "dirLangString" : "langString"}`
      ) {
        throw new TypeError("Language literals require a valid language tag and matching datatype");
      }
      const result = literal(value, direction ? `${language}--${direction}` : language);
      // The factory lowercases tags; the writer historically preserves caller spelling.
      // Shadow only this validated field on our own term, never a caller method or private ID.
      Object.defineProperty(result, "language", { value: language });
      return result;
    }
    // N3's direction getter also reads '--' in a typed literal's datatype IRI.
    // Direction only applies to language literals; never interpret that datatype suffix.
    if (datatype === `${RDF}langString` || datatype === `${RDF}dirLangString`) {
      throw new TypeError("Language datatypes require a language tag");
    }
    return literal(value, namedNode(datatype));
  };
  const rebuilt = quads.map((q) => {
    if (q.predicate.termType !== "NamedNode" && q.predicate.termType !== "Variable") {
      throw new TypeError("Expected a predicate IRI or N3 variable");
    }
    let graph: Quad["graph"];
    if (q.graph.termType === "DefaultGraph") {
      if (q.graph.value !== "") throw new TypeError("DefaultGraph must have an empty value");
      graph = defaultGraph();
    } else {
      // An empty named graph IRI would share N3's id with the default graph.
      if (q.graph.termType === "NamedNode") absoluteIri(q.graph.value);
      graph = node(q.graph) as Quad["graph"];
    }
    const predicate =
      q.predicate.termType === "Variable"
        ? variableTerm(q.predicate.value)
        : namedNode(iri(q.predicate.value));
    return quad(node(q.subject), predicate, object(q.object), graph);
  });
  const taken = new Set(labels.values());
  const replacements = new Map<string, ReturnType<typeof blankNode>>();
  for (const [snapshot, value] of labels) {
    let label = value;
    if (!BLANK_LABEL.test(label)) {
      do {
        label = `x${nextIndex++}`;
      } while (taken.has(label));
      taken.add(label);
    }
    replacements.set(snapshot, blankNode(label));
  }
  const relabel = <T extends Term>(term: T): T =>
    (term.termType === "BlankNode" ? replacements.get(term.value) : term) as T;
  return rebuilt.map((q) =>
    quad(relabel(q.subject), q.predicate, relabel(q.object), relabel(q.graph)),
  );
}

/** N3's prefix regex must never confuse an absolute IRI's scheme with a prefix label. */
export function safePrefixes(
  quads: readonly Quad[],
  prefixes: Readonly<Record<string, string>>,
): Record<string, string> {
  const schemes = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      const value =
        term.termType === "NamedNode"
          ? term.value
          : term.termType === "Literal"
            ? term.datatype.value
            : undefined;
      if (value !== undefined) schemes.add(value.slice(0, value.indexOf(":") + 1));
    }
  }
  const result: Record<string, string> = Object.create(null);
  for (const [name, namespace] of Object.entries(prefixes)) {
    if (!PREFIX.test(name)) throw new TypeError(`Invalid prefix name: ${JSON.stringify(name)}`);
    // N3 embeds prefix names unescaped; dots act as wildcards (and its lexer rejects '..').
    if (name.includes(".") || schemes.has(`${name}:`)) continue;
    const value = escapeIri(stringField(namespace));
    // N3 does not escape these namespace regex metacharacters (notably IPv6's '[').
    if (/[[{}|^]/.test(value)) continue;
    // A relative namespace would abbreviate IRIs into names that resolve elsewhere.
    if (!SCHEME.test(value)) continue;
    result[name] = iri(value);
  }
  return result;
}
