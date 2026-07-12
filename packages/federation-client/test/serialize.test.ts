// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { selfDescribe, serialize } from "../src/index.js";

describe("serialize", () => {
  it("serialises quads to Turtle by default", async () => {
    const { quads } = selfDescribe({
      id: "https://app.example/id",
      sectors: ["https://w3id.org/jeswr/sectors/media"],
      access: ["Read"],
    });
    const turtle = await serialize(quads);
    expect(turtle).toContain("@prefix fedapp:");
    expect(turtle).toContain("fedapp:App");
  });

  it("serialises an empty quad set without error", async () => {
    const out = await serialize([]);
    expect(typeof out).toBe("string");
  });

  // Regression guard (roborev): federation-client's serialize MUST emit n3.Writer's
  // bare prefix preamble for an empty graph — NOT the "" short-circuit that the other
  // consolidated @jeswr/rdf-serialize consumers use. This pins emptyAsEmptyString:false
  // so a future regression to the helper's default ("") is caught. The exact preamble is
  // the four @prefix lines (in declared order) followed by a blank line.
  it("emits the bare prefix preamble (not '') for an empty graph in Turtle", async () => {
    const out = await serialize([]);
    expect(out).not.toBe("");
    expect(out).toBe(
      "@prefix fedapp: <https://w3id.org/jeswr/fed#>.\n" +
        "@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n" +
        "@prefix sh: <http://www.w3.org/ns/shacl#>.\n" +
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.\n\n",
    );
  });

  // The line-based N-Triples format has no preamble, so n3.Writer itself emits "" for a
  // zero-quad input — this is n3's own behaviour, unchanged by the adapter (it is NOT the
  // emptyAsEmptyString short-circuit). Pinned so the two empty-graph paths stay distinct.
  it("emits '' for an empty graph in N-Triples (n3.Writer's own behaviour)", async () => {
    const out = await serialize([], "application/n-triples");
    expect(out).toBe("");
  });
});
