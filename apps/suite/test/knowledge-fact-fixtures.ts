// AUTHORED-BY Claude Sonnet 5.5
import type { HealthFact, HealthGraphView } from "@jeswr/pkg-health";

/** Fictional facts built directly in the projected shape, for view-level tests. */
export function condition(n: number, extra: Partial<HealthFact> = {}): HealthFact {
  return {
    id: `urn:uuid:fictional-${n}`,
    assertionId: `urn:uuid:fictional-assertion-${n}`,
    subject: `https://example.org/fictional/conditions#c${n}`,
    kind: "condition",
    label: `Fictional condition ${n}`,
    period: {},
    belief: "definitely",
    validity: "Current",
    epistemic: "SelfReportedExplicit",
    categories: [],
    replacedBy: [],
    corroboration: 1,
    provenance: {
      batch: "fictional-batch",
      generatedAt: "2026-01-01T00:00:00Z",
      agent: { iri: "https://example.org/fictional/agent" },
      attributedTo: [],
      sources: [],
      evidence: [],
    },
    ...extra,
  } as HealthFact;
}
export function viewOf(facts: HealthFact[]): HealthGraphView {
  const byKind = {
    condition: [],
    allergy: [],
    medication: [],
    observation: [],
    immunization: [],
    encounter: [],
    note: [],
    document: [],
  } as unknown as HealthGraphView["byKind"];
  for (const fact of facts) (byKind[fact.kind as keyof typeof byKind] as HealthFact[]).push(fact);
  return { facts, byKind, unrecognised: [], sources: [], excludedOtherSubjects: 0 };
}
