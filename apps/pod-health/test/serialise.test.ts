// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { HealthDocument } from "../src/model.js";
import { PREFIXES, toTurtle } from "../src/serialise.js";
import { Unit } from "../src/vocab.js";
import { CONFORMANT_HEALTH_TTL } from "./fixtures.js";

describe("toTurtle", () => {
  it("serialises an empty dataset to just the prefix block (no triples)", async () => {
    const ttl = await toTurtle(new Store());
    expect(ttl).toContain("@prefix health:");
    // No statement separators / subjects: only prefix declarations are present.
    expect(ttl).not.toMatch(/\bhealth:[A-Z]/);
  });

  it("round-trips: parse → mutate → serialise → re-parse is lossless", async () => {
    const parsed = new Parser({ baseIRI: "https://carol.example/health/Record" }).parse(
      CONFORMANT_HEALTH_TTL,
    );
    const store = new Store(parsed);
    const doc = new HealthDocument(store, DataFactory);

    // Mint a new observation through the model, then serialise the whole graph.
    const obs = doc.mintObservation("https://carol.example/health/HR2", "StepCount");
    obs.patient = "https://carol.example/health/Carol";
    obs.measuredValue = 8500;

    const ttl = await toTurtle(doc);
    expect(ttl).toContain("@prefix health:");
    expect(ttl).toContain("@prefix unit:");

    // Re-parse and confirm both the original and the new triples survive.
    const reparsed = new Store(new Parser().parse(ttl));
    const reDoc = new HealthDocument(reparsed, DataFactory);
    const observations = [...reDoc.observations];
    const stepObs = observations.find((o) => o.kind === "StepCount");
    expect(stepObs?.measuredValue).toBe(8500);
    const hr = observations.find((o) => o.kind === "HeartRate");
    expect(hr?.unit).toBe(Unit.beatPerMin);
  });

  it("rejects (as an Error) when iterating the dataset throws", async () => {
    const throwing = {
      size: 1,
      [Symbol.iterator]: () => {
        throw new Error("iterator boom");
      },
    } as unknown as Parameters<typeof toTurtle>[0];
    await expect(toTurtle(throwing)).rejects.toThrow("iterator boom");
  });

  it("wraps a non-Error throwable in an Error when rejecting", async () => {
    // A non-Error throwable (a bare string) must be coerced to an Error so the
    // rejection always carries a `.message` for the caller. Re-thrown via a
    // variable so biome's useThrowOnlyError does not flag a literal throw.
    const notAnError: unknown = "string boom";
    const throwing = {
      size: 1,
      [Symbol.iterator]: () => {
        throw notAnError;
      },
    } as unknown as Parameters<typeof toTurtle>[0];
    await expect(toTurtle(throwing)).rejects.toThrow("string boom");
  });

  it("emits the documented prefixes", () => {
    expect(PREFIXES.health).toBe("https://TBD.example/solid/health#");
    expect(PREFIXES.ph).toBe("https://w3id.org/jeswr/pod-health#");
    expect(PREFIXES.unit).toBe("http://qudt.org/vocab/unit/");
    expect(Object.keys(PREFIXES)).toContain("solid");
  });
});
