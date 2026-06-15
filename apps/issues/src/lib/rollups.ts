// AUTHORED-BY Claude Opus 4.8
import type { IssueRecord } from "./repository";

/**
 * Rolled-up totals over an issue's subtree (descendants via `dct:isPartOf`,
 * Monday/Jira subitems). All figures are *derived* — nothing new is written to
 * the pod; the parent/child edge is the stored `dct:isPartOf` link.
 */
export interface Rollup {
  /** Direct children only (one level down). */
  childCount: number;
  /** Every descendant (transitive), the subtree excluding the issue itself. */
  descendantCount: number;
  /** Descendants whose status is "done". */
  done: number;
  /** Total descendants counted toward completion (= descendantCount). */
  total: number;
  /** 0–100 completion across all descendants (0 when there are none). */
  percent: number;
  /** Sum of descendant story-point estimates (own estimate excluded). */
  estimate: number;
  /** Earliest due date across the issue + its descendants, if any. */
  earliestDue?: Date;
  /** Latest due date across the issue + its descendants, if any. */
  latestDue?: Date;
}

const EMPTY_ROLLUP: Rollup = {
  childCount: 0,
  descendantCount: 0,
  done: 0,
  total: 0,
  percent: 0,
  estimate: 0,
};

/** Build a parent → direct-children index (by URL). */
function childIndex(issues: IssueRecord[]): Map<string, IssueRecord[]> {
  const byParent = new Map<string, IssueRecord[]>();
  for (const i of issues) {
    if (!i.parent) continue;
    const list = byParent.get(i.parent);
    if (list) list.push(i);
    else byParent.set(i.parent, [i]);
  }
  return byParent;
}

/**
 * Walk the subtree rooted at `url`, visiting each descendant exactly once.
 * Cycle-safe: a `seen` set short-circuits a child that points (directly or via a
 * loop) back to an ancestor, so malformed pod data (A⊂B⊂A) can never recurse
 * forever. The root itself is never counted as its own descendant.
 */
function descendantsOf(
  url: string,
  byParent: Map<string, IssueRecord[]>,
  seen: Set<string>,
): IssueRecord[] {
  const out: IssueRecord[] = [];
  for (const child of byParent.get(url) ?? []) {
    if (seen.has(child.url)) continue; // cycle / already-counted guard
    seen.add(child.url);
    out.push(child);
    out.push(...descendantsOf(child.url, byParent, seen));
  }
  return out;
}

/**
 * Roll up completion / estimate / due-date totals for one issue over its whole
 * subtree (transitive `dct:isPartOf` children). Cycle-safe. Returns the empty
 * rollup for a leaf with no children.
 *
 * `byParent` may be precomputed (via {@link rollupAll}) to avoid rebuilding the
 * index per call when rolling up many issues.
 */
export function rollupOf(
  issue: IssueRecord,
  issues: IssueRecord[],
  byParent: Map<string, IssueRecord[]> = childIndex(issues),
): Rollup {
  // Seed `seen` with the root so a child cycling straight back to it is ignored.
  const descendants = descendantsOf(issue.url, byParent, new Set([issue.url]));
  if (descendants.length === 0) {
    // A leaf still surfaces its own due date so callers can fold it uniformly.
    return issue.dateDue ? { ...EMPTY_ROLLUP, earliestDue: issue.dateDue, latestDue: issue.dateDue } : EMPTY_ROLLUP;
  }

  const done = descendants.filter((d) => d.status === "done").length;
  const total = descendants.length;
  const estimate = descendants.reduce((sum, d) => sum + (d.estimate ?? 0), 0);

  const dues = [issue, ...descendants]
    .map((d) => d.dateDue)
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());

  return {
    childCount: (byParent.get(issue.url) ?? []).length,
    descendantCount: total,
    done,
    total,
    percent: Math.round((done / total) * 100),
    estimate,
    earliestDue: dues.length ? new Date(Math.min(...dues)) : undefined,
    latestDue: dues.length ? new Date(Math.max(...dues)) : undefined,
  };
}

/** Roll up every issue at once, keyed by URL (shares one child index). */
export function rollupAll(issues: IssueRecord[]): Map<string, Rollup> {
  const byParent = childIndex(issues);
  const out = new Map<string, Rollup>();
  for (const i of issues) out.set(i.url, rollupOf(i, issues, byParent));
  return out;
}

/** Direct children (one level down) of an issue, via `dct:isPartOf`. */
export function directChildren(issue: IssueRecord, issues: IssueRecord[]): IssueRecord[] {
  return issues.filter((i) => i.parent === issue.url && i.url !== issue.url);
}

/**
 * The bidirectional issue↔issue links for display (F2). Each list pairs a
 * stored outgoing link with its derived inverse so a peer sees the reverse:
 *
 * - `relates` — symmetric `dct:relation` (union of this issue's links and any
 *   peer that links back to it).
 * - `blocks` / `blockedBy` — `dct:requires` (this requires X ⇒ X blocks this).
 * - `duplicateOf` / `duplicatedBy` — `dct:isReplacedBy` (supersession).
 * - `clonedFrom` / `clones` — `prov:wasDerivedFrom`.
 */
export interface IssueLinks {
  relates: string[];
  blocks: string[];
  blockedBy: string[];
  duplicateOf?: string;
  duplicatedBy: string[];
  clonedFrom?: string;
  clones: string[];
}

export function linksOf(issue: IssueRecord, issues: IssueRecord[]): IssueLinks {
  const others = issues.filter((i) => i.url !== issue.url);
  // `dct:relation` is symmetric: surface the union of our links and any peer's
  // link back to us, deduplicated.
  const relates = new Set<string>(issue.relatesTo);
  for (const o of others) if (o.relatesTo.includes(issue.url)) relates.add(o.url);

  return {
    relates: [...relates],
    blocks: others.filter((o) => o.blockedBy.includes(issue.url)).map((o) => o.url),
    blockedBy: [...issue.blockedBy],
    duplicateOf: issue.duplicateOf,
    duplicatedBy: others.filter((o) => o.duplicateOf === issue.url).map((o) => o.url),
    clonedFrom: issue.clonedFrom,
    clones: others.filter((o) => o.clonedFrom === issue.url).map((o) => o.url),
  };
}
