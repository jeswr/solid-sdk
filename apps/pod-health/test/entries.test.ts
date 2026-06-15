// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The render-facing flattener: `listHealthEntries` lifts a typed HealthDocument
// into plain, primitive HealthEntry rows the view renders. Exercises every
// clinical kind, the effective-instant date resolution, the value/unit lift,
// and the newest-first ordering (with dateless rows last).

import { describe, expect, it, vi } from "vitest";
import { listHealthEntries } from "../src/entries.js";
import { emptyHealthDocument, readHealth } from "../src/store.js";
import { CONFORMANT_HEALTH_TTL } from "./fixtures.js";

/** Read a Turtle fixture into a HealthDocument via a stubbed fetch (no real pod). */
async function readFixture(ttl: string) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(ttl, { status: 200, headers: { "content-type": "text/turtle" } }),
    );
  const { document } = await readHealth("https://carol.example/health/record.ttl", {
    fetch: fetchMock,
  });
  return document;
}

describe("listHealthEntries", () => {
  it("flattens the conformant document into typed record / observation / condition rows", async () => {
    const document = await readFixture(CONFORMANT_HEALTH_TTL);
    const entries = listHealthEntries(document);

    const kinds = entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["Condition", "Observation", "Record"]);

    const obs = entries.find((e) => e.kind === "Observation");
    expect(obs).toBeDefined();
    expect(obs?.typeLabel).toBe("Heart Rate");
    expect(obs?.value).toBe(72);
    expect(obs?.unitCode).toBe("/min");
    // The effective time resolved through the linked time:Instant.
    expect(obs?.date?.toISOString()).toBe("2026-06-13T08:00:00.000Z");
    expect(obs?.codeRef).toBe("https://carol.example/health/LoincHeartRate");

    const condition = entries.find((e) => e.kind === "Condition");
    expect(condition?.typeLabel).toBe("Condition");
    expect(condition?.date).toBeUndefined();
    expect(condition?.value).toBeUndefined();
    expect(condition?.codeRef).toBe("https://carol.example/health/SctHypertension");

    const record = entries.find((e) => e.kind === "Record");
    expect(record?.typeLabel).toBe("Health Record");
    expect(record?.codeRef).toBe("https://carol.example/health/Carol");
  });

  it("labels each observation subtype and a bare observation", () => {
    const doc = emptyHealthDocument();
    doc.mintObservation("https://x.example/hr", "HeartRate");
    doc.mintObservation("https://x.example/steps", "StepCount");
    doc.mintObservation("https://x.example/sleep", "Sleep");
    doc.mintObservation("https://x.example/bare", "Observation");

    const labels = new Set(
      listHealthEntries(doc)
        .filter((e) => e.kind === "Observation")
        .map((e) => e.typeLabel),
    );
    expect(labels).toEqual(new Set(["Heart Rate", "Step Count", "Sleep", "Observation"]));
  });

  it("projects medication, immunization and workout entries with their refs/values", () => {
    const doc = emptyHealthDocument();

    const med = doc.mintMedicationStatement("https://x.example/med");
    med.medication = "https://x.example/aspirin";
    const imm = doc.mintImmunization("https://x.example/imm");
    imm.vaccine = "https://x.example/mmr";

    const workout = doc.mintWorkout("https://x.example/run");
    workout.activityType = "Run";
    workout.distance = 5000;
    workout.startTime = new Date("2026-06-14T06:00:00Z");

    const entries = listHealthEntries(doc);
    const med0 = entries.find((e) => e.kind === "Medication");
    expect(med0?.typeLabel).toBe("Medication");
    expect(med0?.codeRef).toBe("https://x.example/aspirin");

    const imm0 = entries.find((e) => e.kind === "Immunization");
    expect(imm0?.codeRef).toBe("https://x.example/mmr");

    const w0 = entries.find((e) => e.kind === "Workout");
    expect(w0?.typeLabel).toBe("Run");
    expect(w0?.value).toBe(5000);
    expect(w0?.unitCode).toBe("m");
    expect(w0?.date?.toISOString()).toBe("2026-06-14T06:00:00.000Z");
  });

  it("falls back to generic labels when subtype / activity / distance are absent", () => {
    const doc = emptyHealthDocument();
    // A workout with no activityType and no distance: label falls back, no unit.
    doc.mintWorkout("https://x.example/w");
    const w = listHealthEntries(doc).find((e) => e.kind === "Workout");
    expect(w?.typeLabel).toBe("Workout");
    expect(w?.value).toBeUndefined();
    expect(w?.unitCode).toBeUndefined();
  });

  it("returns undefined date for an observation with no effective time", () => {
    const doc = emptyHealthDocument();
    doc.mintObservation("https://x.example/o", "HeartRate"); // no effectiveTime set
    const o = listHealthEntries(doc).find((e) => e.kind === "Observation");
    expect(o?.date).toBeUndefined();
  });

  it("orders entries newest-first, with dateless rows last", () => {
    const doc = emptyHealthDocument();

    const older = doc.mintWorkout("https://x.example/older");
    older.startTime = new Date("2026-06-10T00:00:00Z");
    const newer = doc.mintWorkout("https://x.example/newer");
    newer.startTime = new Date("2026-06-20T00:00:00Z");
    // A dateless condition must sort after both dated workouts.
    doc.mintCondition("https://x.example/cond");

    const entries = listHealthEntries(doc);
    expect(entries.map((e) => e.iri)).toEqual([
      "https://x.example/newer",
      "https://x.example/older",
      "https://x.example/cond",
    ]);
  });

  it("tie-breaks two dateless entries deterministically by IRI", () => {
    const doc = emptyHealthDocument();
    doc.mintCondition("https://x.example/b");
    doc.mintCondition("https://x.example/a");
    const conditionIris = listHealthEntries(doc)
      .filter((e) => e.kind === "Condition")
      .map((e) => e.iri);
    expect(conditionIris).toEqual(["https://x.example/a", "https://x.example/b"]);
  });

  it("returns an empty list for an empty document", () => {
    expect(listHealthEntries(emptyHealthDocument())).toEqual([]);
  });
});
