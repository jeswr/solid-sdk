// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { DataFactory as df, type Store, termToId } from "n3";

type Pattern = [Term | null, Term | null, Term | null, Term | null];
interface Contents {
  quads: Quad[];
  subjects: Map<string, Quad[]>;
  objects: Map<string, Quad[]>;
}
// N3 accepts external RDF/JS terms; @types/n3 narrows this helper to N3 terms.
const termKey = termToId as (term: Term) => string;
function index(map: Map<string, Quad[]>, term: Term, quad: Quad): void {
  const key = termKey(term);
  let values = map.get(key);
  if (!values) {
    values = [];
    map.set(key, values);
  }
  values.push(quad);
}

/** Read-only matches over one compact graph snapshot, without N3 index copies. */
class ReadView implements DatasetCore {
  constructor(
    private readonly contents: Contents,
    private readonly pattern: Pattern,
    private readonly empty = false,
  ) {}

  get size(): number {
    let size = 0;
    for (const _quad of this) size++;
    return size;
  }
  *[Symbol.iterator](): IterableIterator<Quad> {
    if (this.empty) return;
    const [s, p, o] = this.pattern;
    // Subject, then object, lookups are indexed; only predicate-only scans walk the graph.
    const candidates = s
      ? (this.contents.subjects.get(termKey(s)) ?? [])
      : o
        ? (this.contents.objects.get(termKey(o)) ?? [])
        : this.contents.quads;
    for (const q of candidates)
      if ((!p || p.equals(q.predicate)) && (!o || o.equals(q.object))) yield q;
  }
  match(
    subject?: Term | null,
    predicate?: Term | null,
    object?: Term | null,
    graph?: Term | null,
  ): DatasetCore {
    const requested = [subject, predicate, object, graph];
    let empty = this.empty;
    const pattern = this.pattern.map((term, i) => {
      const next = requested[i];
      if (term && next && !term.equals(next)) empty = true;
      return term ?? next ?? null;
    }) as Pattern;
    return new ReadView(this.contents, pattern, empty);
  }
  has(quad: Quad): boolean {
    return this.match(quad.subject, quad.predicate, quad.object, quad.graph).size > 0;
  }
  add(_quad: Quad): this {
    throw new Error("Read-only graph view");
  }
  delete(_quad: Quad): this {
    throw new Error("Read-only graph view");
  }
}

/** Read-only graph snapshot with shared subject and object indexes. Quads keep their graph names. */
export function readNamedGraph(dataset: Store, name: string): DatasetCore {
  const graph = df.namedNode(name);
  const quads = [...dataset.match(null, null, null, graph)];
  const subjects = new Map<string, Quad[]>();
  const objects = new Map<string, Quad[]>();
  for (const q of quads) {
    index(subjects, q.subject, q);
    index(objects, q.object, q);
  }
  return new ReadView({ quads, subjects, objects }, [null, null, null, graph]);
}
