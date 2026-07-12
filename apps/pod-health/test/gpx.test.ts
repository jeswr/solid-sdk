// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  gpxToWorkout,
  haversineMetres,
  parseGpxSegments,
  parseGpxTrackPoints,
  routeDistanceMetres,
} from "../src/gpx.js";
import { MULTI_SEGMENT_GPX, NOT_GPX, PARTIAL_GPX, SAMPLE_GPX, SPARSE_GPX } from "./fixtures.js";

describe("parseGpxTrackPoints", () => {
  it("parses three timed, elevated points in document order", () => {
    const pts = parseGpxTrackPoints(SAMPLE_GPX);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({
      lat: 51.5007,
      long: -0.1246,
      elevation: 12.0,
      time: new Date("2026-06-13T07:00:00Z"),
    });
    expect(pts[2]?.lat).toBe(51.5014);
  });

  it("parses a self-closing trkpt with no elevation or time", () => {
    const pts = parseGpxTrackPoints(SPARSE_GPX);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ lat: 40.0, long: -70.0 });
    expect(pts[0]?.elevation).toBeUndefined();
    expect(pts[0]?.time).toBeUndefined();
  });

  it("skips a trkpt missing a coordinate but keeps the good ones", () => {
    const pts = parseGpxTrackPoints(PARTIAL_GPX);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.lat)).toEqual([1.0, 4.0]);
    expect(pts[0]?.time).toEqual(new Date("2026-06-13T07:00:00Z"));
    // The last good point had no time child.
    expect(pts[1]?.time).toBeUndefined();
  });

  it("throws on a non-GPX document", () => {
    expect(() => parseGpxTrackPoints(NOT_GPX)).toThrow(/Not a GPX document/);
  });

  it("returns an empty array for a GPX with no track points", () => {
    const empty = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"></gpx>`;
    expect(parseGpxTrackPoints(empty)).toEqual([]);
  });

  it("ignores a trkpt whose lat/lon attribute is non-numeric", () => {
    const bad = `<gpx><trk><trkseg>
      <trkpt lat="north" lon="-0.1"/>
      <trkpt lat="51.5" lon="-0.1"/>
    </trkseg></trk></gpx>`;
    const pts = parseGpxTrackPoints(bad);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.lat).toBe(51.5);
  });

  it("reads single-quoted attributes", () => {
    const sq = `<gpx><trk><trkseg><trkpt lat='10' lon='20'/></trkseg></trk></gpx>`;
    expect(parseGpxTrackPoints(sq)).toEqual([{ lat: 10, long: 20 }]);
  });

  it("decodes XML entities in a time child and ignores invalid time/ele", () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="1" lon="2"><ele>not-a-number</ele><time>nonsense</time></trkpt>
    </trkseg></trk></gpx>`;
    const pts = parseGpxTrackPoints(gpx);
    expect(pts[0]).toEqual({ lat: 1, long: 2 });
  });

  it("treats an empty ele/time child as absent", () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="1" lon="2"><ele></ele><time>   </time></trkpt>
    </trkseg></trk></gpx>`;
    const pts = parseGpxTrackPoints(gpx);
    expect(pts[0]).toEqual({ lat: 1, long: 2 });
  });
});

describe("parseGpxSegments", () => {
  it("groups points by <trkseg>", () => {
    const segs = parseGpxSegments(MULTI_SEGMENT_GPX);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(2);
    expect(segs[0]?.[0]?.lat).toBe(51.5);
    expect(segs[1]?.[0]?.lat).toBe(48.8566);
  });

  it("returns loose track points as a single segment when there is no <trkseg>", () => {
    const noSeg = `<gpx version="1.1"><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></gpx>`;
    const segs = parseGpxSegments(noSeg);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(2);
  });

  it("returns no segments for a GPX with no track points", () => {
    expect(parseGpxSegments(`<gpx version="1.1"></gpx>`)).toEqual([]);
  });

  it("throws on a non-GPX document", () => {
    expect(() => parseGpxSegments(NOT_GPX)).toThrow(/Not a GPX document/);
  });

  it("flattens to the same points as parseGpxTrackPoints", () => {
    expect(parseGpxTrackPoints(MULTI_SEGMENT_GPX)).toEqual(
      parseGpxSegments(MULTI_SEGMENT_GPX).flat(),
    );
  });
});

