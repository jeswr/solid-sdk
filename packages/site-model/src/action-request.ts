// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/** parseActionRequest: the planner's RDF action -> an ActionRequest over its single action node. */
import type { Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { SiteModelError } from "./errors.js";
import { normaliseSchemaTerms, parseText } from "./rdf.js";
import type { ActionRequest } from "./types.js";
import { SCHEMA } from "./types.js";
import { normaliseSchemaIri, RDF_TYPE } from "./vocab.js";

export interface ActionRequestOptions {
  format?: "text/turtle" | "application/ld+json";
  baseIRI?: string;
}

/** True for a schema.org IRI (after https normalisation) whose local name ends in `Action`. */
export function isSchemaActionType(iri: string): boolean {
  const normalised = normaliseSchemaIri(iri);
  return (
    normalised.startsWith(SCHEMA) &&
    normalised.endsWith("Action") &&
    !normalised.slice(SCHEMA.length).includes("/")
  );
}

function label(term: Term): string {
  return term.termType === "BlankNode" ? `_:${term.value}` : term.value;
}

class Request implements ActionRequest {
  constructor(
    private readonly dataset: Store,
    private readonly term: Term,
    readonly types: string[],
  ) {}

  get node(): string {
    return label(this.term);
  }

  terms(path: string[]): Term[] {
    let current: Term[] = [this.term];
    for (const step of path) {
      const predicate = DataFactory.namedNode(normaliseSchemaIri(step));
      const next = new Map<string, Term>();
      for (const subject of current) {
        if (subject.termType === "Literal") continue;
        for (const object of this.dataset.getObjects(subject, predicate, null)) {
          next.set(
            `${object.termType}:${object.value}:${object.termType === "Literal" ? object.datatype.value + object.language : ""}`,
            object,
          );
        }
      }
      current = [...next.values()];
    }
    return current;
  }

  values(path: string[]): string[] {
    return [...new Set(this.terms(path).map(label))];
  }
}

/** Term-preserving access for parsed requests, without changing the shared contract.
 * Custom ActionRequest implementations may supply the same optional terms method.
 */
export function actionRequestTerms(
  request: ActionRequest,
  path: string[],
): readonly Term[] | undefined {
  const typed = request as ActionRequest & { terms?: (path: string[]) => readonly Term[] };
  return typed.terms?.(path);
}

/**
 * Parse a planner's action request (Turtle by default, or the JSON-LD subset documented in
 * jsonld.ts). Exactly one node must be typed with a schema.org action class (an IRI under
 * https:// or http://schema.org/ whose name ends in `Action`); http schema.org IRIs are
 * normalised to https everywhere, including in `values` paths.
 */
export function parseActionRequest(
  input: string,
  options: ActionRequestOptions = {},
): ActionRequest {
  const dataset = normaliseSchemaTerms(parseText(input, options, "action request"));
  const typed = new Map<string, { term: Term; types: string[] }>();
  for (const q of dataset.getQuads(null, DataFactory.namedNode(RDF_TYPE), null, null)) {
    const key = label(q.subject);
    const entry = typed.get(key) ?? { term: q.subject as Term, types: [] as string[] };
    entry.types.push(q.object.value);
    typed.set(key, entry);
  }
  const actions = [...typed.values()].filter((entry) => entry.types.some(isSchemaActionType));
  if (actions.length === 0) {
    throw new SiteModelError("the request has no node typed with a schema.org action class");
  }
  if (actions.length > 1) {
    throw new SiteModelError(
      `the request has ${actions.length} schema.org action nodes (${actions.map((a) => label(a.term)).join(", ")}); send one action per request`,
    );
  }
  const action = actions[0] as { term: Term; types: string[] };
  return new Request(dataset, action.term, [...action.types].sort());
}
