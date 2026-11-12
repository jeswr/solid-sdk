// AUTHORED-BY Claude Opus 5.5
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import {
  buildReservation,
  createTripsStore,
  DEFAULT_LOAD_BUDGET,
  deduplicate,
  groupIntoTrips,
  isAllDay,
  isTrusted,
  itinerary,
  parseReservations,
  parseReservationTime,
  type Reservation,
  serializeReservation,
  type Trip,
  UnconfirmedWriteError,
} from "../src/index.js";

const root = "https://pod.example/";
const flight = (id: string, extra: Partial<Reservation> = {}): Reservation => ({
  id: `${root}mail/trips/${id}#it`,
  kind: "FlightReservation",
  reservationNumber: "EX4Q8R",
  provider: "Example Air",
  start: "2026-12-01T09:00:00Z",
  fromCode: "AAA",
  toCode: "BBB",
  ...extra,
});
const trip: Trip = {
  id: "pending:one",
  name: "Example",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  reservations: [],
};
function memoryStore(overrides: Partial<StorageClient> = {}, budget?: object) {
  const original = createMemoryStorage({ protocol: "lws", root, pageSize: 20 });
  const storage = { ...original, ...overrides };
  const index = { register: vi.fn(async () => undefined), findAll: vi.fn(async () => new Map()) };
  const store = createTripsStore({
    storage,
    index,
    protect: async () => {},
    ...(budget ? { loadBudget: budget } : {}),
  });
  return { storage, original, store };
}

describe("trust-ranked duplicate detection", () => {
  const verified = flight("verified", { trust: "verified", modified: "2026-11-01T00:00:00Z" });
  const spoofed = flight("spoofed", {
    trust: "unverified",
    modified: "2026-11-20T00:00:00Z",
    start: "2026-12-03T23:00:00Z",
    toCode: "EVIL",
  });
  it("never lets a later unverified (spoofed) copy replace a verified booking", () => {
    expect(deduplicate([verified, spoofed])).toEqual([verified]);
    expect(deduplicate([spoofed, verified])).toEqual([verified]);
    const [suggestion] = groupIntoTrips([spoofed, verified], []);
    expect(suggestion?.reservations).toEqual([verified.id]);
    expect(suggestion?.destination).toBe("BBB");
    const days = itinerary({ reservations: [spoofed.id] }, [spoofed, verified]);
    expect(days.flatMap((day) => day.items)).toEqual([verified]);
  });
  it("still lets a newer copy win within the same trust rank", () => {
    const newer = flight("newer", { trust: "verified", modified: "2026-11-02T00:00:00Z" });
    expect(deduplicate([verified, newer])).toEqual([newer]);
    const laterSpoof = { ...spoofed, id: `${root}mail/trips/later#it`, modified: "2027-01-01" };
    expect(deduplicate([spoofed, laterSpoof])).toEqual([laterSpoof]);
  });
  it("trusts a manual record without an email claim, never a connector record without one", () => {
    const manual = flight("manual", { origin: "manual", modified: "2026-01-01T00:00:00Z" });
    expect(isTrusted(manual)).toBe(true);
    expect(isTrusted({ trust: undefined })).toBe(false);
    expect(isTrusted({ origin: "manual", trust: "unverified" })).toBe(false);
    expect(deduplicate([spoofed, manual])).toEqual([manual]);
  });
});

