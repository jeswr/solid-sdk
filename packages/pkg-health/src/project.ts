// AUTHORED-BY Codex GPT-6.1-Sol

import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import {
  type ClassifiedNanopublication,
  classifyNanopublications,
  createNanopubProvenanceReader,
  type FactProvenance,
  type Nanopublications,
} from "@jeswr/pkg-memory";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { entities } from "./generated/model.js";
import { health, LABEL, RDF_TYPE, ReadNode, S } from "./read.js";
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
  note: entities.PropertyValue,
  document: entities.DigitalDocument,
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
      raw.text(
        "https://jeswr.org/ns/core#value",
        "https://w3id.org/jeswr/core#value",
        "http://www.w3.org/2004/02/skos/core#prefLabel",
        LABEL,
      ),
    system: iri ? codingSystem(iri) : "other",
  };
}
function base(
  provenance: FactProvenance,
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
    provenance,
  };
}
function project(
  base: HealthFactBase,
  kind: HealthFactKind,
  node: ReadNode,
): HealthFact | undefined {
  const result = { ...base, label: node.label ?? base.code?.value ?? humanise(kind) };
  const time = effectiveTime(node);
  switch (kind) {
    case "note": {
      const property = node.text(`${S}propertyID`);
      const value = node.text(`${S}value`);
      if (property === undefined || value === undefined) return undefined;
      return { ...result, kind, property, value, label: humanise(property) };
    }
    case "document":
      return {
        ...result,
        kind,
        name: result.label,
        dateCreated: node.literal(`${S}dateCreated`)?.value,
      };
    case "condition":
      return { ...result, kind, onset: base.period.start, abatement: base.period.end };
    case "allergy":
      return { ...result, kind, substance: node.label };
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
        label: node.label ?? product?.label ?? result.label,
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
        unit:
          observation.unitCode ??
          node.text(...health("unitCode")) ??
          observation.hasUnit ??
          node.link(...health("hasUnit"))?.value,
        interpretation: typeof value === "string" ? interpretation(value) : undefined,
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
    ids.set(`${q.subject.termType}:${q.subject.value}`, new ReadNode(q.subject, graph));
  }
  return [...ids.values()].sort((a, b) => a.value.localeCompare(b.value));
}
const observationModels = [
  entities.Observation,
  entities.VitalSign,
  entities.HeartRateObservation,
  entities.StepCountObservation,
  entities.SleepObservation,
];
function kinds(node: ReadNode): HealthFactKind[] {
  // Generated entity wrappers require named subjects. Legacy PropertyValue and
  // document blank nodes use the existing read-only compatibility view.
  if (node.term.termType === "BlankNode")
    return (["note", "document"] as const).filter((kind) =>
      node
        .terms(RDF_TYPE)
        .some((term) => term.termType === "NamedNode" && term.value === models[kind].typeIri),
    );
  return FACT_KINDS.filter((kind) =>
    (kind === "observation" ? observationModels : [models[kind]]).some(
      (model) => new model.Wrapper(node.term, node.dataset, df).isInstance,
    ),
  );
}
export function humanise(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** Ordered, whole-word display keywords. Never interpret negated/uncertain results. */
function interpretation(value: string): "normal" | "abnormal" | "high" | "low" | undefined {
  const text = value.toLowerCase().replace(/\([^)]*\)/g, "");
  if (/\b(not|no|possibly|possible|uncertain|unknown)\b/.test(text)) return undefined;
  if (/\b(high|elevated|raised)\b/.test(text)) return "high";
  if (/\b(low|decreased|reduced)\b/.test(text)) return "low";
  if (/\b(abnormal|positive)\b/.test(text)) return "abnormal";
  if (/\b(normal|negative|unremarkable)\b/.test(text)) return "normal";
  return undefined;
}
function linkedOwners(node: ReadNode, kind: HealthFactKind): import("@rdfjs/types").Term[] {
  if (kind !== "note" && kind !== "document") return [];
  return [
    ...(kind === "document" ? node.terms(`${S}about`) : []),
    ...[
      ...node.dataset.match(
        null,
        df.namedNode(`${S}${kind === "note" ? "additionalProperty" : "subjectOf"}`),
        node.term,
      ),
    ].map((q) => q.subject),
  ];
}
function foreign(node: ReadNode, owner: string): boolean {
  // A health category or one owner link never overrides another subject.
  const links = [...node.owners, ...kinds(node).flatMap((kind) => linkedOwners(node, kind))];
  return links.some((term) => term.termType !== "NamedNode" || term.value !== owner);
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
        note: [],
        document: [],
      },
      unrecognised: [],
      sources: [],
      excludedOtherSubjects: 0,
    };
    const provenance = createNanopubProvenanceReader(value);
    const assertions = new Map<string, Store>();
    for (const np of classifyNanopublications(value)) {
      const category = np.categories.some((c) => categories.has(c));
      let graph = assertions.get(np.assertionId);
      if (!graph) {
        graph = new Store([...value.dataset.match(null, null, null, df.namedNode(np.assertionId))]);
        assertions.set(np.assertionId, graph);
      }
      const nodes = subjectNodes(graph);
      const supporting = nodes.filter(
        (n) =>
          n.term.termType === "NamedNode" &&
          (new entities.MedicinalProduct.Wrapper(n.term, graph, df).isInstance ||
            new entities.CodeableConcept.Wrapper(n.term, graph, df).isInstance),
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
          const linked = linkedOwners(node, kind);
          if (foreign(node, options.owner)) {
            excluded = true;
            continue;
          }
          if (
            (kind === "note" || kind === "document") &&
            !linked.some((t) => t.value === options.owner)
          )
            continue;
          if (
            !category &&
            kind !== "document" &&
            !node.owners.some((t) => t.value === options.owner)
          )
            continue;
          recognised = true;
          const metadata = base(provenance(np), np, node);
          const fact = project(metadata, kind, node);
          if (fact) {
            view.facts.push(fact);
            view.byKind[kind].push(fact);
          } else view.unrecognised.push(metadata);
        }
      }
      if (qualifies && !recognised) {
        // Explicit foreign subjects exclude the category fallback too. Never recover their labels.
        const candidates = nodes.filter(
          (node) => !kinds(node).some((kind) => kind === "note" || kind === "document"),
        );
        const owned = candidates.filter((n) => n.owners.length && !foreign(n, options.owner));
        const other = nodes.some((n) => foreign(n, options.owner));
        if (other) excluded = true;
        if (!other || owned.length) {
          const node =
            owned[0] ??
            candidates.find((n) => n.label) ??
            candidates.find((n) => n.terms(RDF_TYPE).length) ??
            candidates[0];
          if (node) view.unrecognised.push(base(provenance(np), np, node));
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