describe("haversineMetres + routeDistanceMetres", () => {
  it("is zero for identical points", () => {
    expect(haversineMetres(51.5, -0.12, 51.5, -0.12)).toBeCloseTo(0, 6);
  });

  it("matches a known distance (London ~ Paris ≈ 343 km)", () => {
    const d = haversineMetres(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d / 1000).toBeGreaterThan(330);
    expect(d / 1000).toBeLessThan(355);
  });

  it("sums a route and returns 0 for fewer than two points", () => {
    expect(routeDistanceMetres([])).toBe(0);
    expect(routeDistanceMetres([{ lat: 1, long: 2 }])).toBe(0);
    const d = routeDistanceMetres([
      { lat: 51.5007, long: -0.1246 },
      { lat: 51.501, long: -0.125 },
      { lat: 51.5014, long: -0.1255 },
    ]);
    expect(d).toBeGreaterThan(0);
  });

  it("does NOT bridge the gap between two segments", () => {
    const segments = parseGpxSegments(MULTI_SEGMENT_GPX);
    // Each segment is two close London / Paris points (~111 m each leg); the
    // segmented distance is the sum of the two short legs, NOT the ~340 km gap.
    const segmented = routeDistanceMetres(segments);
    const flattened = routeDistanceMetres(segments.flat());
    expect(segmented).toBeLessThan(1000);
    // Flattening wrongly connects London→Paris, inflating distance by >300 km.
    expect(flattened).toBeGreaterThan(300_000);
    expect(flattened).toBeGreaterThan(segmented);
  });
});

describe("gpxToWorkout", () => {
  it("maps a GPX track to a typed Workout with an ordered route", () => {
    const { document, workout, points, trackPoints } = gpxToWorkout(SAMPLE_GPX, {
      workoutIri: "https://carol.example/health/workouts/run1",
      patient: "https://carol.example/profile/card#me",
      activityType: "Run",
    });

    expect(trackPoints).toHaveLength(3);
    expect(points).toHaveLength(3);
    expect(workout.patient).toBe("https://carol.example/profile/card#me");
    expect(workout.activityType).toBe("Run");
    expect(workout.startTime?.toISOString()).toBe("2026-06-13T07:00:00.000Z");
    expect(workout.endTime?.toISOString()).toBe("2026-06-13T07:01:00.000Z");
    expect(workout.distance).toBeGreaterThan(0);

    // The route reads back in sequence order, with the geo + elevation + time set.
    const ordered = document.orderedPoints(workout);
    expect(ordered.map((p) => p.sequence)).toEqual([0, 1, 2]);
    expect(ordered[0]?.lat).toBe(51.5007);
    expect(ordered[0]?.elevation).toBe(12.0);
    expect(ordered[2]?.value).toBe("https://carol.example/health/workouts/run1/point/2");

    // The workout aggregates exactly the three point IRIs.
    expect([...workout.points].sort()).toEqual([
      "https://carol.example/health/workouts/run1/point/0",
      "https://carol.example/health/workouts/run1/point/1",
      "https://carol.example/health/workouts/run1/point/2",
    ]);
  });

  it("defaults activityType to Run and omits patient / distance when absent", () => {
    const { workout } = gpxToWorkout(SPARSE_GPX, { workoutIri: "urn:w" });
    expect(workout.activityType).toBe("Run");
    expect(workout.patient).toBeUndefined();
    // A single point: no distance, and no start/end (the one point had no time).
    expect(workout.distance).toBeUndefined();
    expect(workout.startTime).toBeUndefined();
    expect(workout.endTime).toBeUndefined();
  });

  it("honours a custom pointIri factory", () => {
    const { workout } = gpxToWorkout(SAMPLE_GPX, {
      workoutIri: "urn:w",
      pointIri: (i) => `urn:pt-${i}`,
    });
    expect([...workout.points].sort()).toEqual(["urn:pt-0", "urn:pt-1", "urn:pt-2"]);
  });

  it("sets distance once there are at least two points", () => {
    const { workout } = gpxToWorkout(PARTIAL_GPX, { workoutIri: "urn:w" });
    // PARTIAL_GPX yields two valid points → a distance is computed.
    expect(workout.distance).toBeGreaterThan(0);
  });

  it("uses segment-aware distance for a multi-segment track", () => {
    const { workout, points } = gpxToWorkout(MULTI_SEGMENT_GPX, { workoutIri: "urn:w" });
    // All four points are written to the route, but distance ignores the gap.
    expect(points).toHaveLength(4);
    expect(workout.distance).toBeLessThan(1000);
  });
});
