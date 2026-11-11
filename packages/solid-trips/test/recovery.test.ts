// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { createTripsStore, serializeReservation, type Trip } from "../src/index.js";

const root = "https://pod.example/";
const trip: Trip = {
  id: "pending:one",
  name: "Example",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  reservations: [],
};
async function fixture(overrides: Partial<StorageClient> = {}, sources: string[] = []) {
  const original = createMemoryStorage({ protocol: "lws", root, pageSize: 20 });
  const storage = { ...original, ...overrides };
  const protect = vi.fn(async (_url: string, _folder: boolean) => {});
  const index = {
    register: vi.fn(async () => undefined),
    findAll: vi.fn(
      async (_classes: string[]) => new Map([["http://schema.org/FlightReservation", sources]]),
    ),
  };
  const store = createTripsStore({ storage, protect, index });
  await store.initialise();
  return { storage, original, protect, index, store };
}
const input = {
  kind: "FlightReservation" as const,
  title: "Example",
  start: "2026-12-01T12:00:00Z",
};
describe("load recovery and pagination", () => {
  it("loads more than 200 trips and manual bookings across more than eight pages", async () => {
    const { store } = await fixture();
    for (let n = 0; n < 205; n++) {
      const r = await store.addReservation(input);
      await store.saveTrip({ ...trip, reservations: [r.id] });
    }
    const loaded = await store.load();
    expect(loaded.trips).toHaveLength(205);
    expect(loaded.reservations).toHaveLength(205);
    expect(loaded.notice?.skipped).toBe(0);
  });
  it.each([
    "malformed",
    "oversized",
    "forbidden",
  ])("retains good trips/bookings when a document is %s", async (kind) => {
    const { store, storage } = await fixture();
    const good = await store.addReservation(input);
    await store.saveTrip({ ...trip, reservations: [good.id] });
    await storage.create(
      `${root}trips/`,
      kind === "oversized" ? "x".repeat(512 * 1024 + 1) : "bad turtle",
      { name: "bad", contentType: "text/turtle" },
    );
    await storage.create(`${root}trips/reservations/`, "bad turtle", {
      name: "bad",
      contentType: "text/turtle",
    });
    if (kind === "forbidden") {
      const read = storage.read;
      storage.read = async (url, opts) => {
        if (url.endsWith("/bad")) throw new StorageError("forbidden", { url, method: "GET" });
        return read(url, opts);
      };
    }
    const loaded = await store.load();
    expect(loaded.trips).toHaveLength(1);
    expect(loaded.reservations).toHaveLength(1);
    expect(loaded.notice?.skipped).toBe(2);
  });
  it("rejects forged subjects during both load and scan", async () => {
    const url = `${root}trips/reservations/real`;
    const { storage, store, index } = await fixture();
    const manual = await store.addReservation({ ...input, reservationNumber: "manual" });
    await storage.create(
      `${root}trips/reservations/`,
      await serializeReservation(`${root}elsewhere`, { ...input, reservationNumber: "forged" }),
      { name: "real", contentType: "text/turtle" },
    );
    expect((await store.load()).reservations.map((r) => r.reservationNumber)).toEqual(["manual"]);
    index.findAll.mockResolvedValue(new Map([["http://schema.org/FlightReservation", [url]]]));
    expect((await store.scan([], [manual])).reservations).toEqual([manual]);
  });
});
describe("partial bounded scans", () => {
  it("reads per-class registrations, never appends trips to an EmailMessage registration", async () => {
    const { store, index, storage } = await fixture();
    const reservation = await store.addReservation(input);
    index.findAll.mockResolvedValue(
      new Map([
        ["http://schema.org/FlightReservation", [reservation.id]],
        ["http://schema.org/EmailMessage", [`${root}mail/messages/`]],
      ]),
    );
    const list = vi.spyOn(storage, "list");
    expect((await store.scan([])).suggestions).toHaveLength(1);
    expect(list).not.toHaveBeenCalled();
    expect(index.findAll.mock.calls[0]?.[0]).not.toContain("http://schema.org/EmailMessage");
  });
  it("retains valid documents alongside denied, oversized, malformed, missing and off-pod sources", async () => {
    const { store, storage, index } = await fixture();
    const reservation = await store.addReservation(input);
    index.findAll.mockResolvedValue(
      new Map([
        [
          "http://schema.org/FlightReservation",
          [
            reservation.id,
            `${root}bad`,
            `${root}denied`,
            `${root}large`,
            `${root}missing`,
            "https://foreign.example/data",
          ],
        ],
      ]),
    );
    await storage.create(root, "bad", { name: "bad", contentType: "text/turtle" });
    await storage.create(root, "x".repeat(512 * 1024 + 1), {
      name: "large",
      contentType: "text/turtle",
    });
    const read = storage.read;
    storage.read = vi.fn(async (url, opts) => {
      if (url.endsWith("denied")) throw new StorageError("forbidden", { url, method: "GET" });
      return read(url, opts);
    });
    const result = await store.scan([]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.notice).toEqual({ skipped: 5, capped: false });
    expect(storage.read).not.toHaveBeenCalledWith(
      "https://foreign.example/data",
      expect.anything(),
    );
  });
  it("retains the first 200 documents and reports the document cap", async () => {
    const { store, storage, index } = await fixture();
    for (let n = 0; n < 201; n++)
      await store.addReservation({ ...input, reservationNumber: `${n}` });
    index.findAll.mockResolvedValue(
      new Map([["http://schema.org/FlightReservation", [`${root}trips/reservations/`]]]),
    );
    // A large single page isolates the document budget from the eight-page scan budget.
    const list = storage.list;
    storage.list = async (url, opts) => {
      const all = [];
      let cursor: import("@jeswr/storage-client").PageCursor | undefined;
      do {
        const p = await list(url, { ...opts, cursor });
        all.push(...p.items);
        cursor = p.next ?? undefined;
      } while (cursor);
      return { items: all, next: null, etag: null, total: null };
    };
    const result = await store.scan([]);
    expect(result.reservations).toHaveLength(200);
    expect(result.notice).toEqual({ skipped: 1, capped: true });
  });
  it("reports source and page limits without throwing away earlier results", async () => {
    const { store, index, storage } = await fixture();
    const good = await store.addReservation(input);
    index.findAll.mockResolvedValue(
      new Map([
        [
          "http://schema.org/FlightReservation",
          [good.id, ...Array.from({ length: 17 }, (_, n) => `${root}source${n}/`)],
        ],
      ]),
    );
    const result = await store.scan([]);
    expect(result.reservations).toHaveLength(1);
    expect(result.notice.capped).toBe(true);
    let page = 0;
    storage.list = vi.fn(async () => ({
      items: [],
      next: { url: `${root}cursor${page++}` },
      etag: null,
      total: null,
    }));
    index.findAll.mockResolvedValue(
      new Map([["http://schema.org/FlightReservation", [good.id, `${root}paged/`]]]),
    );
    const limited = await store.scan([]);
    expect(storage.list).toHaveBeenCalledTimes(8);
    expect(limited.reservations).toHaveLength(1);
    expect(limited.notice).toEqual({ skipped: 1, capped: true });
  });
});
describe("conditional compensation", () => {
  it.each([
    "protect",
    "read",
    "write",
    "validation",
  ])("removes new empty trip and reservation documents after %s failure", async (failure) => {
    const { store, storage, protect } = await fixture();
    if (failure === "protect") protect.mockRejectedValue(new Error("no control"));
    if (failure === "read")
      storage.read = vi.fn(async () => {
        throw new Error("offline");
      });
    if (failure === "write")
      storage.write = vi.fn(async () => {
        throw new Error("offline");
      });
    await expect(
      store.saveTrip({ ...trip, name: failure === "validation" ? "" : trip.name }),
    ).rejects.toThrow();
    await expect(
      store.addReservation({ ...input, start: failure === "validation" ? "bad" : input.start }),
    ).rejects.toThrow();
    expect(
      (await storage.list(`${root}trips/`)).items.filter((i) => i.kind !== "container"),
    ).toHaveLength(0);
    expect((await storage.list(`${root}trips/reservations/`)).items).toHaveLength(0);
  });
  it("does not remove an existing trip or a concurrent update, and preserves the original failure if cleanup fails", async () => {
    const { store, storage, protect } = await fixture();
    const saved = await store.saveTrip(trip);
    const write = storage.write;
    storage.write = vi.fn(async () => {
      throw new Error("write failed");
    });
    await expect(store.saveTrip({ ...saved, name: "Changed" })).rejects.toThrow("write failed");
    expect(await storage.head(saved.id.split("#")[0] as string)).toBeTruthy();
    const remove = vi.spyOn(storage, "delete").mockRejectedValue(new Error("cleanup failed"));
    await expect(store.addReservation(input)).rejects.toThrow("write failed");
    expect(remove).toHaveBeenCalled();
    remove.mockRestore();
    storage.write = write;
    protect.mockImplementation(async (url) => {
      if (!url.endsWith("/")) {
        const h = await storage.head(url);
        await write(url, "concurrent", { contentType: "text/plain", ifMatch: h.etag as string });
        throw new Error("privacy failed");
      }
    });
    await expect(store.addReservation(input)).rejects.toThrow("privacy failed");
    const entries = (await storage.list(`${root}trips/reservations/`)).items;
    expect(
      await Promise.all(entries.map(async (entry) => (await storage.read(entry.url)).text())),
    ).toContain("concurrent");
  });
  it("deletes a returned manual booking with its validator and rejects out-of-scope compensation", async () => {
    const { store, storage } = await fixture();
    const r = await store.addReservation(input);
    await store.deleteReservation(r);
    await expect(storage.head(r.id.split("#")[0] as string)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(store.deleteReservation({ ...r, id: `${root}mail/source#it` })).rejects.toThrow();
    await expect(store.deleteReservation({ ...r, etag: null })).rejects.toThrow("version");
  });
});
it("keeps completed results and labels the time budget as partial", async () => {
  const { store, storage, index } = await fixture();
  const first = await store.addReservation(input),
    second = await store.addReservation(input);
  index.findAll.mockResolvedValue(
    new Map([["http://schema.org/FlightReservation", [first.id, second.id]]]),
  );
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const read = storage.read;
  storage.read = async (url, options) => {
    if (url === second.id.split("#")[0]) {
      controller.abort();
      throw new Error("timeout");
    }
    return read(url, options);
  };
  try {
    const result = await store.scan([]);
    expect(result.reservations).toHaveLength(1);
    expect(result.notice).toEqual({ skipped: 1, capped: true });
  } finally {
    timeout.mockRestore();
  }
});
it("bounds reservations as well as documents, and retains already completed pages when later listings fail", async () => {
  const { store, storage, index } = await fixture();
  const doc = `${root}many`;
  const ttl = (
    await Promise.all(
      Array.from({ length: 201 }, (_, n) => serializeReservation(`${root}r${n}`, input)),
    )
  )
    .map((text, n) => text.replaceAll(`${root}r${n}#`, `${doc}#${n}-`))
    .join("\n");
  await storage.create(root, ttl, { name: "many", contentType: "text/turtle" });
  index.findAll.mockResolvedValue(new Map([["http://schema.org/FlightReservation", [doc]]]));
  const result = await store.scan([]);
  expect(result.reservations).toHaveLength(200);
  expect(result.notice.capped).toBe(true);
  const booking = await store.addReservation(input);
  const list = storage.list;
  let page = 0;
  storage.list = async (url, opts) => {
    if (page++ === 0) {
      const p = await list(url, opts);
      return { ...p, next: { url: `${root}cursor` } };
    }
    throw new Error("later page unavailable");
  };
  const loaded = await store.load();
  expect(loaded.reservations.some((r) => r.id === booking.id)).toBe(true);
  expect(loaded.notice?.skipped).toBe(2);
});
it("does not use a follow-up HEAD validator for creation rollback", async () => {
  const { storage, original, protect, store } = await fixture();
  storage.create = async (...args) => ({
    ...(await original.create(...args)),
    etagSource: "follow-up",
  });
  protect.mockRejectedValue(new Error("no control"));
  const remove = vi.spyOn(storage, "delete");
  await expect(store.addReservation(input)).rejects.toThrow("no control");
  await expect(store.saveTrip(trip)).rejects.toThrow("no control");
  expect(remove).not.toHaveBeenCalled();
});
