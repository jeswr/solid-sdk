// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { safeIri } from "../vocab.js";

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Framework-owned slug for a remote item: `<prefix>/<first 32 hex chars of sha-256(id)>.ttl`.
 * Raw provider ids never reach a pod path.
 */
export async function syncItemSlug(prefix: string, remoteId: string): Promise<string> {
  if (typeof prefix !== "string" || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(prefix))
    throw new Error("Invalid sync item prefix.");
  if (typeof remoteId !== "string" || !remoteId || remoteId.length > 2048)
    throw new Error("Invalid sync remote identity.");
  return `${prefix.replace(/\/$/, "")}/${(await sha256(remoteId)).slice(0, 32)}.ttl`;
}

/** Enforce per-document bounds even on injected/custom ports, before copying anything. */
export function datasetBytes(dataset: DatasetCore): number {
  if (dataset.size > 10_000) throw new RangeError("Sync document quad cap exceeded.");
  let bytes = 0;
  let count = 0;
  const encoder = new TextEncoder();
  for (const q of dataset) {
    if (++count > 10_000) throw new RangeError("Sync document quad cap exceeded.");
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (!["NamedNode", "BlankNode", "Literal", "DefaultGraph"].includes(term.termType))
        throw new Error("Unsupported sync RDF term.");
      if (term.value.length > 65_536) throw new RangeError("Sync term cap exceeded.");
      bytes += encoder.encode(term.value).length;
      if (term.termType === "Literal") {
        if (term.datatype.termType !== "NamedNode") throw new Error("Unsupported sync RDF term.");
        if (term.language.length > 65_536 || term.datatype.value.length > 65_536)
          throw new RangeError("Sync term cap exceeded.");
        bytes += encoder.encode(term.language).length + encoder.encode(term.datatype.value).length;
      }
      if (bytes > 4 * 1024 * 1024) throw new RangeError("Sync document byte cap exceeded.");
    }
  }
  return bytes;
}

/** The subjects one sync item owns inside its document. */
export interface SyncItemScope {
  /** The document URL, plus its fragment IRIs or exactly the declared subjects. */
  readonly ownsSubject: (subject: string) => boolean;
  /** Blank nodes reached from the owned subjects' mapped quads (transitively). */
  readonly blanks: ReadonlySet<string>;
}

/**
 * An item's own subjects: the document URL and its fragment IRIs, or, when the adapter declares
 * its subjects, the document URL and exactly those; plus the blank-node closure reached from
 * those subjects' mapped quads. Quads about any other subject (such as a fragment the owner
 * added beside a declared item subject) are neither hashed nor replaced by an inbound merge.
 */
export function syncItemScope(
  dataset: DatasetCore,
  fields: readonly string[],
  documentUrl: string,
  declared?: readonly string[],
): SyncItemScope {
  if (
    declared !== undefined &&
    (!Array.isArray(declared) ||
      declared.length > 32 ||
      declared.some((s) => typeof s !== "string" || !safeIri(s)))
  )
    throw new RangeError("Declare at most 32 item subject IRIs.");
  const subjects = declared && new Set(declared);
  const ownsSubject = (subject: string) =>
    subject === documentUrl ||
    (subjects ? subjects.has(subject) : subject.startsWith(`${documentUrl}#`));
  const selected = new Set(fields);
  const blanks = new Set<string>();
  const queue: string[] = [];
  const reach = (term: Term) => {
    if (term.termType === "BlankNode" && !blanks.has(term.value)) {
      blanks.add(term.value);
      queue.push(term.value);
    }
  };
  // One pass: seed from owned mapped quads and index blank-subject edges for the closure.
  const edges = new Map<string, Term[]>();
  for (const q of dataset) {
    if (q.subject.termType === "BlankNode" && q.object.termType === "BlankNode") {
      const out = edges.get(q.subject.value);
      if (out) out.push(q.object);
      else edges.set(q.subject.value, [q.object]);
    }
    if (
      selected.has(q.predicate.value) &&
      q.subject.termType === "NamedNode" &&
      ownsSubject(q.subject.value)
    )
      reach(q.object);
  }
  while (queue.length) for (const next of edges.get(queue.pop() as string) ?? []) reach(next);
  return { ownsSubject, blanks };
}
/** Whether a quad's subject belongs to the item (a mapped quad of it is item data). */
export function inScope(scope: SyncItemScope, q: Quad): boolean {
  return q.subject.termType === "BlankNode"
    ? scope.blanks.has(q.subject.value)
    : q.subject.termType === "NamedNode" && scope.ownsSubject(q.subject.value);
}

