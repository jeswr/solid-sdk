// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { assert, expect, it } from "vitest";
import { gpxToWorkout } from "../../src/apps/health/lib/model/gpx.js";
import { emptyHealthDocument, parseHealth } from "../../src/apps/health/lib/model/io.js";
import {
  addRecord,
  RecordDetails,
  type RecordKind,
  Reminder,
  records,
} from "../../src/apps/health/lib/model/records.js";
import { toTurtle } from "../../src/apps/health/lib/model/serialise.js";
import { WorkoutFile, workouts } from "../../src/apps/health/lib/model/workouts.js";
import { SAMPLE_GPX } from "./fixtures.js";

const iri = "https://pod.example/health/item#it";
const input = {
  iri,
  patient: "https://pod.example/profile#me",
  name: "Prescription",
  reference: "https://snomed.info/id/1",
  reminders: [{ iri: `${iri}-reminder`, at: new Date("2025-01-01Z") }],
};
it.each([
  "records",
  "conditions",
  "medications",
  "immunisations",
] as RecordKind[])("round-trips %s and reminders and replaces reminder links", async (kind) => {
  const document = emptyHealthDocument();
  addRecord(document, { ...input, kind, note: "With food" });
  const parsed = await parseHealth(await toTurtle(document), iri);
  const result = records(parsed, kind);
  expect(result).toHaveLength(1);
  expect(result[0]?.name).toBe(input.name);
  expect(result[0]?.note).toBe("With food");
  assert(result[0]);
  expect([...result[0].reminders]).toEqual([`${iri}-reminder`]);
  const reminder = new Reminder(`${iri}-reminder`, parsed, DataFactory);
  expect(reminder.at).toEqual(input.reminders[0]?.at);
  expect([...reminder.types]).toHaveLength(1);
  reminder.at = undefined;
  expect(reminder.at).toBeUndefined();
  addRecord(parsed, { ...input, kind, reminders: [] });
  expect(records(parsed, kind)[0]?.reminders.size).toBe(0);
  const details = new RecordDetails(iri, parsed, DataFactory);
  expect(details.note).toBeUndefined();
});
it("rejects invalid record fields before mutation", () => {
  for (const change of [
    { name: " " },
    { patient: "javascript:bad" },
    { reference: "relative" },
    { reminders: [{ iri: "relative", at: new Date() }] },
    { reminders: [{ iri: `${iri}-reminder`, at: new Date("bad") }] },
  ]) {
    const document = emptyHealthDocument();
    expect(() => addRecord(document, { ...input, kind: "medications", ...change })).toThrow();
    expect(document.size).toBe(0);
  }
});
it("round-trips GPX index, route ordering, source and file metadata", async () => {
  const { document } = gpxToWorkout(SAMPLE_GPX, { workoutIri: iri });
  const file = new WorkoutFile(iri, document, DataFactory);
  file.gpx = "https://pod.example/route.gpx";
  file.format = "application/gpx+xml";
  expect(file.format).toBe("application/gpx+xml");
  const parsed = await parseHealth(await toTurtle(document), iri);
  expect(workouts(parsed)[0]).toMatchObject({
    iri,
    activity: "Run",
    start: new Date("2026-06-13T07:00Z"),
    gpx: file.gpx,
  });
  const workout = [...parsed.workouts][0];
  assert(workout);
  expect(parsed.orderedPoints(workout)).toHaveLength(3);
  file.gpx = undefined;
  file.format = undefined;
  expect(file.gpx).toBeUndefined();
  expect(file.format).toBeUndefined();
});
it("reads connector ExerciseAction variants, missing/invalid dates and avoids duplicate dual types", async () => {
  const document = await parseHealth(
    `@prefix s: <http://schema.org/>. @prefix ph: <https://jeswr.org/ns/pod-health#>.
    <#a> a s:ExerciseAction; s:name "Morning run"; s:exerciseType "Running"; s:startTime "2025-01-01T08:00Z"; s:endTime "2025-01-01T09:00Z"; s:distance "5 km".
    <#b> a s:ExerciseAction; s:startTime "invalid".
    <#c> a s:ExerciseAction, ph:Workout.
  `,
    "https://pod.example/index.ttl",
  );
  const result = workouts(document);
  expect(result).toHaveLength(3);
  expect(result.find((entry) => entry.iri.endsWith("#a"))).toMatchObject({
    name: "Morning run",
    activity: "Running",
    distance: "5 km",
    start: new Date("2025-01-01T08:00Z"),
    end: new Date("2025-01-01T09:00Z"),
  });
  expect(result.find((entry) => entry.iri.endsWith("#b"))?.start).toBeUndefined();
});
