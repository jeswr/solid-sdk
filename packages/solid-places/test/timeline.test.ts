// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TYPES,
  coordinates,
  haversine,
  IMPORT_LIMITS,
  parseGoogleTimeline,
} from "../src/timeline.js";

const startTime = "2026-11-11T09:00:00Z",
  endTime = "2026-11-11T10:00:00Z";
const modernVisit = (latLng = "50.1°, -1.2°", placeId: unknown = "google-1") => ({
  startTime,
  endTime,
  visit: {
    topCandidate: { placeId, placeName: "Fern café", probability: 0.9, placeLocation: { latLng } },
  },
});
const modernActivity = (type: unknown = "WALKING") => ({
  startTime,
  endTime,
  activity: {
    start: { latLng: "50.1, -1.2" },
    end: { latLng: "50.11, -1.21" },
    topCandidate: { type },
    distanceMeters: "1500",
  },
});
const parse = (semanticSegments: unknown[]) =>
  parseGoogleTimeline(JSON.stringify({ semanticSegments }));
describe("Google Timeline exports", () => {
  it("deduplicates modern places, visits and journeys deterministically", () => {
    const rows = [modernVisit(), modernVisit(), modernActivity(), modernActivity()];
    const result = parse(rows);
    expect(result.places).toHaveLength(1);
    expect(result.visits).toHaveLength(1);
    expect(result.journeys).toHaveLength(1);
    expect(result.places[0]?.data).toMatchObject({
      name: "Fern café",
      latitude: 50.1,
      longitude: -1.2,
      saved: false,
      category: "other",
    });
    expect(result.visits[0]?.data.confidence).toBe(0.9);
    expect(result.journeys[0]?.data.distance).toBe(1500);
    expect(parse([...rows].reverse())).toEqual(result);
  });
  it("rounds unnamed identifiers to five decimals and folds names", () => {
    const result = parse([
      modernVisit("50.1000001,-1.2000001", null),
      modernVisit("50.1000002,-1.2000002", null),
    ]);
    expect(result.places).toHaveLength(1);
    expect(result.visits[0]?.placeId).toBe(result.places[0]?.id);
    expect(result.places[0]?.data.externalId).toBeUndefined();
  });
  it("reads old Semantic Location History with E7 and timestampMs", () => {
    const duration = {
      startTimestampMs: String(Date.parse(startTime)),
      endTimestampMs: String(Date.parse(endTime)),
    };
    const result = parseGoogleTimeline(
      JSON.stringify({
        timelineObjects: [
          {
            placeVisit: {
              duration,
              location: {
                latitudeE7: 501000000,
                longitudeE7: -12000000,
                name: "The library",
                address: "Fictional square",
                placeId: "old",
              },
              visitConfidence: 2,
            },
          },
          {
            activitySegment: {
              duration,
              startLocation: { latitudeE7: 501000000, longitudeE7: -12000000 },
              endLocation: { latitudeE7: 501100000, longitudeE7: -12100000 },
              activityType: "IN_TRAIN",
              distance: 2000,
            },
          },
        ],
      }),
    );
    expect(result.places[0]?.data.address).toBe("Fictional square");
    expect(result.places[0]?.data.latitude).toBe(50.1);
    expect(result.visits[0]?.data.confidence).toBeUndefined();
    expect(result.journeys[0]?.data.activityType).toBe("train");
  });
  it("reads timestamp-based old durations and unnamed places", () => {
    const result = parseGoogleTimeline(
      JSON.stringify({
        timelineObjects: [
          {
            placeVisit: {
              duration: { startTimestamp: startTime, endTimestamp: endTime },
              location: { latE7: 0, lngE7: 0 },
            },
          },
        ],
      }),
    );
    expect(result.places[0]?.data.name).toBe("Unnamed place");
    expect(result.visits).toHaveLength(1);
  });
  it("reads timelinePath alone and ignores invalid intermediate points", () => {
    const result = parse([
      {
        startTime,
        endTime,
        timelinePath: [
          { point: "geo:50,-1" },
          { point: "oops" },
          { latLng: "50.01,-1.01" },
          { point: "geo:50.02,-1" },
        ],
      },
    ]);
    expect(result.journeys[0]?.data).toMatchObject({
      activityType: "other",
      startLatitude: 50,
      endLatitude: 50.02,
    });
    expect(result.journeys[0]!.data.distance).toBeGreaterThan(haversine([50, -1], [50.02, -1]));
  });
  it("uses haversine when a supplied distance is negative, nonnumeric or oversized", () => {
    for (const distanceMeters of [-1, "oops", 1e12, null]) {
      const row = modernActivity();
      Object.assign(row.activity, { distanceMeters });
      expect(parse([row]).journeys[0]!.data.distance).toBeCloseTo(
        haversine([50.1, -1.2], [50.11, -1.21]),
      );
    }
  });
  const modes: Record<string, string> = {
    WALKING: "walking",
    ON_FOOT: "walking",
    CYCLING: "cycling",
    BICYCLING: "cycling",
    RUNNING: "running",
    IN_CAR: "driving",
    IN_PASSENGER_VEHICLE: "driving",
    IN_TRAIN: "train",
    IN_SUBWAY: "train",
    IN_BUS: "bus",
    FLYING: "flight",
    IN_FERRY: "ferry",
    UNKNOWN: "other",
  };
  it.each(Object.entries(modes))("maps %s to %s", (input, expected) =>
    expect(parse([modernActivity(input)]).journeys[0]?.data.activityType).toBe(expected));
  it.each(ACTIVITY_TYPES)("accepts canonical activity %s", (mode) =>
    expect(parse([modernActivity(mode)]).journeys[0]?.data.activityType).toBe(mode));
  it.each([
    null,
    [],
    42,
    "bad",
    {},
    { startTime, endTime },
    modernVisit("91,0"),
    modernVisit("0,-181"),
    modernVisit("nan,0"),
    modernVisit("1"),
    modernVisit(" "),
    { ...modernActivity(), endTime: "2026-11-10T10:00:00Z" },
    { ...modernActivity(), startTime: "2026-02-30T00:00:00Z" },
    { ...modernActivity(), startTime: "2026-11-11T09:00:00" },
    { ...modernActivity(), startTime: "not-a-date" },
    { ...modernActivity(), endTime: "2026-99-11T10:00:00Z" },
  ])("skips invalid row %#", (row) => expect(parse([row]).skipped).toBe(1));
  it("bounds date strings, coordinate strings and unsupported numbers", () => {
    expect(
      parse([
        { ...modernVisit(), startTime: "x".repeat(65) },
        modernVisit("1".repeat(129)),
        modernVisit("Infinity, 0"),
        {
          startTime,
          endTime,
          activity: {
            startLocation: { latitudeE7: true, longitudeE7: 0 },
            endLocation: { latitudeE7: 0, longitudeE7: 0 },
          },
        },
      ]).skipped,
    ).toBe(4);
  });
  it.each([
    "{",
    "null",
    "[]",
    "{}",
    '{"semanticSegments":{}}',
  ])("rejects invalid/unsupported document %s", (value) =>
    expect(() => parseGoogleTimeline(value)).toThrow());
  it("accepts an empty recognised export", () =>
    expect(parse([])).toEqual({ places: [], visits: [], journeys: [], skipped: 0 }));
  it("caps input bytes, record counts and path counts", () => {
    expect(() => parseGoogleTimeline(" ".repeat(IMPORT_LIMITS.bytes + 1))).toThrow(RangeError);
    expect(() => parseGoogleTimeline('"' + "💚".repeat(IMPORT_LIMITS.bytes / 4) + '"')).toThrow(
      RangeError,
    );
    expect(() => parse(Array(IMPORT_LIMITS.records + 1).fill(null))).toThrow(RangeError);
    expect(() =>
      parse([{ startTime, endTime, timelinePath: Array(IMPORT_LIMITS.points + 1).fill(null) }]),
    ).toThrow(RangeError);
  });
});
describe("distance", () => {
  it("covers zero, poles, antipodes and a known equatorial arc", () => {
    expect(haversine([0, 0], [0, 0])).toBe(0);
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111194.9266, 3);
    expect(haversine([90, 0], [-90, 0])).toBeCloseTo(Math.PI * 6371000);
  });
  it.each([
    [NaN, 0],
    [0, Infinity],
    [91, 0],
    [0, -181],
  ])("refuses invalid coordinates %#", (a, b) =>
    expect(() => coordinates(a, b)).toThrow(TypeError));
});
it("accepts string activity endpoints and rejects invalid millisecond instants", () => {
  const row = modernActivity();
  const parsed = parse([
    { ...row, activity: { ...row.activity, start: "geo:50.1,-1.2", end: "50.11,-1.21" } },
  ]);
  expect(parsed.journeys).toHaveLength(1);
  for (const startTimestampMs of [1e100, Date.parse("0000-01-01T00:00:00Z"), 253402300800000]) {
    const result = parseGoogleTimeline(
      JSON.stringify({
        timelineObjects: [
          {
            placeVisit: {
              duration: { startTimestampMs, endTimestampMs: Date.parse(endTime) },
              location: { latitudeE7: 0, longitudeE7: 0 },
            },
          },
        ],
      }),
    );
    expect(result.skipped).toBe(1);
  }
});
it("accepts exact import budgets and rejects unsupported year/time values", () => {
  const empty = '{"semanticSegments":[]}';
  expect(parseGoogleTimeline(empty + " ".repeat(IMPORT_LIMITS.bytes - empty.length)).skipped).toBe(
    0,
  );
  expect(parse(Array(IMPORT_LIMITS.records).fill(null)).skipped).toBe(IMPORT_LIMITS.records);
  expect(
    parse([{ startTime, endTime, timelinePath: Array(IMPORT_LIMITS.points).fill(null) }]).skipped,
  ).toBe(1);
  for (const value of ["0000-01-01T00:00:00Z", "2026-11-11T99:00:00Z"])
    expect(parse([{ ...modernVisit(), startTime: value }]).skipped).toBe(1);
  expect(
    parseGoogleTimeline(
      JSON.stringify({
        timelineObjects: [
          { placeVisit: { duration: { startTimestampMs: "Infinity", endTimestampMs: "1" } } },
        ],
      }),
    ).skipped,
  ).toBe(1);
});
it("never merges distinct overlong identifiers or names by truncation", () => {
  const name = modernVisit();
  name.visit.topCandidate.placeName = "n".repeat(257);
  const result = parse([
    name,
    modernVisit("50,-1", "x".repeat(256) + "a"),
    modernVisit("50,-1", "x".repeat(256) + "b"),
  ]);
  expect(result.skipped).toBe(3);
  expect(result.places).toEqual([]);
  name.visit.topCandidate.placeName = "n".repeat(256);
  expect(parse([name]).places[0]?.data.name).toHaveLength(256);
});
it("treats prototype property names as unknown modes and preserves confidence boundaries", () => {
  expect(parse([modernActivity("constructor")]).journeys[0]?.data.activityType).toBe("other");
  for (const probability of [-1, 0, 1, 2]) {
    const visit = modernVisit();
    visit.visit.topCandidate.probability = probability;
    expect(parse([visit]).visits[0]?.data.confidence).toBe(
      probability >= 0 && probability <= 1 ? probability : undefined,
    );
  }
});
