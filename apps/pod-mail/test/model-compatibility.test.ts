// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { serialiseToTurtle } from "../src/model/serialise.js";

describe("Pod Mail model compatibility", () => {
  it("preserves named and default graphs through N3 Writer", async () => {
    const original = await parseRdf(
      `@prefix schema: <http://schema.org/>.
       <https://pod.example/mail/messages/m1.ttl#it> schema:headline "Default graph".
       <https://pod.example/mail/graph> {
         <https://pod.example/mail/messages/m1.ttl#it> schema:headline "Named graph".
       }`,
      "application/trig",
    );

    const output = serialiseToTurtle(original);
    expect(output).toContain("@prefix schema:");
    expect(output).toContain("<https://pod.example/mail/graph>");
    const reparsed = await parseRdf(output, "application/trig");
    expect(reparsed.size).toBe(2);
    for (const quad of original) expect(reparsed.has(quad)).toBe(true);
  });
});
