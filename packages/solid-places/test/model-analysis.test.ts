// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import {
  dayBounds,
  groupByDay,
  mapLinks,
  periodBounds,
  periodStats,
  placeVisitIndex,
  timelineForDay,
} from "../src/analysis.js";
import {
  entities,
  type JourneyData,
  type PlaceData,
  type PlacesSnapshot,
  serializeRecord,
  type VisitData,
} from "../src/model.js";

const place: PlaceData = {
  name: "Park",
  latitude: 0,
  longitude: 0,
  category: "outdoors",
  saved: true,
};
const url = "https://pod.example/places/p.ttl";
const visit: VisitData = {
  place: entities.Place.subject(url),
  startTime: new Date("2026-10-31T23:00:00Z"),
  endTime: new Date("2026-11-01T01:00:00Z"),
  source: "manual",
  notes: "A walk",
};
const journey: JourneyData = {
  startLatitude: 0,
  startLongitude: 0,
  endLatitude: 0,
  endLongitude: 1,
  startTime: visit.startTime,
  endTime: visit.endTime,
  activityType: "walking",
  distance: 2000,
  source: "manual",
};
const snapshot: PlacesSnapshot = {
  places: [{ url, etag: '"1"', data: place }],
  visits: [{ url: `${url}-v`, etag: null, data: visit }],
  journeys: [{ url: `${url}-j`, etag: null, data: journey }],
};
it("round trips every generated entity and rejects invalid writes", async () => {
  for (const [kind, data] of [
    ["Place", place],
    ["Visit", visit],
    ["Journey", journey],
  ] as const) {
    const body =
      kind === "Place"
        ? await serializeRecord(kind, url, data)
        : kind === "Visit"
          ? await serializeRecord(kind, url, data)
          : await serializeRecord(kind, url, data);
    expect(await entities[kind].parseDocument(url, body)).toEqual(data);
  }
  await expect(serializeRecord("Place", url, { ...place, latitude: 91 })).rejects.toThrow(
    "Invalid place",
  );
  await expect(serializeRecord("Visit", url, { ...visit, place: "javascript:x" })).rejects.toThrow(
    "Invalid visit",
  );
  await expect(serializeRecord("Visit", url, { ...visit, endTime: new Date(0) })).rejects.toThrow(
    "End must follow start",
  );
  await expect(serializeRecord("Journey", url, { ...journey, distance: -1 })).rejects.toThrow(
    "Invalid journey",
  );
});
it("groups starts by UTC day, includes midnight overlaps in daily views and indexes visits", () => {
  expect([...groupByDay(snapshot).keys()]).toEqual(["2026-10-31"]);
  expect(timelineForDay(snapshot, "2026-11-01")).toHaveLength(2);
  expect(timelineForDay(snapshot, "2026-11-02")).toEqual([]);
  expect(timelineForDay(snapshot, "2026-10-31")[0]?.kind).toBe("journey");
  expect(
    placeVisitIndex({ ...snapshot, visits: [...snapshot.visits, ...snapshot.visits] }).get(
      visit.place,
    ),
  ).toEqual({ count: 2, last: visit.startTime });
});
it("uses half-open UTC periods and prorates distance across boundaries", () => {
  expect(periodStats(snapshot, periodBounds("2026-11"))).toEqual({
    placesVisited: 1,
    visits: 1,
    distanceByMode: { walking: 1000 },
  });
  expect(periodBounds("2026").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  expect(periodBounds("2026-12").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  expect(periodStats(snapshot, periodBounds("2027"))).toEqual({
    placesVisited: 0,
    visits: 0,
    distanceByMode: {},
  });
  expect(() => periodStats(snapshot, { start: new Date(2), end: new Date(1) })).toThrow();
  const instant = {
    ...journey,
    startTime: new Date("2026-11-01T00:00:00Z"),
    endTime: new Date("2026-11-01T00:00:00Z"),
  };
  expect(
    periodStats(
      { ...snapshot, journeys: [{ url, etag: null, data: instant }] },
      periodBounds("2026-11"),
    ).distanceByMode.walking,
  ).toBe(2000);
});
it.each(["x", "2026-13", "2026-00", "0099", "2026-1"])("refuses invalid period %s", (v) =>
  expect(() => periodBounds(v)).toThrow());
it.each(["x", "2026-02-30", "2026-13-01"])("refuses invalid day %s", (v) =>
  expect(() => dayBounds(v)).toThrow());
it("builds only coordinate-based OSM links", () => {
  expect(mapLinks(0, 0).open).toContain("mlat=0&mlon=0");
  expect(mapLinks(90, 180).embed).toContain("180%2C90");
  expect(() => mapLinks(NaN, 0)).toThrow();
  expect(() => mapLinks(0, 181)).toThrow();
});
it("keeps the latest visit independent of input order and includes instantaneous check-ins", () => {
  const earlier = {
    ...snapshot.visits[0]!,
    url: url + "earlier",
    data: {
      ...visit,
      startTime: new Date("2026-10-01T00:00:00Z"),
      endTime: new Date("2026-10-01T01:00:00Z"),
    },
  };
  expect(
    placeVisitIndex({ ...snapshot, visits: [...snapshot.visits, earlier] }).get(visit.place)?.last,
  ).toEqual(visit.startTime);
  const instant = {
    ...snapshot.visits[0]!,
    data: {
      ...visit,
      startTime: new Date("2026-11-01T00:00:00Z"),
      endTime: new Date("2026-11-01T00:00:00Z"),
    },
  };
  expect(
    timelineForDay({ ...snapshot, visits: [instant], journeys: [] }, "2026-11-01"),
  ).toHaveLength(1);
  expect(
    timelineForDay(
      { ...snapshot, visits: [earlier, ...snapshot.visits], journeys: [] },
      "2026-10-31",
    ),
  ).toHaveLength(1);
});

it("writes only canonical HTTPS schema.org terms", async () => {
  const body = await serializeRecord("Place", url, place);
  expect(entities.Place.typeIri).toBe("https://schema.org/Place");
  expect(body).toContain("https://schema.org/");
  expect(body).not.toContain("http://schema.org/");
});
it("groups browser-local days and periods across UTC boundaries and DST", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const local = {
      ...snapshot,
      visits: [
        {
          ...snapshot.visits[0]!,
          data: {
            ...visit,
            startTime: new Date("2026-11-01T01:00:00Z"),
            endTime: new Date("2026-11-01T02:00:00Z"),
          },
        },
      ],
      journeys: [],
    };
    expect([...groupByDay(local).keys()]).toEqual(["2026-10-31"]);
    expect(timelineForDay(local, "2026-10-31")).toHaveLength(1);
    expect(timelineForDay(local, "2026-11-01")).toHaveLength(0);
    expect(periodStats(local, periodBounds("2026-10")).visits).toBe(1);
    expect(dayBounds("2026-11-01").start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(+dayBounds("2026-11-01").end - +dayBounds("2026-11-01").start).toBe(25 * 3600000);
    expect(+dayBounds("2026-03-08").end - +dayBounds("2026-03-08").start).toBe(23 * 3600000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

it("reads supported legacy schema.org aliases through the generated model and writes HTTPS", async () => {
  const legacy = (await serializeRecord("Place", url, place)).replaceAll(
    "https://schema.org/",
    "http://schema.org/",
  );
  expect(await entities.Place.parseDocument(url, legacy)).toEqual(place);
  // Shared-predicate read aliases cannot be admitted by this generator version.
  const oldVisit = (await serializeRecord("Visit", url, visit)).replaceAll(
    "https://schema.org/",
    "http://schema.org/",
  );
  expect(await entities.Visit.parseDocument(url, oldVisit)).toBeUndefined();
});
