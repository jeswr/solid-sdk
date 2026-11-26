// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  parseNanopublications,
  parseNanopublicationsTolerant,
} from "../src/index.js";

const unsafe = "javascript:FictionalSecret";
const trig = `
@prefix np: <http://www.nanopub.org/nschema#> .
<${unsafe}> { <${unsafe}> np:hasAssertion <https://example.org/a> . }
`;

describe("rejected input values never reach the skip report or errors", () => {
  it("reports an unsafe head IRI by position, never by value", async () => {
    const result = await parseNanopublicationsTolerant(trig);
    expect(JSON.stringify(result)).not.toContain("javascript");
    expect(JSON.stringify(result)).not.toContain("FictionalSecret");
    expect(result.skipped).toEqual([{ id: "urn:pkg:skipped:0", errorClass: "Error" }]);
    expect(result.skipped.map((s) => s.id)).not.toContain(unsafe);
    expect(JSON.stringify([...result.dataset])).not.toContain("javascript");
  });

  it("uses a fixed message for an unknown status and an unknown claim reference", async () => {
    const options = {
      owner: "https://example.org/people/avery#me",
      generatedAt: "2026-11-01T00:00:00Z",
    };
    const claim = (extra: object) => ({
      id: "a",
      assertion: createFactAssertion(options.owner, {
        template: "condition",
        value: { id: "https://example.org/a", name: "Fictional" },
      }),
      epistemic: "SelfReportedExplicit" as const,
      ...extra,
    });
    const batch = (extra: object) => ({
      batch_id: "fixed-messages",
      worker: { agent_id: "https://example.org/agent", agent_label: "Fictional" },
      claims: [claim(extra)],
    });
    await expect(
      buildNanopublications(batch({ supersedes: ["Fictional-secret-claim"] }), options),
    ).rejects.toThrow(/^Unknown claim reference$/);

    const built = await buildNanopublications(batch({}), options);
    const { serializeNanopublications } = await import("../src/index.js");
    const text = (await serializeNanopublications(built)).replace(
      /pkg:epistemicStatus\s+pkg:SelfReportedExplicit/,
      "pkg:epistemicStatus pkg:FictionalSecretStatus",
    );
    await expect(parseNanopublications(text)).rejects.toThrow(/^Unknown status$/);
  });
});
