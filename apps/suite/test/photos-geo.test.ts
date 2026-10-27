// AUTHORED-BY Codex GPT-6.1-Sol

import { describe, expect, it } from "vitest";
import {
  clusterPoints,
  createCoordinate,
  type ExifDms,
  type ExifGps,
  formatDecimal,
  formatDms,
  fromExifGps,
  type GeoCoordinate,
  GeoError,
  type GeoErrorCode,
  type GeoPoint,
  haversineDistance,
  MAX_CLUSTER_POINTS,
  MAX_CLUSTER_ZOOM,
  MEAN_EARTH_RADIUS_METRES,
  MERCATOR_MAX_LATITUDE,
  MIN_CLUSTER_ZOOM,
  toGeoUri,
  toOpenStreetMapUrl,
} from "../src/apps/photos/lib/geo";

function fails(action: () => unknown, code: GeoErrorCode): void {
  expect(action).toThrow(GeoError);
  expect(action).toThrow(
    expect.objectContaining({ name: "GeoError", code, message: `Photo geo: ${code}` }),
  );
}

const exif: ExifGps = {
  latitude: [
    [51, 1],
    [30, 1],
    [264, 10],
  ],
  latitudeRef: "N",
  longitude: [
    [0, 1],
    [7, 1],
    [396, 10],
  ],
  longitudeRef: "W",
};
const origin = createCoordinate(0, 0);
const point = (id: string, latitude: number, longitude: number): GeoPoint => ({
  id: `https://example.org/photos/${id}`,
  latitude,
  longitude,
});

