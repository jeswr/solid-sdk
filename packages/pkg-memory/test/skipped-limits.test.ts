// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  MAX_SKIPPED_TARGETS,
  mergeNanopublications,
  parseNanopublicationsTolerant,
  serializeNanopublications,
} from "../src/index.js";

const owner = "https://example.org/people/avery#me";
const prefixes =
  "@prefix np: <http://www.nanopub.org/nschema#> .\n@prefix prov: <http://www.w3.org/ns/prov#> .\n";
const bad = '"bad\u2028value"';

async function valid(batch: string) {
  const value = await buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "https://example.org/agent", agent_label: "Fictional" },
      claims: [
        {
          id: "one",
          assertion: createFactAssertion(owner, {
            template: "condition",
            value: { id: `https://example.org/${batch}`, name: `Fictional ${batch}` },
          }),
          epistemic: "SelfReportedExplicit" as const,
        },
      ],
    },
    { owner, generatedAt: "2026-11-01T00:00:00Z" },
  );
  return serializeNanopublications(value);
}

describe("skippedTargets is bounded and fails safe", () => {
  const skippedHead = (targets: number) => {
    const links = Array.from({ length: targets }, (_, i) => `<urn:t:${i}>`).join(", ");
    return `${prefixes}
<urn:skip:head> { <urn:skip:head> np:hasAssertion <urn:skip:a> ; np:hasProvenance <urn:skip:p> ; np:hasPublicationInfo <urn:skip:i> . }
<urn:skip:a> { <urn:s> <urn:p> <urn:o> . }
<urn:skip:i> { <urn:s> <urn:p> <urn:o> . }
<urn:skip:p> { <urn:skip:a> prov:wasRevisionOf ${links} . <urn:s> <urn:p> ${bad} . }
`;
  };

  it("returns every target up to the maximum", async () => {
    const result = await parseNanopublicationsTolerant(
      `${await valid("kept")}\n${skippedHead(MAX_SKIPPED_TARGETS)}`,
    );
    expect(result.skipped).toHaveLength(1);
    expect(result.skippedTargets).toHaveLength(MAX_SKIPPED_TARGETS);
    expect(result.skippedTargetsOverflow).toBeUndefined();
    expect(result.affected).toEqual([]);
  });

  it("truncates above the maximum and marks every nanopub affected, here and in merges", async () => {
    const result = await parseNanopublicationsTolerant(
      `${await valid("kept")}\n${skippedHead(MAX_SKIPPED_TARGETS + 1)}`,
    );
    expect(result.skippedTargets).toHaveLength(MAX_SKIPPED_TARGETS);
    expect(result.skippedTargetsOverflow).toBe(true);
    expect(result.nanopubs).toHaveLength(1);
    expect(result.affected).toEqual(result.nanopubs.map((np) => np.id));
    // A nanopub from another input is marked too: the dropped targets could name it.
    const other = await parseNanopublicationsTolerant(await valid("other"));
    expect(other.affected).toEqual([]);
    for (const merged of [
      mergeNanopublications(result, other),
      mergeNanopublications(other, result),
    ]) {
      expect(merged.skippedTargetsOverflow).toBe(true);
      expect([...(merged.affected ?? [])].sort()).toEqual(
        merged.nanopubs.map((np) => np.id).sort(),
      );
      expect(merged.nanopubs).toHaveLength(2);
    }
    expect(mergeNanopublications(other, other).skippedTargetsOverflow).toBeUndefined();
  });
});

describe("positional skipped IDs never collide", () => {
  it("takes the next free index when a real head already uses a positional name", async () => {
    const trig = `${prefixes}
<urn:pkg:skipped:0> { <urn:pkg:skipped:0> np:hasAssertion <urn:a:0> . <urn:s> <urn:p> ${bad} . }
<urn:pkg:skipped:1> { <urn:pkg:skipped:1> np:hasAssertion <urn:a:1> . <urn:s> <urn:p> ${bad} . }
<javascript:FictionalOne> { <javascript:FictionalOne> np:hasAssertion <urn:a:2> . }
<javascript:FictionalTwo> { <javascript:FictionalTwo> np:hasAssertion <urn:a:3> . }
`;
    const result = await parseNanopublicationsTolerant(trig);
    const ids = result.skipped.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(
      expect.arrayContaining([
        "urn:pkg:skipped:0",
        "urn:pkg:skipped:1",
        "urn:pkg:skipped:2",
        "urn:pkg:skipped:3",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("javascript");
  });
});
