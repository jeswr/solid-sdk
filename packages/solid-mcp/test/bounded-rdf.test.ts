// AUTHORED-BY Codex GPT-6.1-Sol
import { Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RDF_QUADS,
  parseBoundedRdf,
  RdfLimitError,
  serializeBoundedTurtle,
} from "../src/bounded-rdf.js";

const BASE = "https://alice.example/pod/data";
afterEach(() => vi.restoreAllMocks());

describe("RDF expansion and serialization budgets", () => {
  it("bounds chained prefix expansion before emitting quads", async () => {
    const context = {
      p0: `https://example.org/${"long".repeat(4096)}/`,
      ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i + 1}`, `p${i}:x/`])),
    };
    await expect(
      parseBoundedRdf(JSON.stringify({ "@context": context }), "application/ld+json", BASE),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("preserves inherited prefixes in small scoped inline contexts", async () => {
    const dataset = await parseBoundedRdf(
      JSON.stringify({
        "@context": [
          { p: "https://example.org/" },
          { nested: { "@id": "p:nested", "@context": { name: "p:name" } } },
        ],
        "@id": "urn:s",
        nested: { name: "Alice" },
      }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.size).toBe(2);
    expect(dataset.getQuads(null, "https://example.org/name", null, null)[0]?.object.value).toBe(
      "Alice",
    );
  });

  it.each([
    "prefix",
    "vocab",
    "array",
    "scoped",
  ])("bounds inline %s context expansion without emitted quads", async (kind) => {
    const iri = `https://example.org/${"long".repeat(4096)}/`;
    const terms = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, "p:x"]));
    const context =
      kind === "vocab"
        ? { "@vocab": iri, ...Object.fromEntries(Object.keys(terms).map((key) => [key, {}])) }
        : kind === "array"
          ? [{ p: iri }, terms]
          : kind === "scoped"
            ? { nested: { "@id": "urn:nested", "@context": { p: iri, ...terms } } }
            : { p: iri, ...terms };
    const source = JSON.stringify({ "@context": context });
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, "application/ld+json", BASE)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(addQuad).not.toHaveBeenCalled();
  });

  it("shares the context allocation budget with RDF term creation", async () => {
    const iri = `https://example.org/${"long".repeat(4096)}/`;
    const context = {
      p: iri,
      ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, "p:x"])),
    };
    const graph = Array.from({ length: 45 }, (_, i) => ({ "@id": `urn:s${i}`, "p:name": "a" }));
    const source = (value: unknown) => JSON.stringify(value);
    expect(
      (await parseBoundedRdf(source({ "@context": context }), "application/ld+json", BASE)).size,
    ).toBe(0);
    expect(
      (
        await parseBoundedRdf(
          source({ "@context": { p: iri }, "@graph": graph }),
          "application/ld+json",
          BASE,
        )
      ).size,
    ).toBe(45);
    await expect(
      parseBoundedRdf(
        source({ "@context": context, "@graph": graph }),
        "application/ld+json",
        BASE,
      ),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("bounds expanded prefix declarations even without emitted quads", async () => {
    const base = `${BASE}/${"long".repeat(4096)}`;
    const source = Array.from({ length: 100 }, (_, i) => `@prefix p${i}: <#${i}>.`).join("\n");
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, "text/turtle", base)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(addQuad).not.toHaveBeenCalled();
  });

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("bounds duplicate %s quads before Store insertion", async (contentType) => {
    const count = MAX_RDF_QUADS + 1;
    const source =
      contentType === "text/turtle"
        ? "<urn:s> <urn:p> <urn:o>.\n".repeat(count)
        : `{"@id":"urn:s","urn:p":[${'{"@id":"urn:o"},'.repeat(count - 1)}{"@id":"urn:o"}]}`;
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const withinLimit =
      contentType === "text/turtle"
        ? "<urn:s> <urn:p> <urn:o>.\n".repeat(MAX_RDF_QUADS)
        : `{"@id":"urn:s","urn:p":[${'{"@id":"urn:o"},'.repeat(MAX_RDF_QUADS - 1)}{"@id":"urn:o"}]}`;
    expect((await parseBoundedRdf(withinLimit, contentType, BASE)).size).toBe(1);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, contentType, BASE)).rejects.toBeInstanceOf(RdfLimitError);
    expect(addQuad.mock.calls.length).toBeLessThanOrEqual(MAX_RDF_QUADS);
  });

  it("stops the writer before later quads when escaping exceeds the output budget", async () => {
    const dataset = await parseBoundedRdf(
      `<urn:s> <urn:p> "${"🌱".repeat(150_000)}". <urn:last> <urn:p> "tail".`,
      "text/turtle",
      BASE,
    );
    expect(dataset.size).toBe(2);
    const addQuad = vi.spyOn(Writer.prototype, "addQuad");
    expect(() => serializeBoundedTurtle(dataset)).toThrow(RdfLimitError);
    expect(addQuad).toHaveBeenCalledTimes(1);
  });

  it("retains valid empty Turtle", async () => {
    expect(serializeBoundedTurtle(await parseBoundedRdf("", "text/turtle", BASE))).toBe("");
  });
});
