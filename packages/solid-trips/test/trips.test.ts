// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import {
  bookingKey,
  buildReservation,
  createTripsStore,
  deduplicate,
  entities,
  groupIntoTrips,
  importEmail,
  itinerary,
  parseReservations,
  parseTrip,
  type Reservation,
  reservationKinds,
  serializeReservation,
  serializeTrip,
  type Trip,
} from "../src/index.js";

const root = "https://pod.example/";
const trip: Trip = {
  id: `${root}trips/one#it`,
  name: "Lisbon",
  destination: "LIS",
  startDate: "2026-12-01",
  endDate: "2026-12-05",
  reservations: [],
};
function booking(
  id: string,
  start = "2026-12-01T09:00:00+02:00",
  extra: Partial<Reservation> = {},
): Reservation {
  return {
    id: root + id,
    kind: "FlightReservation",
    start,
    provider: "Example Air",
    reservationNumber: id,
    fromCode: "LHR",
    toCode: "LIS",
    ...extra,
  };
}
describe("generated graph facade", () => {
  for (const kind of reservationKinds)
    it(`round-trips ${kind} with source-local times and linked generated nodes`, async () => {
      const input = {
        ...booking("source"),
        kind,
        title: "Example booking",
        number: "EX123",
        underName: "Robin Example",
        address: "Example Square",
        from: "London",
        to: "Lisbon",
        location: "Example Hall",
        end: "2026-12-05T11:00:00+01:00",
        modified: "2026-11-10T12:00:00Z",
        trust: "verified" as const,
        source: `${root}mail/message#it`,
      };
      if (kind === "EventReservation") input.end = undefined as unknown as string;
      const ttl = await serializeReservation(`${root}manual`, input);
      const data = parseReservations(await parseRdf(ttl, "text/turtle"));
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        kind,
        provider: "Example Air",
        underName: "Robin Example",
        start: input.start,
        trust: "verified",
        reservationNumber: "source",
      });
      if (kind !== "EventReservation") expect(data[0]?.end).toBe(input.end);
      expect(ttl).toContain(kind);
    });
  it("round-trips trip dates, notes, flags and reservation links", async () => {
    const original = {
      ...trip,
      notes: "Pack lightly",
      archived: false,
      cover: "https://example.org/cover.png",
      reservations: [`${root}manual#it`],
      created: "2026-11-01T00:00:00Z",
    };
    const ttl = await serializeTrip(original);
    const parsed = parseTrip(trip.id, await parseRdf(ttl, "text/turtle"));
    expect(parsed).toMatchObject({ ...original, created: "2026-11-01T00:00:00.000Z" });
    expect(parseTrip(`${root}other`, await parseRdf(ttl, "text/turtle"))).toBeUndefined();
  });
  it("rejects invalid trip dates, missing names and unsafe resource URLs", () => {
    for (const patch of [
      { name: " " },
      { startDate: "bad" },
      { endDate: "2026-11-01" },
      { startDate: "2026-02-30" },
      { id: "relative" },
    ])
      expect(() => serializeTrip({ ...trip, ...patch })).toThrow();
    expect(() =>
      buildReservation(`${root}bad`, { kind: "FlightReservation", start: "not a date" }),
    ).toThrow();
    expect(() =>
      buildReservation(`${root}bad`, { kind: "FlightReservation", start: "2026-02-30T12:00:00Z" }),
    ).toThrow();
    expect(() => buildReservation(`${root}bad`, { kind: "unknown" as never })).toThrow();
  });
  it("accepts missing optional fields and treats unknown trust as unverified", () => {
    expect(parseReservations(entities.FlightReservation.build(`${root}direct`, {}))).toEqual([
      { id: `${root}direct`, kind: "FlightReservation", trust: "unverified" },
    ]);
  });
});
describe("trip planning", () => {
  it("deduplicates by provider and confirmation, newest modified wins deterministically", () => {
    const old = booking("old", undefined, {
      reservationNumber: " AbC ",
      modified: "2026-01-01T00:00:00Z",
    });
    const newer = booking("new", undefined, {
      reservationNumber: "abc",
      provider: "example air",
      modified: "2026-02-01T00:00:00Z",
    });
    expect(deduplicate([newer, old])).toEqual([newer]);
    expect(deduplicate([old, newer])).toEqual([newer]);
    const tie = { ...newer, id: `${root}aaa` };
    expect(deduplicate([newer, tie])[0]).toEqual(tie);
    expect(bookingKey({ ...old, reservationNumber: "" })).toBe(old.id);
    expect(deduplicate([old, { ...old, provider: "Example Rail" }])).toHaveLength(2);
  });
  it("groups an outward flight, hotel and return; starts again after returning home", () => {
    const outward = booking("out");
    const hotel = booking("hotel", "2026-12-01T15:00:00Z", {
      kind: "LodgingReservation",
      title: "Lisbon",
      end: "2026-12-05T11:00:00Z",
    });
    const back = booking("back", "2026-12-05T15:00:00Z", { fromCode: "LIS", toCode: "LHR" });
    const next = booking("next", "2026-12-06T15:00:00Z", { toCode: "CDG" });
    const grouped = groupIntoTrips([next, back, hotel, outward], []);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.reservations).toHaveLength(3);
    expect(grouped[0]?.endDate).toBe("2026-12-05");
  });
  it("respects existing duplicate membership, separates gaps and ignores undated bookings", () => {
    const a = booking("a"),
      b = booking("b", "2026-12-10T10:00:00Z"),
      unknown = booking("u", undefined, { start: undefined });
    expect(groupIntoTrips([a, b, unknown], [])).toHaveLength(2);
    expect(
      groupIntoTrips([a, { ...a, id: `${root}new` }, b], [{ ...trip, reservations: [a.id] }]),
    ).toHaveLength(1);
    expect(() => groupIntoTrips([], [], { gapDays: -1 })).toThrow();
    expect(() => groupIntoTrips([], [], { gapDays: Number.NaN })).toThrow();
    expect(groupIntoTrips([a, b], [], { gapDays: 20 })).toHaveLength(1);
  });
  it("separates distant stays and uses explicit home airport", () => {
    const a = booking("a", undefined, {
      kind: "LodgingReservation",
      toCode: undefined,
      fromCode: undefined,
      location: "Lisbon",
    });
    const b = booking("b", "2026-12-03T15:00:00Z", {
      kind: "LodgingReservation",
      toCode: undefined,
      fromCode: undefined,
      address: "York",
    });
    expect(groupIntoTrips([a, b], [])).toHaveLength(2);
    expect(
      groupIntoTrips(
        [booking("back", undefined, { toCode: "LHR" }), booking("out2", "2026-12-02T15:00:00Z")],
        [],
        { homeAirport: "LHR" },
      ),
    ).toHaveLength(2);
  });
  it("orders days and clocks as supplied, never converts time zones, and resolves old duplicate IRIs", () => {
    const a = booking("a", "2026-12-01T09:30:00+10:00"),
      b = booking("b", "2026-12-01T08:00:00-05:00"),
      c = booking("c", "2026-12-02T06:00:00Z"),
      d = booking("d", undefined, { start: undefined });
    const days = itinerary({ ...trip, reservations: [a.id, b.id, c.id, d.id] }, [a, b, c, d]);
    expect(days.map((day) => day.date)).toEqual(["2026-12-01", "2026-12-02", "Undated"]);
    expect(days[0]?.items.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(
      itinerary({ ...trip, reservations: [a.id] }, [
        a,
        { ...a, id: `${root}new`, modified: "2026-11-10T00:00:00Z" },
      ])[0]?.items[0]?.id,
    ).toBe(`${root}new`);
  });
});
describe("bounded pod storage", () => {
  for (const protocol of ["solid", "lws"] as const)
    it(`creates, versions, loads and scans on ${protocol}`, async () => {
      const storage = createMemoryStorage({ protocol, root, pageSize: 1 });
      const protect = vi.fn(async () => {});
      const index = {
        register: vi.fn(async () => undefined),
        findAll: vi.fn(async () => new Map<string, string[]>()),
      };
      const store = createTripsStore({ storage, index, protect });
      await store.initialise();
      const reservation = await store.addReservation(booking("manual"));
      const saved = await store.saveTrip({ ...trip, reservations: [reservation.id] });
      expect(saved.id).not.toContain("pending:");
      expect(saved.etag).toBeTruthy();
      await store.saveTrip({ ...saved, name: "New name" });
      await expect(store.saveTrip({ ...saved, name: "Conflict" })).rejects.toMatchObject({
        code: "precondition-failed",
      });
      const loaded = await store.load();
      expect(loaded.trips[0]?.name).toBe("New name");
      expect(loaded.reservations[0]?.reservationNumber).toBe("manual");
      expect(index.register).toHaveBeenCalledWith(
        "http://schema.org/Trip",
        { container: store.base },
        { index: "private" },
      );
      index.findAll.mockResolvedValue(
        new Map([
          ["http://schema.org/FlightReservation", [reservation.id.split("#")[0] as string]],
        ]),
      );
      expect((await store.scan([])).suggestions).toHaveLength(1);
      expect((await store.scan(loaded.trips, loaded.reservations)).suggestions).toHaveLength(0);
      expect(protect.mock.calls.length).toBeGreaterThanOrEqual(5);
    });
  it("fails closed on unsafe scan sources and access failures", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    const index = {
      register: vi.fn(),
      findAll: vi.fn(
        async () =>
          new Map([["http://schema.org/FlightReservation", ["https://foreign.example/bookings/"]]]),
      ),
    };
    const store = createTripsStore({ storage, index, protect: async () => {} });
    await store.initialise();
    await expect(store.scan([])).rejects.toThrow();
    const blocked = createTripsStore({
      storage,
      index,
      protect: async () => {
        throw new Error("No control");
      },
    });
    await expect(blocked.initialise()).rejects.toThrow("No control");
  });
  it("bounds source count, pages, documents and email import", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    const index = {
      register: vi.fn(),
      findAll: vi.fn(
        async () =>
          new Map([
            [
              "http://schema.org/FlightReservation",
              Array.from({ length: 17 }, (_, n) => `${root}source${n}/`),
            ],
          ]),
      ),
    };
    const store = createTripsStore({ storage, index, protect: async () => {} });
    await store.initialise();
    await expect(store.scan([])).rejects.toThrow("16 sources");
    await expect(importEmail("hello")).rejects.toThrow("Coming soon");
    const extract = vi.fn(async () => [
      { kind: "EventReservation" as const, trust: "verified" as const },
    ]);
    expect(await importEmail("<html>", extract)).toEqual([
      { kind: "EventReservation", trust: "unverified" },
    ]);
    await expect(importEmail("x".repeat(1024 * 1024 + 1), extract)).rejects.toThrow("1 MiB");
    await expect(
      importEmail("", async () =>
        Array.from({ length: 101 }, () => ({ kind: "EventReservation" })),
      ),
    ).rejects.toThrow("100 bookings");
  });
});

