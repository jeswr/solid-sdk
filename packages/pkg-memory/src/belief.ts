// AUTHORED-BY Codex GPT-6.1-Sol

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
  const replacements = (np: Nanopublication) =>
    nanopubs.filter(
      // Explicit revision links order statements; extraction clocks do not.
      (other) => other.id !== np.id && other.supersedes.includes(np.assertionId),
    );
  const inactive = (np: Nanopublication) =>
    past.has(np.validity) ||
    replacements(np).length > 0 ||
    new RdfNode(np.assertionId, graph(value.dataset, np.provenanceId)).terms(
      `${NS.prov}invalidatedAtTime`,
    ).size > 0;
  return nanopubs.map((np) => {
    const conflict =
      np.contradicts.some((target) => {
        const others = nanopubs.filter((other) => other.assertionId === target);
        return others.length === 0 || others.some((other) => !inactive(other));
      }) ||
      nanopubs.some((other) => !inactive(other) && other.contradicts.includes(np.assertionId));
    let belief: Belief;
    if (inactive(np)) belief = "past";
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
      corroboration: nanopubs.filter((other) => other.assertionId === np.assertionId).length,
      replacedBy: replacements(np)
        .map((other) => other.id)
        .sort(),
    };
  });
}
