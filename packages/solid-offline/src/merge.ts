// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from '@jeswr/storage-client';

type Quad = Parameters<StorageClient['writeRdf']>[1] extends Iterable<infer Q> ? Q : never;

/**
 * Set merge: (remote − (base − local)) ∪ (local − base).
 * Preserves the original terms. Blank nodes compare by label; skolemise first
 * when labels are not stable between the three inputs. This is not a semantic
 * or functional-property conflict detector.
 */
export function mergeRdf(
  base: Iterable<Quad>,
  local: Iterable<Quad>,
  remote: Iterable<Quad>,
): Quad[] {
  const b = [...base];
  const l = [...local];
  const has = (quads: readonly Quad[], q: Quad) =>
    quads.some(
      (other) =>
        q.subject.equals(other.subject) &&
        q.predicate.equals(other.predicate) &&
        q.object.equals(other.object) &&
        q.graph.equals(other.graph),
    );
  const removed = b.filter((q) => !has(l, q));
  const result: Quad[] = [];
  for (const q of remote) {
    if (!has(removed, q) && !has(result, q)) result.push(q);
  }
  for (const q of l) {
    if (!has(b, q) && !has(result, q)) result.push(q);
  }
  return result;
}
