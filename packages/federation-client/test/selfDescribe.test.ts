// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import type { AppRegistration } from "../src/index.js";
import { selfDescribe, verify } from "../src/index.js";

const APP: AppRegistration = {
  id: "https://app.example/clientid",
  sectors: ["https://w3id.org/jeswr/sectors/identity"],
  access: ["Read", "Write"],
  consumes: ["https://w3id.org/jeswr/sectors/identity#Profile"],
  produces: ["https://w3id.org/jeswr/sectors/identity#Profile"],
  declaresShape: ["https://app.example/shapes/Profile#shape"],
  sectorUse: [
    {
      sector: "https://w3id.org/jeswr/sectors/health",
      access: ["Read"],
      consumes: ["https://w3id.org/jeswr/sectors/health#Observation"],
    },
  ],
};

describe("selfDescribe", () => {
  it("requires an id", () => {
    expect(() => selfDescribe({ id: "" })).toThrow(TypeError);
  });

  it("builds quads typing the subject fedapp:App", () => {
    const desc = selfDescribe(APP);
    const typeQuad = desc.quads.find(
      (q) =>
        q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
        q.object.value === "https://w3id.org/jeswr/fed#App",
    );
    expect(typeQuad?.subject.value).toBe(APP.id);
  });

  it("serialises to Turtle via n3.Writer", async () => {
    const turtle = await selfDescribe(APP).toString();
    expect(turtle).toContain("fedapp:App");
    expect(turtle).toContain("https://app.example/clientid");
    expect(turtle).toContain("acl:Read");
  });

  it("round-trips: a self-described registration verifies clean", async () => {
    const turtle = await selfDescribe(APP).toString();
    const result = await verify(APP.id, { body: turtle });
    expect(result.issues).toHaveLength(0);
    expect(result.valid).toBe(true);
    expect([...(result.registration?.access ?? [])].sort()).toEqual(["Read", "Write"]);
    expect(result.registration?.sectorUse).toHaveLength(1);
    expect(result.registration?.sectorUse?.[0]?.sector).toBe(
      "https://w3id.org/jeswr/sectors/health",
    );
  });

  it("round-trips a minimal flat registration", async () => {
    const minimal: AppRegistration = {
      id: "https://min.example/id",
      sectors: ["https://w3id.org/jeswr/sectors/media"],
      access: ["Append"],
    };
    const turtle = await selfDescribe(minimal).toString();
    const result = await verify(minimal.id, { body: turtle });
    expect(result.valid).toBe(true);
    expect(result.registration?.access).toEqual(["Append"]);
  });

  it("serialises a SectorUse with consumes + produces shapes", async () => {
    const app: AppRegistration = {
      id: "https://app.example/id",
      sectorUse: [
        {
          sector: "https://w3id.org/jeswr/sectors/finance",
          access: ["Read", "Write"],
          consumes: ["https://example/shapes/A"],
          produces: ["https://example/shapes/B"],
        },
      ],
    };
    const turtle = await selfDescribe(app).toString();
    expect(turtle).toContain("fedapp:SectorUse");
    const result = await verify(app.id, { body: turtle });
    expect(result.valid).toBe(true);
    expect(result.registration?.sectorUse?.[0]?.produces).toContain("https://example/shapes/B");
  });

  it("does not allow n3.Writer IRI-injection via an untrusted consumes IRI (regression)", async () => {
    // `n3.Writer` does not escape IRIs, so an unguarded object with a `>`/space
    // would break out of `<…>` and inject arbitrary triples. The malicious
    // `consumes` value below attempts to smuggle in `<https://evil/s2> ...`.
    const malicious: AppRegistration = {
      id: "https://app.example/clientid",
      consumes: ["https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2"],
    };
    const turtle = await selfDescribe(malicious).toString();

    // Re-parse: the guard must have neutralised the payload, so no injected
    // subject/predicate/object triple appears in the graph.
    const quads = new Parser().parse(turtle);
    expect(quads.some((q) => q.subject.value === "https://evil/s2")).toBe(false);
    expect(quads.some((q) => q.predicate.value === "https://evil/p2")).toBe(false);
    expect(quads.some((q) => q.object.value === "https://evil/o2")).toBe(false);
    // The app subject is intact and there is exactly one consumes object, whose
    // value is the percent-encoded (non-breaking) form of the payload.
    const consumes = quads.filter(
      (q) => q.predicate.value === "https://w3id.org/jeswr/fed#consumes",
    );
    expect(consumes).toHaveLength(1);
    expect(consumes[0]?.subject.value).toBe("https://app.example/clientid");
    expect(consumes[0]?.object.value).not.toContain(">");
    expect(consumes[0]?.object.value).not.toContain(" ");
  });

  it("does not allow IRI-injection via an untrusted app.id subject (regression)", async () => {
    const malicious: AppRegistration = {
      id: "https://app.example/x> <https://evil/s> <https://evil/p> <https://evil/o> .# ",
      sectors: ["https://w3id.org/jeswr/sectors/media"],
    };
    const turtle = await selfDescribe(malicious).toString();
    const quads = new Parser().parse(turtle);
    expect(quads.some((q) => q.subject.value === "https://evil/s")).toBe(false);
    expect(quads.some((q) => q.predicate.value === "https://evil/p")).toBe(false);
  });

  it("serialises to N-Triples when asked", async () => {
    const nt = await selfDescribe({
      id: "https://app.example/id",
      sectors: ["https://w3id.org/jeswr/sectors/media"],
      access: ["Read"],
    }).toString("application/n-triples");
    expect(nt).toContain("<https://app.example/id>");
    expect(nt).toContain("<https://w3id.org/jeswr/fed#App>");
  });
});