describe("manual bookings make no email trust claim", () => {
  it("writes no trust triple and loads the record as user-entered and trusted", async () => {
    const { store, original } = memoryStore();
    await store.initialise();
    const booking = await store.addReservation({ kind: "TrainReservation", title: "Train" });
    expect(booking).toMatchObject({ origin: "manual" });
    expect(booking.trust).toBeUndefined();
    const doc = booking.id.split("#")[0] as string;
    expect(await (await original.read(doc)).text()).not.toContain("emailMarkupTrust");
    const [loaded] = (await store.load()).reservations;
    expect(loaded).toMatchObject({ id: booking.id, origin: "manual" });
    expect(loaded?.trust).toBeUndefined();
    expect(isTrusted(loaded as Reservation)).toBe(true);
  });
  it("keeps the fail-closed default for connector documents and an explicit manual claim", async () => {
    const graph = buildReservation(`${root}x`, { kind: "EventReservation" });
    expect(parseReservations(graph)[0]?.trust).toBe("unverified");
    expect(parseReservations(graph)[0]?.origin).toBeUndefined();
    expect(parseReservations(graph, undefined, { manual: true })[0]).toMatchObject({
      origin: "manual",
    });
    const claimed = buildReservation(`${root}y`, { kind: "EventReservation", trust: "unverified" });
    expect(parseReservations(claimed, undefined, { manual: true })[0]?.trust).toBe("unverified");
  });
  it("does not mark linked connector documents outside the manual container as manual", async () => {
    const { store, original } = memoryStore();
    await store.initialise();
    await original
      .create(`${root}mail/`, null, { name: "trips", kind: "container" })
      .catch(() =>
        original
          .create(root, null, { name: "mail", kind: "container" })
          .then(() => original.create(`${root}mail/`, null, { name: "trips", kind: "container" })),
      );
    const url = `${root}mail/trips/one`;
    await original.create(
      `${root}mail/trips/`,
      await serializeReservation(url, { kind: "FlightReservation", title: "Flight" }),
      { name: "one", contentType: "text/turtle" },
    );
    await store.saveTrip({ ...trip, reservations: [`${url}#it`] });
    const [loaded] = (await store.load()).reservations;
    expect(loaded).toMatchObject({ id: `${url}#it`, trust: "unverified" });
    expect(loaded?.origin).toBeUndefined();
  });
});

describe("all-day dates", () => {
  it("accepts a bare calendar date as all-day and still rejects invalid dates", () => {
    expect(parseReservationTime("2026-12-01")).toBe("2026-12-01");
    expect(isAllDay("2026-12-01")).toBe(true);
    expect(isAllDay("2026-12-01T09:00:00Z")).toBe(false);
    for (const bad of ["2026-02-30", "2026-12", "2026-12-01T", "2026-12-01+15:00", "2026-12-01Y"])
      expect(parseReservationTime(bad)).toBeUndefined();
  });
  it("accepts a timezoned xsd:date as all-day and keeps it as given", async () => {
    for (const zoned of ["2026-12-01Z", "2026-12-01+01:00", "2026-12-01-05:00"]) {
      expect(parseReservationTime(zoned)).toBe(zoned);
      expect(isAllDay(zoned)).toBe(true);
    }
    const ttl = (
      await readFile(new URL("fixtures/connector.ttl", import.meta.url), "utf8")
    ).replace('s:startDate "2026-12-01T20:00:00Z"', 's:startDate "2026-12-01+13:00"^^x:date');
    const items = parseReservations(await parseRdf(ttl, "text/turtle"));
    const event = items.find((item) => item.kind === "EventReservation") as Reservation;
    // The offset is not a clock time: the zoned date still sorts before the 12:00 car hire.
    expect(event.start).toBe("2026-12-01+13:00");
    const [day] = itinerary({ reservations: items.map((item) => item.id) }, items);
    expect(day?.date).toBe("2026-12-01");
    expect(day?.items[0]?.id).toBe(event.id);
    const written = await serializeReservation(`${root}allday-zoned`, {
      kind: "EventReservation",
      start: "2026-12-01Z",
    });
    expect(written).toContain('"2026-12-01Z"^^xsd:date');
    expect(parseReservations(await parseRdf(written, "text/turtle"))[0]?.start).toBe("2026-12-01Z");
  });
  it.each([
    '"2026-12-01"',
    '"2026-12-01"^^x:date',
  ])("reads an Event startDate of %s and orders it first on its day", async (literal) => {
    const ttl = (
      await readFile(new URL("fixtures/connector.ttl", import.meta.url), "utf8")
    ).replace('s:startDate "2026-12-01T20:00:00Z"', `s:startDate ${literal}`);
    const items = parseReservations(await parseRdf(ttl, "text/turtle"));
    const event = items.find((item) => item.kind === "EventReservation") as Reservation;
    expect(event.start).toBe("2026-12-01");
    const [day] = itinerary({ reservations: items.map((item) => item.id) }, items);
    expect(day?.date).toBe("2026-12-01");
    expect(day?.items[0]?.id).toBe(event.id);
    expect(groupIntoTrips(items, []).flatMap((t) => t.reservations)).toContain(event.id);
  });
  it("round-trips a manual all-day booking as xsd:date", async () => {
    const ttl = await serializeReservation(`${root}allday`, {
      kind: "EventReservation",
      start: "2026-12-01",
    });
    expect(ttl).toContain('"2026-12-01"^^xsd:date');
    expect(parseReservations(await parseRdf(ttl, "text/turtle"))[0]?.start).toBe("2026-12-01");
  });
});

