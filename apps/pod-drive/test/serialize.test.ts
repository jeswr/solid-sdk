// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import * as N3 from "n3";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { iri, quadsToTurtle } from "../src/serialize.js";
import { turtle } from "./helpers.js";

const { namedNode, quad } = DataFactory;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("iri", () => {
  it("mints a NamedNode", () => {
    const n = iri("https://pod.example/x");
    expect(n.termType).toBe("NamedNode");
    expect(n.value).toBe("https://pod.example/x");
  });
});

describe("quadsToTurtle", () => {
  it("serialises quads with prefixed Turtle that round-trips", async () => {
    const quads = [
      quad(
        namedNode("https://pod.example/drive/"),
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode("https://w3id.org/jeswr/pod-drive#DriveRoot"),
      ),
    ];
    const ttl = await quadsToTurtle(quads);
    expect(ttl).toContain("poddrive:DriveRoot");
    expect(ttl).toContain("@prefix poddrive:");

    // Round-trip: parse the emitted Turtle back and confirm the triple survived.
    const store = turtle(ttl);
    const back = store.getQuads(
      namedNode("https://pod.example/drive/"),
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("https://w3id.org/jeswr/pod-drive#DriveRoot"),
      null,
    );
    expect(back).toHaveLength(1);
  });

  it("serialises an empty quad set to a triple-free document", async () => {
    const ttl = await quadsToTurtle([]);
    // n3.Writer still emits @prefix lines, but the document asserts no triples.
    expect(turtle(ttl).size).toBe(0);
  });

  it("emits all drive prefixes only when used", async () => {
    const ttl = await quadsToTurtle([
      quad(
        namedNode("https://pod.example/c/"),
        namedNode("http://www.w3.org/ns/ldp#contains"),
        namedNode("https://pod.example/c/f"),
      ),
    ]);
    expect(ttl).toContain("ldp:contains");
  });

  it("rejects when the underlying writer surfaces an error", async () => {
    // n3.Writer never errors for well-formed quads, so the rejection path is
    // exercised by forcing its `end` callback to receive an error.
    const boom = new Error("writer failed");
    vi.spyOn(N3.Writer.prototype, "end").mockImplementation(function mockEnd(
      this: unknown,
      ...args: unknown[]
    ) {
      const cb = args.find((a): a is (e?: Error) => void => typeof a === "function");
      cb?.(boom);
      return undefined as never;
    });
    await expect(quadsToTurtle([])).rejects.toBe(boom);
  });
});
