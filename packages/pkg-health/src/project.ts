// AUTHORED-BY Codex GPT-6.1-Sol

import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import {
  type ClassifiedNanopublication,
  classifyNanopublications,
  type Nanopublications,
  readNanopubProvenance,
} from "@jeswr/pkg-memory";
import type { DatasetCore } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { entities } from "./generated/model.js";
import { health, RDF_TYPE, ReadNode } from "./read.js";
import { effectiveTime, readPeriod } from "./temporal.js";
import {
  type HealthCode,
  type HealthFact,
  type HealthFactBase,
  type HealthFactKind,
  HealthGraphError,
  type HealthGraphView,
} from "./types.js";

/** Explicit health-related subset of pkg-memory's special-category inventory. */
export const HEALTH_CATEGORIES: readonly string[] = Object.freeze(
  [
    "MedicalHealth",
    "BloodType",
    "Disability",
    "DNACode",
    "DrugTestResult",
    "Health",
    "PhysicalHealth",
    "HealthHistory",
    "FamilyHealthHistory",
    "IndividualHealthHistory",
    "HealthRecord",
    "Prescription",
    "Genetic",
    "MentalHealth",
  ].map((name) => `https://w3id.org/dpv/pd#${name}`),
);
const categories = new Set(HEALTH_CATEGORIES);
const models = {
  condition: entities.Condition,
  allergy: entities.AllergyIntolerance,
  medication: entities.MedicationStatement,
  observation: entities.Observation,
  immunization: entities.Immunization,
  encounter: entities.Encounter,
};
export const FACT_KINDS = Object.freeze(Object.keys(models) as HealthFactKind[]);

