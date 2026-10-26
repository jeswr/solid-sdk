// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { parseRdf, RdfFetchError } from "../src/index.js";

describe("buffered N3 parsing", () => {
  it.each([
    ["text/turtle", '<#s> <#p> "café" .', "https://pod.example/doc#s", ""],
    ["application/n-triples", '<https://ex/s> <https://ex/p> "café" .', "https://ex/s", ""],
    [
      "application/n-quads",
      '<https://ex/s> <https://ex/p> "café" <https://ex/g> .',
      "https://ex/s",
      "https://ex/g",
    ],
    [
      "application/trig",
      '<#g> { <#s> <#p> "café" . }',
      "https://pod.example/doc#s",
      "https://pod.example/doc#g",
    ],
  ])("settles %s strings during a promise-based render flush", async (mediaType, text, subject, graph) => {
    // Lit consumers flush updates/microtasks after an injected fetch resolves.
    // A buffered body must not wait for a Node stream's next-tick end event.
    let settled = false;
    const parsing = parseRdf(text, `${mediaType}; charset=utf-8`, {
      baseIRI: "https://pod.example/doc",
    }).then((dataset) => {
      settled = true;
      return dataset;
    });
    for (let i = 0; i < 60 && !settled; i++) await Promise.resolve();
    expect(settled).toBe(true);
    const dataset = await parsing;
    expect(dataset.size).toBe(1);
    const [quad] = [...dataset];
    expect(quad?.subject.value).toBe(subject);
    expect(quad?.object.value).toBe("café");
    expect(quad?.graph.value).toBe(graph);
  });

  it("keeps structured errors for malformed buffered Turtle", async () => {
    await expect(
      parseRdf("not valid turtle .", "text/turtle", { baseIRI: "https://pod.example/doc" }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      contentType: "text/turtle",
      url: "https://pod.example/doc",
      cause: expect.any(Error),
    });
    await expect(parseRdf("not valid turtle .", "text/turtle")).rejects.toBeInstanceOf(
      RdfFetchError,
    );
  });
});
