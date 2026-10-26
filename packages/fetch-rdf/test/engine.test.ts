// AUTHORED-BY Codex GPT-6.1-Sol
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { afterAll, describe, expect, it, vi } from "vitest";
import { fetchRdf, parseRdf, RdfFetchError } from "../src/index.js";
import { JSON_LD_SAMPLE, makeResponse, TURTLE_SAMPLE } from "./helpers.js";

const engine = createRdfEngine();
afterAll(() => engine.dispose());

const formats = [
  ["text/turtle", TURTLE_SAMPLE],
  [
    "application/trig",
    '<https://example.org/g> { <https://example.org/s> <https://example.org/p> "café" }',
  ],
  ["application/ld+json", JSON_LD_SAMPLE],
] as const;

describe("optional RDF engine", () => {
  it.each(formats)("matches default RDF semantics for %s", async (mediaType, body) => {
    const defaultDataset = await parseRdf(body, mediaType);
    const engineDataset = await parseRdf(body, mediaType, { engine });
    expect(await engine.canonicalize(engineDataset)).toBe(
      await engine.canonicalize(defaultDataset),
    );
  });

  it("returns the engine's exact dataset and passes normalized format and base", async () => {
    const parse = vi.spyOn(engine, "parse");
    try {
      const dataset = await parseRdf(
        '<#s> <https://example.org/p> "value" .',
        "Text/Turtle; charset=utf-8",
        {
          engine,
          baseIRI: "https://example.org/resource",
        },
      );
      expect(parse).toHaveBeenCalledWith(expect.any(String), "text/turtle", {
        baseIri: "https://example.org/resource",
      });
      expect(dataset).toBe(await parse.mock.results[0]?.value);
      expect([...dataset][0]?.subject.value).toBe("https://example.org/resource#s");
    } finally {
      parse.mockRestore();
    }
  });

  it("preserves engine errors as the cause with response metadata", async () => {
    const disposed = createRdfEngine();
    disposed.dispose();
    const response = makeResponse(TURTLE_SAMPLE, { url: "https://example.org/final" });
    await expect(
      fetchRdf("https://example.org/start", {
        engine: disposed,
        fetch: async () => response,
      }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      url: "https://example.org/final",
      contentType: "text/turtle",
      cause: expect.any(Error),
    });
    expect(response.body?.locked).toBe(false);
  });

  it("releases a failed source and wraps its original error", async () => {
    const failure = new Error("source failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(parseRdf(body, "text/turtle", { engine })).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: failure,
    });
    expect(body.locked).toBe(false);
  });

  it("wraps failure to acquire a locked stream", async () => {
    const body = new ReadableStream<Uint8Array>();
    const reader = body.getReader();
    try {
      await expect(parseRdf(body, "text/turtle", { engine })).rejects.toBeInstanceOf(RdfFetchError);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it("rejects remote contexts without network access on the engine path", async () => {
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network"));
    try {
      await expect(
        parseRdf(
          '{"@context":"https://example.org/context", "name":"Alice"}',
          "application/ld+json",
          { engine },
        ),
      ).rejects.toBeInstanceOf(RdfFetchError);
      expect(transport).not.toHaveBeenCalled();
    } finally {
      transport.mockRestore();
    }
  });
});