/**
 * Exact canonical RDF projection, not a serialization hash. Terms retain datatype/language
 * and graph identity. Blank labels are minimized over all bijections, with a hard work cap;
 * complex graphs fail closed rather than using a collision-prone approximate graph hash.
 * Fields select predicates. With `documentUrl`, only the item's own subjects count (see
 * syncItemScope), and the document URL and its fragment IRIs hash relative to it, so a
 * resource moved to another URL keeps its hash; all other IRIs stay absolute. Without it the
 * whole dataset is selected.
 */
export async function canonicalHash(
  dataset: DatasetCore,
  fields: readonly string[],
  documentUrl?: string,
  declaredSubjects?: readonly string[],
): Promise<string> {
  datasetBytes(dataset);
  if (!fields.length || fields.length > 128 || fields.some((f) => !safeIri(f)))
    throw new RangeError("Declare 1–128 mapped field predicate IRIs.");
  const selected = new Set(fields);
  const scope =
    documentUrl === undefined
      ? undefined
      : syncItemScope(dataset, fields, documentUrl, declaredSubjects);
  const quads: Quad[] = [];
  const blanks = new Set<string>();
  for (const q of dataset) {
    if (!selected.has(q.predicate.value) || (scope && !inScope(scope, q))) continue;
    quads.push(q);
    for (const term of [q.subject, q.object, q.graph])
      if (term.termType === "BlankNode") blanks.add(term.value);
  }
  if (blanks.size > 7) throw new RangeError("Sync canonical blank-node cap exceeded.");
  const labels = [...blanks];
  let permutations = 1;
  for (let i = 2; i <= labels.length; i++) permutations *= i;
  const mapping = new Map<string, number>();
  const termKey = (term: Term): unknown => {
    switch (term.termType) {
      case "NamedNode":
        if (
          documentUrl !== undefined &&
          (term.value === documentUrl || term.value.startsWith(`${documentUrl}#`))
        )
          return ["rel", term.value.slice(documentUrl.length)];
        return ["iri", term.value];
      case "BlankNode":
        return ["blank", mapping.get(term.value)];
      case "Literal":
        return ["literal", term.value, term.language, term.datatype.value];
      case "DefaultGraph":
        return ["default"];
      default:
        throw new Error("Unsupported sync RDF term.");
    }
  };
  const encodeRows = () =>
    quads.map((q) =>
      JSON.stringify([
        termKey(q.subject),
        termKey(q.predicate),
        termKey(q.object),
        termKey(q.graph),
      ]),
    );
  // Sorting cannot change encoded size. Unassigned blank labels encode as null, which
  // conservatively exceeds the one-digit canonical labels. Include JSON escaping and UTF-8.
  const comparisonBytes = new TextEncoder().encode(JSON.stringify(encodeRows())).length;
  if (permutations * comparisonBytes > 32 * 1024 * 1024)
    throw new RangeError("Sync canonical byte-work cap exceeded.");
  let best: string | undefined;
  let work = 0;
  function visit(depth: number, used: Set<number>): void {
    if (depth === labels.length) {
      work += Math.max(1, quads.length);
      if (work > 100_000) throw new RangeError("Sync canonical work cap exceeded.");
      const rows = encodeRows().sort();
      const value = JSON.stringify(rows);
      if (best === undefined || value < best) best = value;
      return;
    }
    for (let i = 0; i < labels.length; i++) {
      if (used.has(i)) continue;
      mapping.set(labels[depth] as string, i);
      used.add(i);
      visit(depth + 1, used);
      used.delete(i);
    }
  }
  visit(0, new Set());
  return sha256(best as string);
}
