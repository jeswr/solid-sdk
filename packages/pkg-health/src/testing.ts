// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildNanopublications,
  type Claim,
  createFactAssertion,
  type Fact,
  type Nanopublications,
  type Source,
} from "@jeswr/pkg-memory";
import type { DatasetCore } from "@rdfjs/types";
import type { Store } from "n3";
import { entities } from "./generated/model.js";
import { HealthGraphError } from "./types.js";

const owner = "https://example.org/people/avery#me";
const iri = (slug: string) => `https://example.org/health/${slug}`;

/** Fictional, local demo. Stable RDF/IDs for a fixed now; no random or network input. */
export async function exampleHealthKnowledge(
  options: { now?: string } = {},
): Promise<Nanopublications> {
  const now = options.now ?? "2026-11-01T12:00:00Z";
  if (!Number.isFinite(Date.parse(now))) throw new HealthGraphError("invalid-input");
  const clock = new Date(now).toISOString();
  const at = (days: number) => new Date(Date.parse(clock) - days * 86400000).toISOString();
  const date = (days: number) => ({ value: at(days).slice(0, 10), datatype: "date" as const });
  const sources: Source[] = [
    ...[
      "An eighteen month health review",
      "Vitamin follow-up",
      "Exercise and resting pulse",
      "Allergies and medicines",
    ].map((title, i) => ({
      id: `codex-${i}`,
      kind: "codex-thread" as const,
      thread_id: `11111111-1111-4111-8111-11111111111${i}`,
      title: `Fictional: ${title}`,
      model: "fictional-codex-model",
      created: at([548, 400, 182, 30][i] as number),
    })),
    {
      id: "claude",
      kind: "claude-session",
      thread_id: "22222222-2222-4222-8222-222222222222",
      title: "Fictional: balance and sleep journal",
      model: "fictional-claude-model",
      created: at(90),
    },
  ];
  const claims: Claim[] = [];
  const add = (id: string, assertion: DatasetCore, days: number, extra: Partial<Claim> = {}) => {
    const available = sources.filter(
      (source) => Date.parse(source.created as string) <= Date.parse(at(days)),
    );
    const source = available[claims.length % available.length] as Source;
    claims.push({
      id,
      assertion,
      epistemic: "SelfReportedExplicit",
      categories: ["pd:MedicalHealth"],
      evidence: [
        {
          source: source.id,
          message_id: `fictional-${id}`,
          timestamp: at(days),
          speaker: "me",
          quote: `Fictional journal entry for ${id}.`,
        },
      ],
      ...extra,
    });
  };
  const fact = (id: string, value: Fact, days: number, extra?: Partial<Claim>) =>
    add(id, createFactAssertion(owner, value), days, extra);
  fact(
    "condition-current",
    {
      template: "condition",
      value: {
        id: iri("vitamin-d-deficiency"),
        name: "Vitamin D deficiency",
        validFrom: date(548),
      },
    },
    548,
    { epistemic: "Documented" },
  );
  fact(
    "condition-historical",
    {
      template: "condition",
      value: {
        id: iri("ankle-sprain"),
        name: "Ankle sprain",
        validFrom: date(480),
        validThrough: date(420),
      },
    },
    420,
    { validity: "Historical" },
  );
  fact(
    "condition-hedged",
    {
      template: "condition",
      value: { id: iri("sleep-concern"), name: "Possible sleep apnoea", validFrom: date(150) },
    },
    150,
    { epistemic: "SelfReportedHedged", hedge: "might" },
  );
  fact(
    "condition-mentioned",
    {
      template: "condition",
      value: { id: iri("migraine-mentioned"), name: "Migraine mentioned in conversation" },
    },
    120,
    { epistemic: "Mentioned" },
  );
  fact(
    "condition-conflict-a",
    { template: "condition", value: { id: iri("asthma-a"), name: "Asthma reported" } },
    90,
  );
  fact(
    "condition-conflict-b",
    { template: "condition", value: { id: iri("asthma-b"), name: "Asthma report disputed" } },
    80,
    { validity: "Contradicted", contradicts: ["condition-conflict-a"] },
  );
  fact(
    "condition-old",
    { template: "condition", value: { id: iri("old-balance"), name: "Earlier balance concern" } },
    100,
  );
  fact(
    "condition-revision",
    {
      template: "condition",
      value: { id: iri("revised-balance"), name: "Balance concern clarified" },
    },
    60,
    { supersedes: ["condition-old"] },
  );
  for (const [i, name] of [
    "Fictional vitamin D supplement",
    "Fictional short course medicine",
    "Fictional seasonal medicine",
  ].entries()) {
    fact(
      `medication-${i}`,
      {
        template: "medication",
        value: {
          id: iri(`medication-${i}`),
          medication: { id: iri(`product-${i}`), name },
          validFrom: date(400 - i * 50),
          ...(i === 1 ? { validThrough: date(330) } : {}),
          ...(i === 0 ? { dose: { value: "1.00", unit: "tablet", frequency: "daily" } } : {}),
        },
      },
      400 - i * 50,
      i === 1 ? { validity: "Historical" } : {},
    );
  }
  for (const [i, name] of ["Fictional pollen allergy", "Fictional adhesive allergy"].entries())
    fact(`allergy-${i}`, { template: "allergy", value: { id: iri(`allergy-${i}`), name } }, 500);
  const timed = (id: string, days: number, graph: Store) => {
    graph.addQuads([
      ...entities.Instant.build(iri(`time-${id}`), { inXSDDateTime: new Date(at(days)) }),
    ]);
    add(id, graph, days, { epistemic: "Documented" });
  };
  timed(
    "immunization",
    200,
    entities.Immunization.build(iri("immunization"), {
      patient: owner,
      name: "Fictional seasonal immunization",
      effectiveTime: iri("time-immunization"),
    }),
  );
  for (const [i, days] of [548, 300, 30].entries()) {
    const id = `encounter-${i}`;
    timed(
      id,
      days,
      entities.Encounter.build(iri(id), {
        patient: owner,
        name: ["Initial health review", "Laboratory follow-up", "Annual health review"][i],
        effectiveTime: iri(`time-${id}`),
      }),
    );
  }
  const tests = [
    {
      slug: "vitamin-d",
      name: "25-OH vitamin D",
      unit: "nmol/L",
      values: [22, 28, 41, 55, 64, 72],
    },
    {
      slug: "haemoglobin",
      name: "Haemoglobin",
      unit: "g/L",
      values: [128, 131, 134, 136, 135, 138],
    },
    { slug: "ferritin", name: "Ferritin", unit: "ug/L", values: [18, 22, 31, 38, 45, 51] },
    { slug: "tsh", name: "TSH", unit: "mIU/L", values: [3.1, 2.8, 2.4, 2.6, 2.2, 2.3] },
  ];
  for (const test of tests)
    for (const [i, numericValue] of test.values.entries()) {
      const id = `${test.slug}-${i}`;
      const graph = entities.Observation.build(iri(id), {
        patient: owner,
        numericValue,
        unitCode: test.unit,
        hasCode: iri(`code-${test.slug}`),
        effectiveTime: iri(`time-${id}`),
      });
      graph.addQuads([
        ...entities.CodeableConcept.build(iri(`code-${test.slug}`), { codeValue: test.name }),
      ]);
      timed(id, 540 - i * 102, graph);
    }
  for (let week = 0; week < 26; week++) {
    const id = `heart-rate-${week}`;
    timed(
      id,
      (25 - week) * 7,
      entities.HeartRateObservation.build(iri(id), {
        patient: owner,
        name: "Resting heart rate",
        numericValue: 76 - Math.floor(week / 4) + (week % 3),
        unitCode: "/min",
        effectiveTime: iri(`time-${id}`),
        hasCode: iri("resting-pulse"),
      }),
    );
  }
  const properties = [
    "self-rated-balance",
    "sleep-quality",
    "joint-comfort",
    "skin-comfort",
    "breathing-comfort",
    "mental-health-journal",
    "heart-rate-context",
    "general-energy",
  ];
  for (const [i, propertyID] of properties.entries())
    fact(
      `note-${i}`,
      { template: "preference", value: { propertyID, value: `Fictional journal note ${i + 1}.` } },
      90 - i * 10,
    );
  for (const [i, days] of [500, 30].entries())
    add(
      `document-${i}`,
      entities.DigitalDocument.build(iri(`document-${i}`), {
        about: owner,
        name: ["Fictional thyroid laboratory summary", "Fictional annual review letter"][i],
        dateCreated: new Date(at(days)),
      }),
      days,
    );
  return buildNanopublications(
    {
      batch_id: "example-health-avery",
      worker: {
        agent_id: "https://example.org/agents/fictional-extractor",
        agent_label: "Fictional demo extractor",
      },
      sources,
      claims,
    },
    { owner, generatedAt: clock },
  );
}
