// AUTHORED-BY Codex GPT-6
/** Cross-graph read indexes. Native Store still owns every quad and all writes.
 * Indexes contain lexical RDF term IDs, never protocol values or validation results.
 */
import type { Term } from "@jeswr/fetch-rdf";
import { DataFactory, Store, termFromId, termToId } from "n3";

type Index = Map<string, Map<string, string[]>>;
const id = (term: Term) => termToId(term as never);
function append(index: Index, first: string, second: string, value: string): void {
  let bucket = index.get(first);
  if (!bucket) {
    bucket = new Map();
    index.set(first, bucket);
  }
  const values = bucket.get(second);
  if (values) values.push(value);
  else bucket.set(second, [value]);
}

export class IndexedStore extends Store {
  private reads = 0;
  private indexes?: { objects: Index; subjects: Index };

  override addQuad(
    ...args: [import("@jeswr/fetch-rdf").Quad] | [Term, Term, Term, Term?, (() => void)?]
  ): boolean {
    this.indexes = undefined;
    this.reads = 0;
    return args.length === 1
      ? super.addQuad(args[0] as never)
      : super.addQuad(
          args[0] as never,
          args[1] as never,
          args[2] as never,
          args[3] as never,
          args[4],
        );
  }
  override removeQuad(
    ...args: [import("@jeswr/fetch-rdf").Quad] | [Term, Term, Term, Term?, (() => void)?]
  ): boolean {
    this.indexes = undefined;
    this.reads = 0;
    return args.length === 1
      ? super.removeQuad(args[0] as never)
      : super.removeQuad(
          args[0] as never,
          args[1] as never,
          args[2] as never,
          args[3] as never,
          args[4],
        );
  }
  private index(): typeof this.indexes {
    // Avoid rebuilding while a model is still under construction. Stable graphs
    // pay one linear pass, then each field read touches only its own bucket.
    if (!this.indexes && ++this.reads >= 8) {
      const objects: Index = new Map(),
        subjects: Index = new Map();
      for (const quad of this) {
        append(objects, id(quad.subject), quad.predicate.value, id(quad.object));
        append(subjects, quad.predicate.value, id(quad.object), id(quad.subject));
      }
      this.indexes = { objects, subjects };
    }
    return this.indexes;
  }
  objects(subject: Term, predicate: string): Term[] {
    const index = this.index();
    return index
      ? (index.objects.get(id(subject))?.get(predicate) ?? []).map((value) =>
          termFromId(value, DataFactory),
        )
      : super.getQuads(subject, predicate, null, null).map((quad) => quad.object);
  }
  subjects(predicate: string, object: Term): Term[] {
    const index = this.index();
    return index
      ? [...new Set(index.subjects.get(predicate)?.get(id(object)) ?? [])].map((value) =>
          termFromId(value, DataFactory),
        )
      : super.getSubjects(predicate, object, null);
  }
  containsObject(subject: Term, predicate: string, object: Term): boolean {
    const index = this.index();
    return index
      ? (index.objects.get(id(subject))?.get(predicate) ?? []).includes(id(object))
      : super.countQuads(subject, predicate, object, null) > 0;
  }
}

export function objectsAt(dataset: Store, subject: Term, predicate: string): Term[] {
  return dataset instanceof IndexedStore
    ? dataset.objects(subject, predicate)
    : dataset.getQuads(subject, predicate, null, null).map((quad) => quad.object);
}
export function subjectsAt(dataset: Store, predicate: string, object: Term): Term[] {
  return dataset instanceof IndexedStore
    ? dataset.subjects(predicate, object)
    : dataset.getSubjects(predicate, object, null);
}
export function containsObject(
  dataset: Store,
  subject: Term,
  predicate: string,
  object: Term,
): boolean {
  return dataset instanceof IndexedStore
    ? dataset.containsObject(subject, predicate, object)
    : dataset.countQuads(subject, predicate, object, null) > 0;
}