function codingSystem(iri: string): HealthCode["system"] {
  if (/^https?:\/\/snomed\.info\/id\//.test(iri)) return "snomed";
  if (/^https?:\/\/loinc\.org\//.test(iri)) return "loinc";
  if (/^https?:\/\/(?:id\.who\.int\/icd|purl\.bioontology\.org\/ontology\/ICD10)/i.test(iri))
    return "icd10";
  if (/^https?:\/\/(?:www\.)?(?:whocc\.no\/atc|purl\.bioontology\.org\/ontology\/ATC)/i.test(iri))
    return "atc";
  if (/^https?:\/\/(?:[^/]+\.)?dmd\.nhs\.uk\//i.test(iri)) return "dmd";
  return "other";
}
function readCode(node: ReadNode): HealthCode | undefined {
  const target = node.link(...health("hasCode"));
  if (!target) return undefined;
  const raw = new ReadNode(target, node.dataset);
  const code =
    target.termType === "NamedNode"
      ? new entities.CodeableConcept.Wrapper(target, node.dataset, df)
      : undefined;
  const iri =
    code?.exactMatch ??
    raw.link("http://www.w3.org/2004/02/skos/core#exactMatch")?.value ??
    (target.termType === "NamedNode" ? target.value : undefined);
  return {
    iri,
    value:
      code?.codeValue ??
      raw.text("https://jeswr.org/ns/core#value", "https://w3id.org/jeswr/core#value"),
    system: iri ? codingSystem(iri) : "other",
  };
}
function base(
  value: Nanopublications,
  np: ClassifiedNanopublication,
  node: ReadNode,
): HealthFactBase {
  return {
    id: np.id,
    assertionId: np.assertionId,
    subject: node.value,
    kind: "unrecognised",
    label: node.label ?? "Health fact",
    code: readCode(node),
    period: readPeriod(node),
    belief: np.belief,
    validity: np.validity,
    epistemic: np.epistemic,
    hedge: np.hedge,
    categories: [...np.categories],
    replacedBy: [...np.replacedBy],
    corroboration: np.corroboration,
    provenance: readNanopubProvenance(value, np),
  };
}
function project(
  base: HealthFactBase,
  kind: HealthFactKind,
  node: ReadNode,
): HealthFact | undefined {
  const generated = new models[kind].Wrapper(node.term, node.dataset, df);
  const result = { ...base, label: generated.name ?? node.label ?? "Health fact" };
  const time = effectiveTime(node);
  switch (kind) {
    case "condition":
      return { ...result, kind, onset: base.period.start, abatement: base.period.end };
    case "allergy":
      return { ...result, kind, substance: generated.name ?? node.label };
    case "medication": {
      const product = node.child(...health("medication"));
      const name =
        product?.term.termType === "NamedNode"
          ? new entities.MedicinalProduct.Wrapper(product.term, node.dataset, df).name
          : product?.label;
      const atcCode = product?.atcCode;
      return {
        ...result,
        kind,
        label: generated.name ?? product?.label ?? result.label,
        product: { name: name ?? product?.label ?? "Medication", atcCode },
        dose: node.dose,
        code: base.code ?? (atcCode ? { value: atcCode, system: "atc" } : undefined),
      };
    }
    case "observation": {
      const value = node.observationValue;
      if (value === undefined) return undefined;
      const observation = new entities.Observation.Wrapper(node.term, node.dataset, df);
      return {
        ...result,
        kind,
        value,
        unit: observation.unitCode ?? observation.hasUnit,
        effectiveTime: time.value,
        effectiveTimeMs: time.time,
      };
    }
    case "immunization":
      return {
        ...result,
        kind,
        product: node.child(...health("medication"))?.label,
        date: time.value ?? base.period.start,
      };
    case "encounter":
      return {
        ...result,
        kind,
        date: time.value ?? base.period.start,
        recordedBy: new entities.Encounter.Wrapper(node.term, node.dataset, df).recordedBy,
      };
  }
}
function subjectNodes(graph: DatasetCore): ReadNode[] {
  const ids = new Map<string, ReadNode>();
  for (const q of graph) {
    if (q.subject.termType === "NamedNode")
      ids.set(q.subject.value, new ReadNode(q.subject, graph));
  }
  return [...ids.values()].sort((a, b) => a.value.localeCompare(b.value));
}
function kinds(node: ReadNode): HealthFactKind[] {
  return FACT_KINDS.filter(
    (kind) => new models[kind].Wrapper(node.term, node.dataset, df).isInstance,
  );
}
function foreign(node: ReadNode, owner: string): boolean {
  // An owner link beside any other/malformed subject does not authorize disclosure.
  return node.owners.some((term) => term.termType !== "NamedNode" || term.value !== owner);
}
/** Local, read-only projection. Apply purpose policy before supplying data to a consumer. */
export function projectHealthFacts(
  value: Nanopublications,
  options: { owner: string; now?: string },
): HealthGraphView {
  try {
    if (!isSafeAbsoluteIri(options.owner) || !/^https?:/.test(options.owner))
      throw new HealthGraphError("invalid-input");
    const view: HealthGraphView = {
      facts: [],
      byKind: {
        condition: [],
        allergy: [],
        medication: [],
        observation: [],
        immunization: [],
        encounter: [],
      },
      unrecognised: [],
      sources: [],
      excludedOtherSubjects: 0,
    };
    for (const np of classifyNanopublications(value)) {
      const category = np.categories.some((c) => categories.has(c));
      const graph = new Store([
        ...new NamedGraphDataset(df.namedNode(np.assertionId), value.dataset, df),
      ]);
      const nodes = subjectNodes(graph);
      const supporting = nodes.filter(
        (n) =>
          new entities.MedicinalProduct.Wrapper(n.term, graph, df).isInstance ||
          new entities.CodeableConcept.Wrapper(n.term, graph, df).isInstance,
      );
      const qualifies =
        category ||
        supporting.some(
          (n) => !foreign(n, options.owner) && n.owners.some((t) => t.value === options.owner),
        );
      let excluded = supporting.some((n) => foreign(n, options.owner)),
        recognised = false;
      for (const node of nodes) {
        for (const kind of kinds(node)) {
          if (foreign(node, options.owner)) {
            excluded = true;
            continue;
          }
          if (!category && !node.owners.some((t) => t.value === options.owner)) continue;
          recognised = true;
          const metadata = base(value, np, node);
          const fact = project(metadata, kind, node);
          if (fact) {
            view.facts.push(fact);
            view.byKind[kind].push(fact);
          } else view.unrecognised.push(metadata);
        }
      }
      if (qualifies && !recognised) {
        // Explicit foreign subjects exclude the category fallback too. Never recover their labels.
        const owned = nodes.filter((n) => n.owners.length && !foreign(n, options.owner));
        const other = nodes.some((n) => foreign(n, options.owner));
        if (other) excluded = true;
        if (!other || owned.length) {
          const node =
            owned[0] ??
            nodes.find((n) => n.label) ??
            nodes.find((n) => n.terms(RDF_TYPE).length) ??
            nodes[0];
          if (node) view.unrecognised.push(base(value, np, node));
        }
      }
      if (excluded) view.excludedOtherSubjects += 1;
    }
    const sources = new Map(
      [...view.facts, ...view.unrecognised].flatMap((f) =>
        f.provenance.sources.map((s) => [s.iri, s] as const),
      ),
    );
    view.sources = [...sources.values()].sort((a, b) => a.iri.localeCompare(b.iri));
    return view;
  } catch (error) {
    if (error instanceof HealthGraphError) throw error;
    throw new HealthGraphError("read-failed");
  }
}