describe("scan boundaries and recovery", () => {
  function sourceStore(
    overrides: Partial<import("@jeswr/storage-client").StorageClient> = {},
    locations = [`${root}connector/trips/`],
  ) {
    const original = createMemoryStorage({ protocol: "solid", root });
    const storage = { ...original, ...overrides };
    const index = {
      register: vi.fn(async () => undefined),
      findAll: vi.fn(
        async () =>
          new Map([
            [
              "http://schema.org/EmailMessage",
              locations.map((value) => value.replace(/trips\/$/, "")),
            ],
          ]),
      ),
    };
    return { storage, index, store: createTripsStore({ storage, index, protect: async () => {} }) };
  }
  it("follows the registered mail account path and tolerates an absent connector subcontainer", async () => {
    const { store } = sourceStore();
    await store.initialise();
    expect(await store.scan([])).toMatchObject({ sources: 1, suggestions: [] });
  });
  it("rejects excess pages and documents, and does not publish partial results", async () => {
    const { store } = sourceStore({
      list: vi.fn(async () => ({
        items: [],
        next: { url: `${root}cursor` },
        etag: null,
        total: null,
      })),
    });
    await expect(store.scan([])).rejects.toThrow("eight pages");
    const tooMany = sourceStore({
      list: vi.fn(async () => ({
        items: Array.from({ length: 201 }, (_, n) => ({
          url: `${root}connector/trips/${n}`,
          kind: "resource" as const,
          types: [],
          contentType: null,
          size: null,
          modified: null,
        })),
        next: null,
        etag: null,
        total: null,
      })),
    });
    await expect(tooMany.store.scan([])).rejects.toThrow("200 documents");
  });
  it("does not treat access denial as an empty scan", async () => {
    const forbidden = new (await import("@jeswr/storage-client")).StorageError("forbidden", {
      method: "GET",
      url: root,
      message: "Access denied",
    });
    const { store } = sourceStore({
      list: vi.fn(async () => {
        throw forbidden;
      }),
    });
    await expect(store.scan([])).rejects.toBe(forbidden);
  });
  it("refuses an edit with a missing validator", async () => {
    const { store } = sourceStore();
    await store.initialise();
    await expect(store.saveTrip({ ...trip, etag: null })).rejects.toThrow("version");
  });
  it("excludes undated and unrelated items, handles absent and invalid duplicate timestamps", () => {
    const undated = booking("undated", undefined, {
      start: undefined,
      provider: undefined,
      reservationNumber: undefined,
    });
    expect(groupIntoTrips([undated], [])).toEqual([]);
    expect(itinerary({ reservations: [] }, [undated])).toEqual([]);
    expect(
      deduplicate([
        booking("z", undefined, { reservationNumber: "same", modified: "bad" }),
        booking("a", undefined, { reservationNumber: "same" }),
      ])[0]?.id,
    ).toBe(`${root}a`);
    const stay = booking("stay", undefined, {
      kind: "LodgingReservation",
      fromCode: undefined,
      toCode: undefined,
      title: undefined,
    });
    expect(groupIntoTrips([stay], [])[0]?.destination).toBe("Travel");
    expect(itinerary({ reservations: [undated.id] }, [undated])[0]?.date).toBe("Undated");
  });
});

