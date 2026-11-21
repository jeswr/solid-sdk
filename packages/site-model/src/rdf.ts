// AUTHORED-BY Claude Opus 5.5
/** Dataset preparation shared by the site-model reader and the action-request parser. */
import { type ParseRdfSyncOptions, parseRdfSync } from "@jeswr/fetch-rdf";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { SiteModelError } from "./errors.js";
import { jsonLdToQuads } from "./jsonld.js";
import { normaliseSchemaIri, RDF_FIRST, RDF_REST } from "./vocab.js";

const { namedNode, literal, quad } = DataFactory;

export interface ParseOptions {
  baseIRI?: string;
  format?: string;
}

/** Parse Turtle-family text (via @jeswr/fetch-rdf) or the JSON-LD subset into quads. */
export function parseText(input: string, options: ParseOptions, what: string): Quad[] {
  const format = options.format ?? "text/turtle";
  try {
    if (format === "application/ld+json") {
      return jsonLdToQuads(
        input,
        options.baseIRI === undefined ? {} : { baseIRI: options.baseIRI },
      );
    }
    return [
      ...parseRdfSync(input, {
        format: format as ParseRdfSyncOptions["format"],
        ...(options.baseIRI === undefined ? {} : { baseIRI: options.baseIRI }),
      }),
    ];
  } catch (cause) {
    if (cause instanceof SiteModelError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new SiteModelError(`could not parse the ${what} as ${format}${detail}`, { cause });
  }
}

function normaliseTerm<T extends Term>(term: T): T {
  if (term.termType === "NamedNode") {
    const value = normaliseSchemaIri(term.value);
    return (value === term.value ? term : namedNode(value)) as T;
  }
  if (term.termType === "Literal" && term.language === "") {
    const datatype = normaliseSchemaIri(term.datatype.value);
    return (
      datatype === term.datatype.value ? term : literal(term.value, namedNode(datatype))
    ) as T;
  }
  return term;
}

/** Rewrite every `http://schema.org/` IRI to `https://schema.org/`, dropping duplicates. */
export function normaliseSchemaTerms(quads: Iterable<Quad>): Store {
  const store = new Store();
  for (const q of quads) {
    store.addQuad(
      quad(normaliseTerm(q.subject), normaliseTerm(q.predicate), normaliseTerm(q.object), q.graph),
    );
  }
  return store;
}

/** The prefix of the IRIs that replace blank nodes in a site model document. */
export const SKOLEM_PREFIX = "urn:x-site-model:genid:";

/**
 * Replace every blank node that is not an RDF list cell with a skolem IRI, so the generated
 * wrappers (which accept only named nodes) can read hand-written `[ ... ]` nodes. List cells
 * stay blank: list readers require blank nodes or rdf:nil.
 */
export function skolemise(store: Store): Store {
  const cells = new Set<string>();
  for (const predicate of [RDF_FIRST, RDF_REST]) {
    for (const q of store.match(null, namedNode(predicate), null)) {
      if (q.subject.termType === "BlankNode") cells.add(q.subject.value);
    }
  }
  const labels = new Map<string, string>();
  const map = <T extends Term>(term: T): T => {
    if (term.termType !== "BlankNode" || cells.has(term.value)) return term;
    let iri = labels.get(term.value);
    if (iri === undefined) {
      iri = `${SKOLEM_PREFIX}${labels.size}`;
      labels.set(term.value, iri);
    }
    return namedNode(iri) as unknown as T;
  };
  const out = new Store();
  for (const q of store) {
    out.addQuad(quad(map(q.subject), q.predicate, map(q.object), q.graph));
  }
  return out;
}