describe("EXIF rational coordinates", () => {
  it("converts each hemisphere and fractional rationals without mutating tags", () => {
    const snapshot = structuredClone(exif);
    for (const latitudeRef of ["N", "S"] as const) {
      for (const longitudeRef of ["E", "W"] as const) {
        const coordinate: GeoCoordinate = fromExifGps({ ...exif, latitudeRef, longitudeRef });
        expect(coordinate.latitude).toBeCloseTo((latitudeRef === "N" ? 1 : -1) * 51.5073333333, 9);
        expect(coordinate.longitude).toBeCloseTo((longitudeRef === "E" ? 1 : -1) * 0.1276666667, 9);
        expect(coordinate.suspicious).toBe(false);
      }
    }
    expect(exif).toEqual(snapshot);
  });

  it("accepts exact geographic bounds and flags zero even with S/W references", () => {
    const zero: ExifDms = [
      [0, 1],
      [0, 1],
      [0, 1],
    ];
    expect(
      fromExifGps({ latitude: zero, latitudeRef: "S", longitude: zero, longitudeRef: "W" }),
    ).toEqual(origin);
    for (const latitudeRef of ["N", "S"] as const) {
      for (const longitudeRef of ["E", "W"] as const) {
        expect(
          fromExifGps({
            latitude: [
              [90, 1],
              [0, 1],
              [0, 1],
            ],
            latitudeRef,
            longitude: [
              [180, 1],
              [0, 1],
              [0, 1],
            ],
            longitudeRef,
          }),
        ).toEqual(
          createCoordinate(latitudeRef === "N" ? 90 : -90, longitudeRef === "E" ? 180 : -180),
        );
      }
    }
    expect(
      fromExifGps({
        ...exif,
        latitude: [
          [0, 1],
          [0, 1],
          [1, 1],
        ],
      }).suspicious,
    ).toBe(false);
  });

  it.each([
    null,
    undefined,
    "gps",
    [],
    {},
    { ...exif, latitudeRef: "E" },
    { ...exif, latitudeRef: "n" },
    { ...exif, longitudeRef: "N" },
    { ...exif, longitudeRef: "w" },
  ])("rejects malformed tags and axis references %j", (value) => {
    fails(() => fromExifGps(value), "INVALID_COORDINATE");
  });

  it.each([
    null,
    {},
    "51,30,26.4",
    [],
    [[0, 1]],
    [
      [0, 1],
      [0, 1],
    ],
    [
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ],
    Array(3),
  ])("rejects malformed DMS triples %j", (value) => {
    fails(() => fromExifGps({ ...exif, latitude: value }), "INVALID_COORDINATE");
    fails(() => fromExifGps({ ...exif, longitude: value }), "INVALID_COORDINATE");
  });

  it.each([
    null,
    {},
    "1/2",
    1,
    [],
    [1],
    [1, 1, 1],
    [1, 0],
    [1, -1],
    [-1, 1],
    [NaN, 1],
    [1, NaN],
    [Infinity, 1],
    [1, Infinity],
    [1.5, 1],
    [1, 1.5],
    ["1", 1],
    [1, "1"],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [1, Number.MAX_SAFE_INTEGER + 1],
    Array(2),
  ])("rejects malformed/unsafe unsigned rationals %j at every position", (value) => {
    for (const axis of ["latitude", "longitude"]) {
      for (let component = 0; component < 3; component++) {
        const triple = [
          [0, 1],
          [0, 1],
          [0, 1],
        ];
        const invalidTriple: unknown[] = triple;
        invalidTriple[component] = value;
        fails(() => fromExifGps({ ...exif, [axis]: invalidTriple }), "INVALID_COORDINATE");
      }
    }
  });

  it("accepts sexagesimal values below 60 and rejects 60 without normalizing", () => {
    for (const axis of ["latitude", "longitude"]) {
      for (const index of [1, 2]) {
        const triple = [
          [0, 1],
          [0, 1],
          [0, 1],
        ];
        triple[index] = [599999, 10000];
        expect(fromExifGps({ ...exif, [axis]: triple }).suspicious).toBe(false);
        for (const invalid of [
          [60, 1],
          [120, 2],
          [601, 10],
        ]) {
          triple[index] = invalid;
          fails(() => fromExifGps({ ...exif, [axis]: triple }), "INVALID_COORDINATE");
        }
      }
    }
  });

  it("validates the entire DMS sum against the geographic bounds", () => {
    for (const latitude of [
      [
        [91, 1],
        [0, 1],
        [0, 1],
      ],
      [
        [90, 1],
        [0, 1],
        [1, 1],
      ],
    ]) {
      fails(() => fromExifGps({ ...exif, latitude }), "INVALID_COORDINATE");
    }
    for (const longitude of [
      [
        [181, 1],
        [0, 1],
        [0, 1],
      ],
      [
        [180, 1],
        [1, 1],
        [0, 1],
      ],
    ]) {
      fails(() => fromExifGps({ ...exif, longitude }), "INVALID_COORDINATE");
    }
    expect(
      fromExifGps({
        ...exif,
        latitude: [
          [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
          [0, 1],
          [0, 1],
        ],
      }).latitude,
    ).toBe(1);
  });

  it("rejects an exact rational sum beyond a bound even when floating-point addition hides it", () => {
    for (const [axis, bound] of [
      ["latitude", 90],
      ["longitude", 180],
    ] as const) {
      fails(
        () =>
          fromExifGps({
            ...exif,
            [axis]: [
              [bound, 1],
              [0, 1],
              [1, Number.MAX_SAFE_INTEGER],
            ],
          }),
        "INVALID_COORDINATE",
      );
      const atBound = fromExifGps({
        ...exif,
        [axis]: [
          [(bound * 2 - 1) * 1000003, 2000006],
          [30000990, 1000033],
          [0, 1000037],
        ],
      });
      expect(Math.abs(atBound[axis])).toBe(bound);
    }
  });
});

describe("coordinate validation, formatting and links", () => {
  it("flags only (0,0), normalizes negative zero, and accepts all closed bounds", () => {
    expect(createCoordinate(-0, -0)).toEqual({ latitude: 0, longitude: 0, suspicious: true });
    expect(Object.is(createCoordinate(-0, -0).latitude, -0)).toBe(false);
    expect(Object.is(createCoordinate(-0, -0).longitude, -0)).toBe(false);
    for (const latitude of [-90, 90])
      for (const longitude of [-180, 180]) {
        expect(createCoordinate(latitude, longitude)).toEqual({
          latitude,
          longitude,
          suspicious: false,
        });
      }
    expect(createCoordinate(0, 1).suspicious).toBe(false);
    expect(createCoordinate(1, 0).suspicious).toBe(false);
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    "0",
    null,
    undefined,
    {},
    91,
    -91,
    90.000001,
    -90.000001,
  ])("rejects invalid latitude %j", (latitude) => {
    fails(() => createCoordinate(latitude, 0), "INVALID_COORDINATE");
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    "0",
    null,
    undefined,
    {},
    181,
    -181,
    180.000001,
    -180.000001,
  ])("rejects invalid longitude %j", (longitude) => {
    fails(() => createCoordinate(0, longitude), "INVALID_COORDINATE");
  });

  it("formats six decimal places and one decimal second with hemisphere signs", () => {
    const value = fromExifGps(exif);
    expect(formatDecimal(value)).toBe("51.507333, -0.127667");
    expect(formatDms(value)).toBe("51°30′26.4″N, 0°7′39.6″W");
    expect(formatDms(createCoordinate(-51.5073333333, 0.1276666667))).toBe(
      "51°30′26.4″S, 0°7′39.6″E",
    );
    expect(formatDecimal(origin)).toBe("0.000000, 0.000000");
    expect(formatDms(origin)).toBe("0°0′0.0″N, 0°0′0.0″E");
    expect(formatDecimal(createCoordinate(-1e-10, 1e-10))).toBe("0.000000, 0.000000");
  });

  it("carries rounded seconds and minutes without producing 60 or crossing legal bounds", () => {
    expect(
      formatDms(createCoordinate(12 + 34 / 60 + 59.96 / 3600, -12 - 59 / 60 - 59.96 / 3600)),
    ).toBe("12°35′0.0″N, 13°0′0.0″W");
    expect(formatDms(createCoordinate(89.99999999, -179.99999999))).toBe("90°0′0.0″N, 180°0′0.0″W");
    expect(formatDms(createCoordinate(-90, 180))).toBe("90°0′0.0″S, 180°0′0.0″E");
  });

  it("builds only RFC 5870 and OpenStreetMap links, with stable order and no coordinate clamping", () => {
    const value = fromExifGps(exif);
    expect(toGeoUri(value)).toBe("geo:51.507333,-0.127667");
    expect(toOpenStreetMapUrl(value)).toBe(
      "https://www.openstreetmap.org/?mlat=51.507333&mlon=-0.127667#map=16/51.507333/-0.127667",
    );
    expect(toGeoUri(origin)).toBe("geo:0.000000,0.000000");
    expect(toGeoUri(createCoordinate(90, 180))).toBe("geo:90.000000,180.000000");
    expect(toGeoUri(createCoordinate(-1e-10, -180))).toBe("geo:0.000000,-180.000000");
    const url = new URL(toOpenStreetMapUrl(createCoordinate(-90, -180)));
    expect(url.origin).toBe("https://www.openstreetmap.org");
    expect([...url.searchParams]).toEqual([
      ["mlat", "-90.000000"],
      ["mlon", "-180.000000"],
    ]);
    expect(url.hash).toBe("#map=16/-90.000000/-180.000000");
  });

  it.each([
    null,
    undefined,
    "coordinate",
    [],
    {},
    { latitude: 0 },
    { longitude: 0 },
    { latitude: "0", longitude: 0 },
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
  ])("fails closed across every coordinate consumer %j", (value) => {
    for (const consume of [formatDecimal, formatDms, toGeoUri, toOpenStreetMapUrl])
      fails(() => consume(value), "INVALID_COORDINATE");
    fails(() => haversineDistance(value, origin), "INVALID_COORDINATE");
    fails(() => haversineDistance(origin, value), "INVALID_COORDINATE");
  });
});

describe("mean-radius haversine distance", () => {
  it("returns zero for identical coordinates and the expected quarter/half circumferences", () => {
    expect(MEAN_EARTH_RADIUS_METRES).toBe(6371008.8);
    expect(haversineDistance(origin, origin)).toBe(0);
    expect(haversineDistance(origin, createCoordinate(0, 90))).toBeCloseTo(
      (Math.PI * MEAN_EARTH_RADIUS_METRES) / 2,
      7,
    );
    expect(haversineDistance(origin, createCoordinate(0, 180))).toBeCloseTo(
      Math.PI * MEAN_EARTH_RADIUS_METRES,
      7,
    );
    expect(haversineDistance(createCoordinate(-90, 0), createCoordinate(90, 120))).toBeCloseTo(
      Math.PI * MEAN_EARTH_RADIUS_METRES,
      7,
    );
  });

  it("handles short, non-equatorial, date-line, and near-antipodal distances symmetrically", () => {
    expect(haversineDistance(createCoordinate(0, -180), createCoordinate(0, 180))).toBeCloseTo(
      0,
      6,
    );
    expect(haversineDistance(origin, createCoordinate(0, 0.000001))).toBeCloseTo(0.1111950802, 9);
    expect(haversineDistance(createCoordinate(0, 179), createCoordinate(0, -179))).toBeCloseTo(
      222390.160467,
      6,
    );
    expect(haversineDistance(createCoordinate(60, 0), createCoordinate(60, 90))).toBeCloseTo(
      4604546.25288065,
      6,
    );
    for (const [a, b] of [
      [createCoordinate(20, 30), createCoordinate(-20.00000001, -150)],
      [createCoordinate(51, -1), createCoordinate(-33, 151)],
    ]) {
      const distance = haversineDistance(a, b);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeLessThanOrEqual(Math.PI * MEAN_EARTH_RADIUS_METRES);
      expect(distance).toBeCloseTo(haversineDistance(b, a), 6);
    }
  });
});

describe("Web Mercator grid clustering", () => {
  it("accepts empty input and every integer zoom including both limits", () => {
    expect(MIN_CLUSTER_ZOOM).toBe(0);
    expect(MAX_CLUSTER_ZOOM).toBe(20);
    for (let zoom = MIN_CLUSTER_ZOOM; zoom <= MAX_CLUSTER_ZOOM; zoom++) {
      expect(clusterPoints([], zoom)).toEqual([]);
      const a = point("a", 90, 180);
      expect(clusterPoints([a], zoom)).toEqual([
        { count: 1, centroid: createCoordinate(90, 180), memberIds: [a.id] },
      ]);
    }
  });

  it("groups by tile, sorts by count descending then tile key, and preserves member order", () => {
    const a = point("a", 5, 5);
    const b = point("b", 15, 15);
    const northWest = point("nw", 10, -10);
    const southWest = point("sw", -10, -10);
    const southEast = point("se", -10, 10);
    const points = [southEast, b, southWest, northWest, a];
    const snapshot = structuredClone(points);
    expect(clusterPoints(points, 1)).toEqual([
      { count: 2, centroid: createCoordinate(10, 10), memberIds: [b.id, a.id] },
      { count: 1, centroid: createCoordinate(10, -10), memberIds: [northWest.id] },
      { count: 1, centroid: createCoordinate(-10, -10), memberIds: [southWest.id] },
      { count: 1, centroid: createCoordinate(-10, 10), memberIds: [southEast.id] },
    ]);
    expect(points).toEqual(snapshot);
  });

  it("uses ASCII keys rather than numeric column ordering at zoom 4", () => {
    const column2 = point("column-2", 10, -123.75);
    const column10 = point("column-10", 10, 56.25);
    for (const points of [
      [column2, column10],
      [column10, column2],
    ]) {
      expect(clusterPoints(points, 4).map((cluster) => cluster.memberIds)).toEqual([
        [column10.id],
        [column2.id],
      ]);
    }
  });

  it("splits at exact tile edges and at high zoom while grouping nearby points", () => {
    const a = point("a", 0, 0);
    const b = point("b", 0, 0.000001);
    const c = point("c", 0, -0.000001);
    const d = point("d", 0.000001, 0);
    expect(clusterPoints([a, b, c, d], 20).map((cluster) => cluster.memberIds)).toEqual([
      [a.id, b.id],
      [c.id],
      [d.id],
    ]);
    expect(clusterPoints([point("a", 10, 0), point("b", 10, 0.001)], 0)).toHaveLength(1);
    expect(clusterPoints([point("a", 10, 0), point("b", 10, 0.001)], 20)).toHaveLength(2);
  });

  it("clamps only tile assignment at poles and keeps original coordinates in centroids", () => {
    expect(MERCATOR_MAX_LATITUDE).toBe(85.05112878);
    for (const sign of [-1, 1]) {
      const points = [
        point("pole", sign * 90, 180),
        point("cutoff", sign * MERCATOR_MAX_LATITUDE, 180),
      ];
      const [cluster] = clusterPoints(points, 20);
      expect(cluster).toEqual({
        count: 2,
        centroid: createCoordinate((sign * (90 + MERCATOR_MAX_LATITUDE)) / 2, 180),
        memberIds: points.map((p) => p.id),
      });
      expect(points[0]?.latitude).toBe(sign * 90);
    }
    const east = point("east", 10, 180);
    const west = point("west", 10, -180);
    expect(clusterPoints([east, west], 1).map((cluster) => cluster.memberIds)).toEqual([
      [west.id],
      [east.id],
    ]);
    expect(clusterPoints([east, west], 0)).toEqual([
      { count: 2, centroid: createCoordinate(10, 0), memberIds: [east.id, west.id] },
    ]);
    expect(clusterPoints([point("origin", 0, 0)], 20)[0]?.centroid.suspicious).toBe(true);
  });

  it("assigns closed geographic edges to their adjacent in-range tiles", () => {
    for (const zoom of [1, 20]) {
      for (const sign of [-1, 1]) {
        const edge = point("edge", sign * 90, sign * 180);
        const inside = point(
          "inside",
          sign * (MERCATOR_MAX_LATITUDE - 0.00000001),
          sign * 179.99999999,
        );
        const clusters = clusterPoints([edge, inside], zoom);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.memberIds).toEqual([edge.id, inside.id]);
      }
    }
  });

  it("matches known Web Mercator row boundaries rather than a latitude-linear grid", () => {
    // At zoom 2, y=1 begins at atan(sinh(pi/2)) = 66.51326044311186 degrees north.
    const upper = point("upper", 66.51326045, 1);
    const lower = point("lower", 66.51326043, 1);
    const middle = point("middle", 45, 1);
    expect(clusterPoints([lower, upper, middle], 2).map((cluster) => cluster.memberIds)).toEqual([
      [lower.id, middle.id],
      [upper.id],
    ]);
  });

  it("keeps input and returned results independent on repeated calls", () => {
    const input = Object.freeze([Object.freeze(point("frozen", 10, 10))]);
    const first = clusterPoints(input, 2);
    const second = clusterPoints(input, 2);
    expect(first).toEqual(second);
    expect(first[0]?.centroid).not.toBe(second[0]?.centroid);
    expect(first[0]?.memberIds).not.toBe(second[0]?.memberIds);
    expect(first[0]?.centroid).not.toBe(input[0]);
  });

  it.each([null, {}, "points", new Set()])("rejects unsupported point containers %j", (points) => {
    fails(() => clusterPoints(points, 0), "INVALID_POINTS");
  });

  it.each([
    undefined,
    null,
    "0",
    NaN,
    Infinity,
    -Infinity,
    -1,
    21,
    0.5,
  ])("rejects invalid zoom even for empty input %j", (zoom) => {
    fails(() => clusterPoints([], zoom), "INVALID_ZOOM");
  });

  it.each([
    null,
    [],
    {},
    { id: 1, latitude: 0, longitude: 0 },
    { id: "", latitude: 0, longitude: 0 },
    { id: " \t\n", latitude: 0, longitude: 0 },
  ])("rejects malformed point IDs and sparse arrays %j", (value) => {
    fails(() => clusterPoints([value], 0), "INVALID_POINTS");
    fails(() => clusterPoints(Array(1), 0), "INVALID_POINTS");
  });

  it("rejects duplicate IDs and invalid coordinates without disclosing caller input", () => {
    const a = point("private", 0, 0);
    fails(() => clusterPoints([a, { ...a, latitude: 10 }], 0), "INVALID_POINTS");
    for (const coordinates of [
      { latitude: NaN, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      {},
    ]) {
      fails(() => clusterPoints([{ id: a.id, ...coordinates }], 0), "INVALID_COORDINATE");
    }
    try {
      clusterPoints([a, a], 0);
    } catch (error) {
      expect((error as Error).message).not.toContain(a.id);
    }
  });

  it("accepts exactly 200,000 points, retaining every ID", () => {
    expect(MAX_CLUSTER_POINTS).toBe(200_000);
    const points = Array.from({ length: MAX_CLUSTER_POINTS }, (_, i) => point(String(i), 0, 0));
    expect(clusterPoints(points, 0)).toEqual([
      { count: MAX_CLUSTER_POINTS, centroid: origin, memberIds: points.map((p) => p.id) },
    ]);
  });

  it("rejects bound+1 before reading any members or validating zoom", () => {
    const points = Array(MAX_CLUSTER_POINTS + 1);
    Object.defineProperty(points, 0, {
      get() {
        throw new Error("Member access must not occur");
      },
    });
    fails(() => clusterPoints(points, 0), "TOO_MANY_POINTS");
    fails(() => clusterPoints(points, NaN), "TOO_MANY_POINTS");
  });
});
