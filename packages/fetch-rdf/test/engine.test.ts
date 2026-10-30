// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { fetchRdf, parseRdf, RdfFetchError, type RdfParser } from "../src/index.js";
import { makeResponse, TURTLE_SAMPLE } from "./helpers.js";

describe("structural RDF parser", () => {
  it("accepts a structural parser with no engine lifecycle methods", async () => {
    const dataset = await parseRdf(TURTLE_SAMPLE, "text/turtle");
    const parse = vi.fn(async () => dataset);
    const parser: RdfParser = { parse };
    expect(await parseRdf(TURTLE_SAMPLE, "text/turtle", { engine: parser })).toBe(dataset);
    const result = await fetchRdf("https://example.org/resource", {
      engine: parser,
      fetch: async () => makeResponse(TURTLE_SAMPLE),
    });
    expect(result.dataset).toBe(dataset);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("buffers stream input and forwards normalized options to a structural parser", async () => {
    const dataset = await parseRdf(TURTLE_SAMPLE, "text/turtle");
    const parse = vi.fn(async () => dataset);
    const body = new Blob([TURTLE_SAMPLE]).stream();
    const result = await parseRdf(body, "Text/Turtle; charset=utf-8", {
      engine: { parse },
      baseIRI: "https://example.org/resource",
    });
    expect(result).toBe(dataset);
    expect(parse).toHaveBeenCalledWith(TURTLE_SAMPLE, "text/turtle", {
      baseIri: "https://example.org/resource",
    });
    expect(body.locked).toBe(false);
  });

  it("preserves a structural parser's failure and response metadata", async () => {
    const failure = new Error("parser failed");
    const parse = vi.fn(async () => {
      throw failure;
    });
    await expect(
      fetchRdf("https://example.org/resource", {
        engine: { parse },
        fetch: async () => makeResponse(TURTLE_SAMPLE),
      }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      url: "https://example.org/resource",
      contentType: "text/turtle",
      cause: failure,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("releases a failed source before calling the parser", async () => {
    const failure = new Error("source failed");
    const parse = vi.fn<RdfParser["parse"]>();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(parseRdf(body, "text/turtle", { engine: { parse } })).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: failure,
    });
    expect(body.locked).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it("wraps failure to acquire a locked stream before calling the parser", async () => {
    const parse = vi.fn<RdfParser["parse"]>();
    const body = new ReadableStream<Uint8Array>();
    const reader = body.getReader();
    try {
      await expect(parseRdf(body, "text/turtle", { engine: { parse } })).rejects.toBeInstanceOf(
        RdfFetchError,
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
});
