// AUTHORED-BY Codex GPT-6
import { DataFactory as df, Store } from "n3";
import { expect, it, vi } from "vitest";
import { type ParseRdfOptions, parseRdf, parseRdfSync } from "../src/index.js";
import { TURTLE_SAMPLE } from "./helpers.js";

it.each([
  "buffered",
  "stream",
  "sync",
  "jsonld",
])("uses the factory and one fresh output store (%s)", async (mode) => {
  const factory = { ...df };
  const namedNode = vi.spyOn(factory, "namedNode");
  const store = new Store([], { factory });
  const storeFactory = vi.fn(() => store);
  const options = { factory, storeFactory };
  const result =
    mode === "sync"
      ? parseRdfSync(TURTLE_SAMPLE, options)
      : await parseRdf(
          mode === "stream"
            ? (new Response(TURTLE_SAMPLE).body as ReadableStream<Uint8Array>)
            : mode === "jsonld"
              ? JSON.stringify({
                  "@id": "https://example.org/subject",
                  "https://example.org/predicate": { "@id": "https://example.org/object" },
                })
              : TURTLE_SAMPLE,
          mode === "jsonld" ? "application/ld+json" : "text/turtle",
          options,
        );
  expect(result).toBe(store);
  expect(result.size).toBeGreaterThan(0);
  expect(namedNode).toHaveBeenCalled();
  expect(storeFactory).toHaveBeenCalledTimes(1);
});

it("uses the term factory for output reads when no store factory is supplied", async () => {
  const factory = { ...df };
  const namedNode = vi.spyOn(factory, "namedNode");
  const result = await parseRdf(TURTLE_SAMPLE, "text/turtle", { factory });
  namedNode.mockClear();
  expect([...result]).toHaveLength(5);
  expect(namedNode).toHaveBeenCalled();
});

it.each([
  "buffered",
  "stream",
  "sync",
])("retains all parse budgets and rejects nonempty outputs (%s)", async (mode) => {
  const parse = async (body: string, options: ParseRdfOptions) =>
    mode === "sync"
      ? parseRdfSync(body, options)
      : parseRdf(
          mode === "stream" ? (new Response(body).body as ReadableStream<Uint8Array>) : body,
          "text/turtle",
          options,
        );
  const options = { factory: df, storeFactory: () => new Store() };
  for (const budget of [
    { maxBytes: 1 },
    { maxQuads: 0 },
    { maxTermLength: 1 },
    { maxTotalTermLength: 1 },
  ]) {
    await expect(parse(TURTLE_SAMPLE, { ...options, ...budget })).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
  }
  const nonempty = parseRdfSync(TURTLE_SAMPLE);
  await expect(
    parse(TURTLE_SAMPLE, { ...options, storeFactory: () => nonempty }),
  ).rejects.toMatchObject({ cause: { message: "Parser store must be empty." } });
  await expect(parse("invalid RDF", options)).rejects.toMatchObject({ name: "RdfFetchError" });
  await expect(
    parse(TURTLE_SAMPLE, {
      ...options,
      storeFactory: () => {
        throw new Error("Fictional factory failure");
      },
    }),
  ).rejects.toMatchObject({ cause: { message: "Fictional factory failure" } });
});