describe("trip write outcome", () => {
  it.each([
    ["network", null],
    ["server", 503],
    ["invalid-response", 200],
    ["network", 408],
  ] as const)("reports an ambiguous %s (%s) trip PUT as unconfirmed", async (code, status) => {
    const { store } = memoryStore({
      write: vi.fn(async (url: string) => {
        throw new StorageError(code, { status, method: "PUT", url });
      }),
    });
    await store.initialise();
    const error = await store.saveTrip(trip).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnconfirmedWriteError);
    expect((error as UnconfirmedWriteError).cause).toBeInstanceOf(StorageError);
  });
  it.each([
    ["precondition-failed", 412],
    ["forbidden", 403],
    ["bad-request", 400],
  ] as const)("propagates a definite %s refusal unchanged", async (code, status) => {
    const refusal = new StorageError(code, { status, method: "PUT", url: root });
    const { store } = memoryStore({
      write: vi.fn(async () => {
        throw refusal;
      }),
    });
    await store.initialise();
    await expect(store.saveTrip(trip)).rejects.toBe(refusal);
  });
});

describe("own-container load budget", () => {
  it("defaults to a generous page cap and timeout", () => {
    expect(DEFAULT_LOAD_BUDGET).toEqual({ maxPages: 100, timeoutMs: 60_000 });
  });
  it("stops an endless own listing at the page cap with a partial-result notice", async () => {
    let page = 0;
    const list = vi.fn(async () => ({
      items: [],
      next: { url: `${root}cursor/${++page}` },
      etag: null,
      total: null,
    }));
    const { store } = memoryStore({ list });
    const loaded = await store.load();
    expect(loaded.notice).toMatchObject({ capped: true });
    // Two own containers, 100 pages each.
    expect(list).toHaveBeenCalledTimes(2 * DEFAULT_LOAD_BUDGET.maxPages);
  });
  it("keeps trips listed before the page cap", async () => {
    const { store } = memoryStore({}, { maxPages: 1 });
    await store.initialise();
    for (let n = 0; n < 25; n++) await store.saveTrip(trip);
    const loaded = await store.load();
    // One 20-entry page; the reservations/ subcontainer may take one of its slots.
    expect(loaded.trips.length).toBeGreaterThanOrEqual(19);
    expect(loaded.trips.length).toBeLessThanOrEqual(20);
    expect(loaded.notice).toMatchObject({ capped: true });
  });
  it("gives up on a hanging own listing after the timeout with a partial notice", async () => {
    const list = vi.fn(
      (_url: string, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
    );
    const { store } = memoryStore({ list: list as StorageClient["list"] }, { timeoutMs: 20 });
    const loaded = await store.load();
    expect(loaded.notice).toEqual({ skipped: 2, capped: true });
    expect(loaded.trips).toEqual([]);
  });
});

describe("CON-A8 writer document layout", () => {
  const base = `${root}mail/account/trips/`;
  async function writerDoc(name: string) {
    const url = `${base}${name}.ttl`;
    const text = await readFile(new URL(`fixtures/writer/${name}.ttl`, import.meta.url), "utf8");
    return {
      url,
      items: parseReservations(await parseRdf(text, "text/turtle", { baseIRI: url }), url),
    };
  }
  it("reads a one-item document rooted at #it with depth-first #node-N children", async () => {
    const { url, items } = await writerDoc("flight");
    expect(items).toEqual([
      expect.objectContaining({
        id: `${url}#it`,
        kind: "FlightReservation",
        reservationNumber: "TEST-FLIGHT-42",
        provider: "Example Air",
        underName: "Example Traveller",
        status: "https://schema.org/ReservationConfirmed",
        fromCode: "AAA",
        toCode: "BBB",
        from: "Example North",
        to: "Example South",
        start: "2026-12-01T09:00:00Z",
        modified: "2026-11-20T08:00:00.000Z",
        trust: "verified",
      }),
    ]);
  });
  it("reads an unverified event document, its location and time from child nodes", async () => {
    const { url, items } = await writerDoc("event");
    expect(items).toEqual([
      expect.objectContaining({
        id: `${url}#it`,
        kind: "EventReservation",
        provider: "Example Tickets",
        title: "Example Concert",
        location: "Example Hall",
        start: "2026-12-01T20:00:00Z",
        trust: "unverified",
      }),
    ]);
    expect(isTrusted(items[0] as Reservation)).toBe(false);
  });
});
