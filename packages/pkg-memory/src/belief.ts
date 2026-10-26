// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import type { Nanopublication, Nanopublications } from "./model.js";
import { graph, NS, RdfNode } from "./rdf.js";

/** Consumer-facing belief levels from KG DESIGN §4.1. */
export type Belief = "definitely" | "might" | "mentioned" | "past";
/** A derived view; no belief triples are persisted into the nanopub. */
export interface ClassifiedNanopublication extends Nanopublication {
  belief: Belief;
  corroboration: number;
  replacedBy: string[];
}
const past = new Set(["Superseded", "Historical", "Retracted"]);

/** Classify with graph-scoped provenance and cross-batch revision/contradiction links. */
export function classifyNanopublications(value: Nanopublications): ClassifiedNanopublication[] {
  const nanopubs = [...new Map(value.nanopubs.map((np) => [np.id, np])).values()];
  const byId = new Map(nanopubs.map((np) => [np.id, np]));
  const byAssertion = new Map<string, Nanopublication[]>();
  for (const np of nanopubs) {
    const copies = byAssertion.get(np.assertionId) ?? [];
    copies.push(np);
    byAssertion.set(np.assertionId, copies);
  }
  const replacements = new Map<string, Set<string>>();
  const inactive = new Set<string>();
  for (const np of nanopubs) {
    const provenance = graph(value.dataset, np.provenanceId);
    const targets = new RdfNode(np.id, provenance).terms(`${NS.prov}wasRevisionOf`);
    // Envelope targets take precedence over legacy assertion-wide revision links.
    const previous =
      targets.size > 0
        ? [...targets].flatMap((target) => byId.get(target.value) ?? [])
        : np.supersedes.flatMap((target) => byAssertion.get(target) ?? []);
    for (const other of previous) {
      if (other.id === np.id) continue;
      const next = replacements.get(other.id) ?? new Set<string>();
      next.add(np.id);
      replacements.set(other.id, next);
    }
    if (
      past.has(np.validity) ||
      new RdfNode(np.assertionId, provenance).terms(`${NS.prov}invalidatedAtTime`).size > 0
    )
      inactive.add(np.id);
  }
  for (const id of replacements.keys()) inactive.add(id);
  const liveAssertions = new Set(
    nanopubs.filter((np) => !inactive.has(np.id)).map((np) => np.assertionId),
  );
  const contradictedByLive = new Set<string>();
  for (const np of nanopubs)
    if (!inactive.has(np.id)) for (const target of np.contradicts) contradictedByLive.add(target);
  return nanopubs.map((np) => {
    const conflict =
      np.contradicts.some((target) => !byAssertion.has(target) || liveAssertions.has(target)) ||
      contradictedByLive.has(np.assertionId);
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
    return {
      ...np,
      belief,
      corroboration: (byAssertion.get(np.assertionId) as Nanopublication[]).length,
      replacedBy: [...(replacements.get(np.id) ?? [])].sort(),
    };
  });
}
