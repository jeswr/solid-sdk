// AUTHORED-BY Codex GPT-6.1-Sol
// Run from apps/suite: node e2e/health/fixtures/generate-knowledge.mjs
import { writeFile } from "node:fs/promises";
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import {
  buildNanopublications,
  createFactAssertion,
  serializeNanopublications,
} from "@jeswr/pkg-memory";

const owner = "https://example.org/people/robin#me";
const value = await buildNanopublications(
  {
    batch_id: "fictional-local-health-file",
    worker: {
      agent_id: "https://example.org/agents/fictional-file-extractor",
      agent_label: "Fictional file extractor",
    },
    sources: [
      {
        id: "journal",
        kind: "document",
        url: "https://example.org/fictional/journal",
        title: "Fictional imported journal",
        model: "fictional-local-model",
        created: "2026-03-03T10:00:00Z",
      },
    ],
    claims: [
      {
        id: "allergy",
        assertion: createFactAssertion(owner, {
          template: "allergy",
          value: {
            id: "https://example.org/fictional/pollen-allergy",
            name: "Fictional imported pollen allergy",
            validFrom: { value: "2025-03", datatype: "gYearMonth" },
          },
        }),
      },
      {
        id: "note",
        assertion: createFactAssertion(owner, {
          template: "preference",
          value: { propertyID: "health-journal", value: "Fictional imported note about a walk." },
        }),
      },
      {
        id: "condition",
        assertion: createFactAssertion(owner, {
          template: "condition",
          value: {
            id: "https://example.org/fictional/old-sprain",
            name: "Fictional imported sprain",
            validFrom: { value: "2025", datatype: "gYear" },
          },
        }),
      },
    ].map((claim) => ({
      ...claim,
      epistemic: "SelfReportedExplicit",
      categories: ["pd:MedicalHealth"],
      evidence: [{ source: "journal", quote: "Fictional file evidence only." }],
    })),
  },
  { owner, generatedAt: "2026-11-01T12:00:00Z" },
);
await writeFile(
  new URL("knowledge.trig", import.meta.url),
  `# AUTHORED-BY Codex GPT-6.1-Sol\n${await serializeNanopublications(value)}`,
);

const sample = await exampleHealthKnowledge();
await writeFile(
  new URL("knowledge-sample-ids.json", import.meta.url),
  `${JSON.stringify(
    {
      provenance: "AUTHORED-BY Codex GPT-6.1-Sol",
      ids: sample.nanopubs.map((np) => np.id).sort(),
    },
    null,
    2,
  )}\n`,
);
