// AUTHORED-BY Codex (GPT-6.1 Sol)
import { subjectIri } from "@jeswr/model-runtime";
import type { Revision } from "./types.js";
/** The revision-entity IRI for a resource at index `n` (`<resource>#rev-<n>`). */
export function revisionSubject(resourceUrl: string, index: number | bigint): string {
  return subjectIri(resourceUrl, `rev-${index}`);
}

/**
 * Highest `rev-<n>` index among prior revisions that belong to THIS resource.
 * Revisions whose IRI doesn't match `<resource>#rev-<n>` (e.g. imported from
 * another resource) are ignored for indexing. Returns -1 when none match, so a
 * brand-new document's first revision is `rev-0`.
 */
function highestRevisionIndex(resourceUrl: string, revisions: readonly Revision[]): bigint {
  const prefix = `${resourceUrl}#rev-`;
  let max = BigInt(-1);
  for (const rev of revisions) {
    if (!rev.id.startsWith(prefix)) continue;
    const suffix = rev.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = BigInt(suffix);
    if (n > max) max = n;
  }
  return max;
}

/** Pure revision policy: snapshots remain current between durable history entries. */
export function applyRevisionPolicy(
  resourceUrl: string,
  prior: readonly Revision[],
  snapshot: {
    body: string;
    format: string;
    now: Date;
    attributedTo?: string | undefined;
    label?: string | undefined;
  },
): Revision[] {
  // Normalize repeated IDs and predecessor links before adding or pruning nodes.
  const revisions = [...new Map(prior.map((rev) => [rev.id, { ...rev }])).values()];
  const last = revisions[0];
  if (
    !last ||
    snapshot.label !== undefined ||
    (snapshot.now.getTime() - new Date(last.generatedAt).getTime() >= 600_000 &&
      (snapshot.body !== last.body || snapshot.format !== last.format))
  ) {
    revisions.unshift({
      id: revisionSubject(resourceUrl, highestRevisionIndex(resourceUrl, prior) + BigInt(1)),
      body: snapshot.body,
      format: snapshot.format,
      generatedAt: snapshot.now.toISOString(),
      attributedTo: snapshot.attributedTo,
      label: snapshot.label,
    });
  }
  const auto = revisions
    .filter((rev) => rev.label === undefined)
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  const pruned = new Set(auto.slice(100).map((rev) => rev.id));
  const kept = revisions.filter((rev) => !pruned.has(rev.id));
  for (let i = 0; i < kept.length; i++) {
    const rev = kept[i] as Revision;
    rev.wasRevisionOf = kept[i + 1]?.id;
  }
  return kept;
}
