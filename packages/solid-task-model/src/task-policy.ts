// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
/** Compatibility policies that cannot be expressed by the generated SHACL projection. */
import { readLiteral, sanitizeText, tryRead } from "@jeswr/model-runtime";
import type { Term } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import type { TaskData, TaskPriority, TaskState } from "./task-types.js";
import { dct, prov, rdf, schema, wf, xsd } from "./vocab.js";

export const PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

export function normalizePriority(value: string | undefined): TaskPriority | undefined {
  const normalized = (value ?? "").toLowerCase().trim();
  return PRIORITIES.find((priority) => priority === normalized);
}

export const scalarIris = {
  creator: dct("creator"),
  assignee: wf("assignee"),
  project: wf("tracker"),
  parent: dct("isPartOf"),
  duplicateOf: dct("isReplacedBy"),
  clonedFrom: prov("wasDerivedFrom"),
} as const;

/** The `xsd:dateTime` timestamp fields, keyed by their public accessor name. */
export const scalarDates = {
  created: dct("created"),
  modified: dct("modified"),
  endedAt: prov("endedAtTime"),
  dueDate: wf("dateDue"),
} as const;

/** Stored objects of one predicate; an unreadable dataset yields none (fail closed). */
function storedObjects(doc: TermWrapper, predicate: string): Term[] {
  const subject = doc.factory.namedNode(doc.value);
  const matches = tryRead(() => [...doc.dataset.match(subject, doc.factory.namedNode(predicate))]);
  return (matches ?? []).map(({ object }) => object);
}

/** The single stored object of a predicate, or undefined when it is absent or ambiguous. */
function soleObject(doc: TermWrapper, predicate: string): Term | undefined {
  const objects = storedObjects(doc, predicate);
  return objects.length === 1 ? objects[0] : undefined;
}

/** Lexically safe http(s) IRI: a real authority and no IRIREF-forbidden or control character. */
function isLexicalHttpIri(value: string): boolean {
  return (
    /^https?:\/\/[^/?#]/i.test(value) &&
    !/[\s<>"{}|\\^`]/.test(value) &&
    sanitizeText(value) === value // no remaining C0/C1 control character
  );
}

/** Retain the hardened read policy: first valid http(s) object, exact lexical identity.
 * Runtime IRI guards normalize and singleton cardinality drops ambiguous fields; neither
 * can implement this API's object-by-object recovery policy (sst-ild.7.9).
 */
export function httpObjects(doc: TermWrapper, predicate: string): string[] {
  const values = new Set<string>();
  for (const object of storedObjects(doc, predicate)) {
    if (object.termType !== "NamedNode" || !isLexicalHttpIri(object.value)) continue;
    if (httpIriOrUndefined(object.value) !== undefined) values.add(object.value);
  }
  return [...values];
}

/**
 * Direct-accessor fallback for a lone stored http(s) IRI that WHATWG URL cannot parse
 * (e.g. `http://a%zz/`). The generated guard drops it; the original wrapper returned it,
 * and consumers render it as inert text. Only the exact stored spelling of an
 * unambiguous, lexically safe http(s) IRI is returned, never a repaired value.
 */
export function unparseableHttpIri(doc: TermWrapper, predicate: string): string | undefined {
  const object = soleObject(doc, predicate);
  if (object?.termType !== "NamedNode" || !isLexicalHttpIri(object.value)) return undefined;
  return httpIriOrUndefined(object.value) === undefined ? object.value : undefined;
}

/**
 * Direct-accessor fallback for a lone literal that claims `xsd:dateTime` but that the
 * original wrapper also could not parse. The generated read drops it; the original
 * wrapper returned an Invalid Date, which consumers detect and reject. Absent, ambiguous or differently typed values still
 * read as `undefined`.
 */
export function malformedDate(doc: TermWrapper, predicate: string): Date | undefined {
  const object = soleObject(doc, predicate);
  if (object?.termType !== "Literal" || object.datatype.value !== xsd("dateTime")) return undefined;
  if (tryRead(() => readLiteral(object)) !== undefined) return undefined;
  // Only a value the original `new Date(lexical)` also could not parse becomes an Invalid
  // Date. A lenient non-XSD form it accepted (`2026-03-01`, `…T00:00Z`, a rolled-over
  // `2026-02-30`) stays dropped: surfacing it as Invalid Date would crash consumers that
  // displayed it before, and surfacing the parsed value would return a wrong instant.
  return Number.isNaN(Date.parse(object.value)) ? new Date(Number.NaN) : undefined;
}

/** Keep the original Store iteration and Turtle property order. */
export function orderTaskStore(store: Store): Store {
  const order = [
    rdf("type"),
    dct("title"),
    wf("description"),
    dct("description"),
    dct("created"),
    dct("modified"),
    prov("endedAtTime"),
    dct("creator"),
    wf("assignee"),
    wf("tracker"),
    dct("isPartOf"),
    dct("isReplacedBy"),
    prov("wasDerivedFrom"),
    wf("dateDue"),
    schema("priority"),
    schema("position"),
    dct("requires"),
    dct("relation"),
  ];
  return new Store(
    [...store].sort((a, b) => order.indexOf(a.predicate.value) - order.indexOf(b.predicate.value)),
  );
}

export function isAssignedTo(assignee: string | undefined, webId: string): boolean {
  return !!assignee && assignee.trim() === webId.trim();
}
export function sortTasks(tasks: readonly TaskData[]): TaskData[] {
  const rank: Record<TaskState, number> = { open: 0, closed: 1 };
  return [...tasks].sort(
    (a, b) =>
      rank[a.state] - rank[b.state] || (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0),
  );
}
