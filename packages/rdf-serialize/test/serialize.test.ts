// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the public API surface of @jeswr/rdf-serialize: option
// defaults, the positional legacy helper, the error-rejection path, and the
// presence of the exported symbols.

import type { Quad } from "@rdfjs/types";
import * as n3 from "n3";
import { DataFactory, type ErrorCallback } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORMAT, legacySerialize, type SerializeOptions, serialize } from "../src/index.js";

const { namedNode, literal, quad } = DataFactory;

const SCHEMA_NS = "https://schema.org/";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

function sampleQuads(): Quad[] {
  const s = namedNode("https://example.org/s");
  return [
    quad(s, namedNode(`${RDF_NS}type`), namedNode(`${SCHEMA_NS}Thing`)),
    quad(s, namedNode(`${SCHEMA_NS}name`), literal("Sample")),
  ];
}

describe("serialize — option defaults", () => {
  it("defaults format to text/turtle", async () => {
    const quads = sampleQuads();
    const explicit = await serialize(quads, { format: "text/turtle" });
    const implicit = await serialize(quads);
    expect(implicit).toBe(explicit);
  });

  it("DEFAULT_FORMAT is text/turtle", () => {
    expect(DEFAULT_FORMAT).toBe("text/turtle");
  });

  it("defaults prefixes to {} (no prefix declarations, full IRIs)", async () => {
    const out = await serialize(sampleQuads());
    // With no prefixes the schema.org IRI is written out in full, not abbreviated.
    expect(out).toContain("<https://schema.org/Thing>");
    expect(out).not.toContain("schema:Thing");
  });

  it("applies a supplied prefix map", async () => {
    const out = await serialize(sampleQuads(), { prefixes: { schema: SCHEMA_NS } });
    expect(out).toContain("schema:Thing");
    expect(out).toContain("@prefix schema:");
  });

  it("defaults emptyAsEmptyString to true (empty graph -> '')", async () => {
    expect(await serialize([])).toBe("");
    expect(await serialize([], {})).toBe("");
  });

  it("emptyAsEmptyString:false lets n3.Writer emit for an empty graph", async () => {
    const out = await serialize([], { emptyAsEmptyString: false });
    expect(typeof out).toBe("string");
  });

  it("passes an explicit format through to n3.Writer", async () => {
    const out = await serialize(sampleQuads(), { format: "application/n-triples" });
    // N-Triples uses full IRIs in angle brackets and one statement per line.
    expect(out).toContain("<https://schema.org/Thing>");
    expect(out.trimEnd().split("\n").length).toBe(2);
  });
});

describe("legacySerialize — positional backward-compat helper", () => {
  it("matches serialize with equivalent options", async () => {
    const quads = sampleQuads();
    const viaLegacy = await legacySerialize(quads, "text/turtle", { schema: SCHEMA_NS }, true);
    const viaOptions = await serialize(quads, {
      format: "text/turtle",
      prefixes: { schema: SCHEMA_NS },
      emptyAsEmptyString: true,
    });
    expect(viaLegacy).toBe(viaOptions);
  });

  it("defaults format to text/turtle, prefixes to {}, emptyAsEmptyString to true", async () => {
    const quads = sampleQuads();
    expect(await legacySerialize(quads)).toBe(await serialize(quads));
    expect(await legacySerialize([])).toBe("");
  });

  it("emptyAsEmptyString:false reproduces federation-client empty behaviour", async () => {
    const out = await legacySerialize([], "text/turtle", { schema: SCHEMA_NS }, false);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("serialize — error rejection path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects with the error n3.Writer surfaces via its end() callback", async () => {
    // n3.Writer is highly tolerant of array input and rarely errors in practice,
    // so we exercise the documented contract directly: when Writer#end yields an
    // error, serialize() must reject with that exact error (not resolve). Stub
    // Writer#end to invoke its callback with an error.
    const boom = new Error("n3 writer failure");
    vi.spyOn(n3.Writer.prototype, "end").mockImplementation((cb?: ErrorCallback) => {
      cb?.(boom, "");
    });
    await expect(serialize(sampleQuads())).rejects.toBe(boom);
  });

  it("resolves with the result n3.Writer surfaces on success", async () => {
    vi.spyOn(n3.Writer.prototype, "end").mockImplementation((cb?: ErrorCallback) => {
      // n3 calls the success callback with a null error; ErrorCallback's `err`
      // is typed `Error`, so cast the runtime null the production code handles.
      cb?.(null as unknown as Error, "STUB_RESULT");
    });
    await expect(serialize(sampleQuads())).resolves.toBe("STUB_RESULT");
  });
});

describe("type-level export presence", () => {
  it("SerializeOptions is usable as a type", () => {
    const opts: SerializeOptions = {
      format: "text/turtle",
      prefixes: { schema: SCHEMA_NS },
      emptyAsEmptyString: false,
    };
    expect(opts.format).toBe("text/turtle");
    expect(opts.emptyAsEmptyString).toBe(false);
  });

  it("serialize and legacySerialize are functions", () => {
    expect(typeof serialize).toBe("function");
    expect(typeof legacySerialize).toBe("function");
  });
});
