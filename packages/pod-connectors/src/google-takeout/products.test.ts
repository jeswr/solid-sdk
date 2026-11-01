// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { SCHEMA } from "../core/vocab.js";
import { fitDocument, locationDocument } from "./products.js";

const ctx = { maxRows: 100, resolve: (slug: string) => `https://pod.test/takeout/${slug}` };
const values = (result: ReturnType<typeof locationDocument>, predicate: string) =>
  [...result.doc.dataset.match(null, DataFactory.namedNode(`${SCHEMA}${predicate}`), null)].map(
    (quad) => quad.object.value,
  );

describe("Takeout semantic visits", () => {
  it("handles old millisecond timestamps and omits invalid optional coordinates and text", () => {
    const duration = { startTimestampMs: "1781254800000", endTimestampMs: 1781258400000 };
    const raw = JSON.stringify({
      timelineObjects: [
        null,
        { activitySegment: {} },
        {
          placeVisit: {
            location: {
              placeId: "synthetic-place-1",
              name: 1,
              address: null,
              latitudeE7: null,
              longitudeE7: 1810000000,
            },
            duration,
          },
        },
        {
          placeVisit: {
            location: { placeId: "synthetic-place-2", latitudeE7: 910000000, longitudeE7: null },
            duration,
          },
        },
        { placeVisit: { duration: { startTimestamp: "invalid" } } },
        {
          placeVisit: {
            duration: { startTimestamp: "2026-06-12T09:00:00Z", endTimestamp: "invalid" },
          },
        },
      ],
    });
    const result = locationDocument(raw, "visits.ttl", ctx);
    expect(result.skipped).toBe(3);
    expect(values(result, "startTime")).toHaveLength(2);
    for (const predicate of ["latitude", "longitude", "name", "address"])
      expect(values(result, predicate)).toEqual([]);
    expect(() => locationDocument("null", "visits.ttl", ctx)).toThrow(/snapshot/);
    expect(() => locationDocument('{"timelineObjects":{}}', "visits.ttl", ctx)).toThrow(/snapshot/);
    expect(() => locationDocument(raw, "visits.ttl", { ...ctx, maxRows: 0 })).toThrow(/cap/);
  });

  const duration = {
    startTimestamp: "2026-06-12T09:00:00Z",
    endTimestamp: "2026-06-12T10:00:00Z",
  };
  const location = { name: "Synthetic park" };
  it.each([
    null,
    1,
    [],
    {},
    { activitySegment: null },
    { activitySegment: [] },
    { activitySegment: "invalid" },
    { placeVisit: null },
    { placeVisit: [] },
    { placeVisit: "invalid" },
    { placeVisit: {} },
    { placeVisit: {}, activitySegment: {} },
    { placeVisit: { duration } },
    { placeVisit: { location: null, duration } },
    { placeVisit: { location: [], duration } },
    { placeVisit: { location: {}, duration } },
    { placeVisit: { location: { name: 1, address: " " }, duration } },
    { placeVisit: { location, duration: null } },
    { placeVisit: { location, duration: [] } },
    { placeVisit: { location, duration: {} } },
    { placeVisit: { location, duration: { ...duration, startTimestamp: [2026] } } },
    { placeVisit: { location, duration: { ...duration, endTimestamp: "invalid" } } },
    {
      placeVisit: {
        location,
        duration: { ...duration, endTimestamp: "2026-06-12T08:00:00Z" },
      },
    },
  ])("counts a malformed location row as skipped: %#", (row) => {
    const result = locationDocument(JSON.stringify({ timelineObjects: [row] }), "visits.ttl", ctx);
    expect(result.skipped).toBe(1);
    expect(result.doc.dataset.size).toBe(0);
  });

  it("recognizes activity segments and visits located by coordinates alone", () => {
    const result = locationDocument(
      JSON.stringify({
        timelineObjects: [
          { activitySegment: {} },
          { placeVisit: { location: { latitudeE7: 0, longitudeE7: 0 }, duration } },
        ],
      }),
      "visits.ttl",
      ctx,
    );
    expect(result.skipped).toBe(0);
    expect(values(result, "startTime")).toHaveLength(1);
    expect(values(result, "latitude")).toEqual(["0"]);
    expect(values(result, "longitude")).toEqual(["0"]);
  });
});

describe("Takeout Fit aggregate validation", () => {
  it("counts invalid days and omits absent, non-numeric and negative aggregates", () => {
    const result = fitDocument(
      "Date,Step count,Distance (m),Calories (kcal),Heart Points,Move Minutes\ninvalid,1,1,1,1,1\n2026-02-30,1,1,1,1,1\n2026-06-12,-1,not-a-number,,Infinity,2",
      "fit.ttl",
      ctx,
    );
    expect(result.skipped).toBe(2);
    expect(values(result, "unitText")).toEqual(["min"]);
    expect(values(result, "value")).toEqual(["2"]);
    expect(fitDocument("Other\nmissing-date", "fit.ttl", ctx).skipped).toBe(1);
    expect(fitDocument("Date\n2026-06-12", "fit.ttl", ctx).skipped).toBe(0);
    expect(() => fitDocument("Date\n2026-06-12", "fit.ttl", { ...ctx, maxRows: 0 })).toThrow(/cap/);
  });
});
