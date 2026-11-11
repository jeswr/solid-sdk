// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Compatibility policies that cannot be expressed by the generated SHACL projection. */
import { tryRead } from "@jeswr/model-runtime";
import type { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import type { TaskData, TaskPriority, TaskState } from "./task-types.js";
import { dct, prov, rdf, schema, wf } from "./vocab.js";

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

/** Retain the hardened read policy: first valid http(s) object, exact lexical identity.
 * Runtime IRI guards normalize and singleton cardinality drops ambiguous fields; neither
 * can implement this API's object-by-object recovery policy (sst-ild.7.9).
 */
export function httpObjects(doc: TermWrapper, predicate: string): string[] {
  const matches = tryRead(() => [
    ...doc.dataset.match(doc.factory.namedNode(doc.value), doc.factory.namedNode(predicate)),
  ]);
  const values = new Set<string>();
  for (const { object } of matches ?? []) {
    if (object.termType !== "NamedNode") continue;
    const value = object.value;
    if (!/^https?:\/\//i.test(value) || /[\s<>"{}|\\^`]/.test(value)) continue;
    if (httpIriOrUndefined(value) !== undefined) values.add(value);
  }
  return [...values];
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
