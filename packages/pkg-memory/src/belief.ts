// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6

import type { DatasetCore } from "@rdfjs/types";
import { MAX_CLASSIFIED_NANOPUBLICATIONS, MAX_REPLACED_BY } from "./limits.js";
import type { Nanopublication, Nanopublications } from "./model.js";
import { NS, RdfNode } from "./rdf.js";
import { readNamedGraph as graph } from "./read-graph.js";

/** Consumer-facing belief levels from KG DESIGN §4.1. */
export type Belief = "definitely" | "might" | "mentioned" | "past";
/** A derived view; no belief triples are persisted into the nanopub. */
export interface ClassifiedNanopublication extends Nanopublication {
  belief: Belief;
  /** A later update could not be read; this claim must not be treated as definite. */
  affectedBySkipped?: true;
  corroboration: number;
  replacedBy: string[];
}
const past = new Set(["Superseded", "Historical", "Retracted"]);

/** Classify with graph-scoped provenance and cross-batch revision/contradiction links. */
export function classifyNanopublications(value: Nanopublications): ClassifiedNanopublication[] {
  const affected = new Set(value.affected);
  const nanopubs = [...new Map(value.nanopubs.map((np) => [np.id, np])).values()];
  if (nanopubs.length > MAX_CLASSIFIED_NANOPUBLICATIONS)
    throw new Error("Too many nanopublications");
  const byId = new Map(nanopubs.map((np) => [np.id, np]));
  const byAssertion = new Map<string, Nanopublication[]>();
  for (const np of nanopubs) {
    const copies = byAssertion.get(np.assertionId) ?? [];
    copies.push(np);
    byAssertion.set(np.assertionId, copies);
  }
  // Envelopes sharing an assertion and provenance graph read the same assertion-level
  // links, so those are handled once per group, and replacements by assertion
  // rather than by envelope pair: work is linear in envelopes plus links.
  interface Group {
    members: Nanopublication[];
    replacers: Nanopublication[];
    supersedes: string[];
    contradicts: string[];
    invalidated: boolean;
    live: boolean;
    smallest?: string[];
    conflict?: boolean;
  }
  const groups = new Map<string, Group>();
  const groupOf = new Map<string, Group>();
  const snapshots = new Map<string, DatasetCore>();
  const envelopeReplacers = new Map<string, Set<string>>();
  const inactive = new Set<string>();
  for (const np of nanopubs) {
    let provenance = snapshots.get(np.provenanceId);
    if (!provenance) {
      provenance = graph(value.dataset, np.provenanceId);
      snapshots.set(np.provenanceId, provenance);
    }
    const key = `${np.provenanceId}\n${np.assertionId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        members: [],
        replacers: [],
        supersedes: np.supersedes,
        contradicts: np.contradicts,
        invalidated:
          new RdfNode(np.assertionId, provenance).terms(`${NS.prov}invalidatedAtTime`).size > 0,
        live: false,
      };
      groups.set(key, group);
    }
    group.members.push(np);
    groupOf.set(np.id, group);
    const targets = [...new RdfNode(np.id, provenance).terms(`${NS.prov}wasRevisionOf`)].filter(
      (target) => target.termType === "NamedNode",
    );
    // Envelope targets take precedence over legacy assertion-wide revision links.
    if (targets.length > 0) {
      for (const target of targets) {
        if (target.value === np.id || !byId.has(target.value)) continue;
        const next = envelopeReplacers.get(target.value) ?? new Set<string>();
        next.add(np.id);
        envelopeReplacers.set(target.value, next);
      }
    } else group.replacers.push(np);
    if (past.has(np.validity) || group.invalidated) inactive.add(np.id);
  }
  for (const id of envelopeReplacers.keys()) inactive.add(id);
  // Assertion-wide links: target assertion -> the groups that replace it.
  const replacingGroups = new Map<string, Group[]>();
  for (const group of groups.values()) {
    if (group.replacers.length === 0) continue;
    for (const target of group.supersedes) {
      if (!byAssertion.has(target)) continue;
      const list = replacingGroups.get(target) ?? [];
      list.push(group);
      replacingGroups.set(target, list);
    }
  }
  const smallest = new Map<string, string[]>();
  for (const [assertionId, list] of replacingGroups) {
    const replacers = list.flatMap((group) => group.replacers.map((np) => np.id));
    const sole = replacers.length === 1 ? replacers[0] : undefined;
    // An envelope is replaced when some other envelope revises its assertion.
    for (const np of byAssertion.get(assertionId) as Nanopublication[])
      if (replacers.length > 1 || sole !== np.id) inactive.add(np.id);
    // One more than the list length, so dropping the envelope itself still leaves enough.
    const ids = list.flatMap((group) => {
      group.smallest ??= group.replacers
        .map((np) => np.id)
        .sort()
        .slice(0, MAX_REPLACED_BY + 1);
      return group.smallest;
    });
    smallest.set(assertionId, ids.sort().slice(0, MAX_REPLACED_BY + 1));
  }
  for (const np of nanopubs) {
    const group = groupOf.get(np.id) as Group;
    group.live ||= !inactive.has(np.id);
  }
  const liveAssertions = new Set(
    nanopubs.filter((np) => !inactive.has(np.id)).map((np) => np.assertionId),
  );
  const contradictedByLive = new Set<string>();
  for (const group of groups.values())
    if (group.live) for (const target of group.contradicts) contradictedByLive.add(target);
  return nanopubs.map((np) => {
    const group = groupOf.get(np.id) as Group;
    group.conflict ??=
      group.contradicts.some((target) => !byAssertion.has(target) || liveAssertions.has(target)) ||
      contradictedByLive.has(np.assertionId);
    const { conflict } = group;
    let belief: Belief;
    if (inactive.has(np.id)) belief = "past";
    else if (np.epistemic === "Mentioned") belief = "mentioned";
    else if (np.validity === "Contradicted") belief = "might";
    else if (np.epistemic === "Documented") belief = "definitely";
    else if (
      (np.epistemic === "SelfReportedExplicit" || np.epistemic === "DocumentedViaSummary") &&
      !conflict
    )
      belief = "definitely";
    else belief = "might";
    // A readable retraction or replacement is final, so past facts stay past. An
    // unreadable later update only lowers "definitely" to "might"; "might" and
    // "mentioned" keep their level but carry the marker.
    const uncertain = affected.has(np.id) && belief !== "past";
    if (uncertain && belief === "definitely") belief = "might";
    const replacedBy = new Set([
      ...(envelopeReplacers.get(np.id) ?? []),
      ...(smallest.get(np.assertionId) ?? []).filter((id) => id !== np.id),
    ]);
    return {
      ...np,
      belief,
      ...(uncertain ? { affectedBySkipped: true as const } : {}),
      corroboration: (byAssertion.get(np.assertionId) as Nanopublication[]).length,
      replacedBy: [...replacedBy].sort().slice(0, MAX_REPLACED_BY),
    };
  });
}
