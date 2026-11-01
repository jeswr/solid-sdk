// AUTHORED-BY Codex GPT-6.1-Sol
// Context-free JSON-LD over RDF/JS fields only; no loaders, contexts or caller methods.
import type { Quad, Term } from "@rdfjs/types";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const LANGUAGE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in IRIs.
const FORBIDDEN_IRI = /[\u0000-\u0020<>"{}|^`\\\uD800-\uDFFF]/u;

type Value = { "@id": string } | { "@value": string; "@language"?: string; "@type"?: string };
interface Node {
  "@id": string;
  [property: string]: string | (Value | string | Node)[];
}

function stringField(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("RDF term fields must be strings");
  return value;
}

function iri(value: unknown): string {
  const result = stringField(value);
  if (!SCHEME.test(result) || FORBIDDEN_IRI.test(result)) {
    throw new TypeError("JSON-LD requires absolute IRIs without forbidden characters");
  }
  return result;
}

/** Serialise an RDF dataset without compaction, list folding or native-value coercion. */
export function serializeJsonLd(quads: readonly Quad[]): string {
  const blanks = new Map<string, string>();
  const identifier = (term: Term): string => {
    if (term.termType === "NamedNode") return iri(term.value);
    if (term.termType !== "BlankNode") {
      throw new TypeError("JSON-LD node identifiers must be named or blank nodes");
    }
    const label = stringField(term.value);
    let id = blanks.get(label);
    if (id === undefined) {
      id = `_:b${blanks.size}`;
      blanks.set(label, id);
    }
    return id;
  };
  const object = (term: Quad["object"]): Value => {
    if (term.termType !== "Literal") return { "@id": identifier(term) };
    const value = stringField(term.value);
    const language = stringField(term.language);
    const direction = (term as { direction?: unknown }).direction;
    if (direction !== undefined && direction !== null && direction !== "") {
      throw new TypeError("Directional literals cannot be serialised as JSON-LD");
    }
    if (term.datatype?.termType !== "NamedNode") {
      throw new TypeError("Literal datatypes must be named nodes");
    }
    const datatype = iri(term.datatype.value);
    if (datatype === `${RDF}dirLangString`) {
      throw new TypeError("Directional literals cannot be serialised as JSON-LD");
    }
    if (language !== "") {
      if (datatype !== `${RDF}langString` || !LANGUAGE.test(language)) {
        throw new TypeError("Language literals require rdf:langString and a valid language tag");
      }
      return { "@value": value, "@language": language.toLowerCase() };
    }
    if (datatype === `${RDF}langString`) {
      throw new TypeError("rdf:langString requires a language tag");
    }
    return datatype === XSD_STRING ? { "@value": value } : { "@value": value, "@type": datatype };
  };
  const node = (nodes: Map<string, Node>, id: string): Node => {
    let result = nodes.get(id);
    if (result === undefined) {
      result = { "@id": id };
      nodes.set(id, result);
    }
    return result;
  };

  const defaults = new Map<string, Node>();
  const graphs = new Map<string, Map<string, Node>>();
  for (const quad of quads) {
    let nodes = defaults;
    if (quad.graph.termType === "DefaultGraph") {
      if (stringField(quad.graph.value) !== "") {
        throw new TypeError("DefaultGraph must have an empty value");
      }
    } else {
      const graph = identifier(quad.graph);
      const existing = graphs.get(graph);
      nodes = existing ?? new Map<string, Node>();
      graphs.set(graph, nodes);
    }
    const subject = node(nodes, identifier(quad.subject));
    if (quad.predicate.termType !== "NamedNode") {
      throw new TypeError("JSON-LD predicates must be named nodes");
    }
    const predicate = iri(quad.predicate.value);
    const value = object(quad.object);
    const isType = predicate === `${RDF}type` && quad.object.termType === "NamedNode";
    const property = isType ? "@type" : predicate;
    subject[property] ??= [];
    (subject[property] as (Value | string)[]).push(
      isType ? (value as { "@id": string })["@id"] : value,
    );
  }
  for (const [id, nodes] of graphs) {
    node(defaults, id)["@graph"] = [...nodes.values()];
  }
  return JSON.stringify([...defaults.values()]);
}