it("treats missing modified timestamps as older than valid dates, including before the epoch", () => {
  const dated = booking("dated", undefined, {
    reservationNumber: "same",
    modified: "1960-01-01T00:00:00Z",
  });
  const missing = booking("missing", undefined, { reservationNumber: "same" });
  expect(deduplicate([dated, missing])).toEqual([dated]);
  const oldTrip = groupIntoTrips(
    [booking("old", "1969-12-30T12:00:00Z", { end: "1970-01-01T10:00:00Z" })],
    [],
  )[0];
  expect(oldTrip?.endDate).toBe("1970-01-01");
});

it("orders tied and undated bookings deterministically and handles flights without airport codes", () => {
  const a = booking("a", undefined, { fromCode: undefined, toCode: undefined }),
    b = booking("b", undefined, { fromCode: undefined, toCode: undefined });
  expect(groupIntoTrips([b, a], [])[0]?.reservations).toEqual([a.id, b.id]);
  expect(groupIntoTrips([a], [], { homeAirport: "LHR" })).toHaveLength(1);
  const undated = [
    { ...b, start: undefined },
    { ...a, start: undefined },
  ];
  expect(
    itinerary({ reservations: [a.id, b.id] }, undated)[0]?.items.map((item) => item.id),
  ).toEqual([a.id, b.id]);
});

it("builds an optional-field-only manual reservation without inventing a date", () => {
  const parsed = parseReservations(buildReservation(`${root}empty`, { kind: "EventReservation" }));
  expect(parsed[0]).toMatchObject({ kind: "EventReservation", trust: "unverified" });
  expect(parsed[0]?.start).toBeUndefined();
});

it("retains an event address when the event location has no separate name", () => {
  expect(
    parseReservations(
      buildReservation(`${root}event-address`, {
        kind: "EventReservation",
        title: "Example event",
        address: "42 Example Square",
      }),
    )[0]?.address,
  ).toBe("42 Example Square");
});
