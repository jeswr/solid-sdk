// AUTHORED-BY Codex GPT-6
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  buildNanopublications,
  type Claim,
  createFactAssertion,
  type Fact,
  serializeNanopublications,
} from "@jeswr/pkg-memory";

export const syntheticOwner = "https://example.org/people/avery#me";

/** Fictional many-graph export. Only public fact/batch builders and the suite Writer. */
export async function syntheticHealthExport(count = 4500, batches = 40): Promise<string> {
  const parts: string[] = [];
  for (let batch = 0; batch < Math.min(count, batches); batch++) {
    const claims: Claim[] = [];
    for (let i = batch; i < count; i += batches) {
      const id = `https://example.org/health/fictional-${i}`;
      const period = {
        validFrom: { value: "2025-01-01", datatype: "date" as const },
        validThrough: { value: "2026-01-01", datatype: "date" as const },
      };
      const fact: Fact =
        i % 3 === 0
          ? {
              template: "medication",
              value: {
                id,
                medication: {
                  id: `${id}-product`,
                  name: `Fictional medicine ${i}`,
                  atcCode: "C01AA00",
                },
                dose: { value: "2.00", unit: "mg", frequency: "daily" },
                ...period,
              },
            }
          : i % 3 === 1
            ? {
                template: "condition",
                value: {
                  id,
                  name: `Fictional condition ${i}`,
                  code: { id: `${id}-code`, value: "Fictional code" },
                  ...period,
                },
              }
            : { template: "allergy", value: { id, name: `Fictional allergy ${i}`, ...period } };
      claims.push({
        id: `claim-${i}`,
        assertion: createFactAssertion(syntheticOwner, fact),
        epistemic: "SelfReportedExplicit",
        categories: ["pd:MedicalHealth"],
        evidence: [
          {
            source: "document",
            locator: `fictional-section-${i}`,
            quote: `Fictional health journal entry ${i}. ${"This is invented test evidence. ".repeat(5)}`,
          },
          ...(i % 3 === 0
            ? [
                {
                  source: "chat",
                  message_id: `fictional-message-${i}`,
                  timestamp: "2026-10-01T12:00:00Z",
                  speaker: "me",
                  quote: `Fictional follow-up entry ${i}.`,
                },
              ]
            : []),
        ],
      });
    }
    const value = await buildNanopublications(
      {
        batch_id: `fictional-performance-${batch}`,
        worker: {
          agent_id: "https://example.org/agents/fictional-extractor",
          agent_label: "Fictional extractor",
        },
        sources: [
          {
            id: "chat",
            kind: "codex-thread",
            thread_id: `11111111-1111-4111-8111-${String(batch).padStart(12, "0")}`,
            title: "Fictional health discussion",
            created: "2026-10-01T12:00:00Z",
          },
          {
            id: "document",
            kind: "document",
            url: `https://example.org/documents/fictional-${batch}`,
            title: "Fictional health journal",
            sha256: "a".repeat(64),
          },
        ],
        entities: [{ id: `https://example.org/entities/fictional-${batch}`, label: "Fictional" }],
        claims,
      },
      { owner: syntheticOwner, generatedAt: "2026-11-01T12:00:00Z" },
    );
    parts.push(await serializeNanopublications(value));
  }
  return parts.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node test/support/synthetic-export.ts <output> [count]");
  await writeFile(file, await syntheticHealthExport(Number(process.argv[3] ?? 4500)));
}
