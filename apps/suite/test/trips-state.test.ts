// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  deduplicate,
  isTrusted,
  type Trip,
  type TripsStore,
  UnconfirmedWriteError,
} from "@jeswr/solid-trips";
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, type Mock, vi } from "vitest";
import { createTripsState } from "../src/apps/trips/state/trips-state";

const a: Trip = {
  id: "https://pod.example/trips/a#it",
  name: "Lisbon",
  startDate: "2026-12-01",
  endDate: "2026-12-05",
  etag: '"1"',
  reservations: ["https://pod.example/manual#it"],
};
const b: Trip = { ...a, id: "https://pod.example/trips/b#it", name: "York", reservations: [] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(
  saveTrip: Mock<(trip: Trip) => Promise<Trip>> = vi.fn(async (trip: Trip) => ({
    ...trip,
    etag: '"new"',
  })),
) {
  const store = {
    saveTrip,
    addReservation: vi.fn(async (input) => ({
      ...input,
      id: "https://pod.example/new#it",
      etag: '"created"',
    })),
    deleteReservation: vi.fn(async () => {}),
  } as unknown as TripsStore;
  const failure = vi.fn();
  const state = createTripsState(store, { trips: [a, b], reservations: [] }, failure);
  return { store, state, failure, saveTrip };
}
describe("Trips optimistic journal", () => {
  it("paints immediately, serialises writes and rebases a newer patch after an older failure", async () => {
    let reject: (reason: Error) => void = () => {};
    const save = vi
      .fn<(trip: Trip) => Promise<Trip>>()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockImplementation(async (trip) => ({ ...trip, etag: '"2"' }));
    const { state, failure } = setup(save);
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    state.edit(a.id, { name: "Failed name" });
    state.edit(a.id, { notes: "Keep this note" });
    expect(state.getSnapshot().trips[0]).toMatchObject({
      name: "Failed name",
      notes: "Keep this note",
    });
    expect(state.getSnapshot().saving).toBe(2);
    reject(new Error("offline"));
    await tick();
    await tick();
    expect(state.getSnapshot().trips[0]).toMatchObject({ name: "Lisbon", notes: "Keep this note" });
    expect(failure).toHaveBeenCalledOnce();
    expect(state.getSnapshot().saving).toBe(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it("does not resurrect two failed edits or publish after disposal", async () => {
    const { state } = setup(
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const listener = vi.fn();
    state.subscribe(listener);
    state.edit(a.id, { name: "one" });
    state.edit(a.id, { name: "two" });
    await tick();
    await tick();
    expect(state.getSnapshot().trips[0]?.name).toBe("Lisbon");
    state.dispose();
    const calls = listener.mock.calls.length;
    state.edit(a.id, { name: "hidden" });
    await tick();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
  it("maps an optimistic new trip ID before a queued edit", async () => {
    const save = vi.fn(async (trip: Trip) => ({
      ...trip,
      id: trip.id.startsWith("pending:") ? "https://pod.example/trips/new#it" : trip.id,
      etag: '"2"',
    }));
    const { state } = setup(save);
    state.add({ ...b, id: "pending:new", etag: undefined, name: "New" });
    state.edit("pending:new", { name: "Renamed" });
    expect(state.getSnapshot().trips.at(-1)?.name).toBe("Renamed");
    await tick();
    await tick();
    expect(state.getSnapshot().trips.at(-1)).toMatchObject({
      name: "Renamed",
      id: "https://pod.example/trips/new#it",
    });
  });
  it("adds a manual booking optimistically then records the returned URL", async () => {
    const { state } = setup();
    state.addBooking(a.id, { kind: "LodgingReservation", title: "Example Hotel" });
    expect(state.getSnapshot().reservations[0]?.id).toMatch(/^pending:/);
    await tick();
    expect(state.getSnapshot().reservations[0]?.id).toBe("https://pod.example/new#it");
    expect(state.getSnapshot().trips[0]?.reservations).toContain("https://pod.example/new#it");
  });
  it("moves between trips and compensates a failed source write with the new target ETag", async () => {
    const { state, saveTrip } = setup();
    state.move(a.reservations[0] as string, a.id, b.id);
    expect(state.getSnapshot().trips[0]?.reservations).toEqual([]);
    await tick();
    expect(state.getSnapshot().trips[1]?.reservations).toEqual(a.reservations);
    expect(saveTrip).toHaveBeenCalledTimes(2);
    state.move(a.reservations[0] as string, b.id, b.id);
    expect(saveTrip).toHaveBeenCalledTimes(2);
    const failSource = vi
      .fn<(trip: Trip) => Promise<Trip>>()
      .mockResolvedValueOnce({ ...b, reservations: a.reservations, etag: '"target"' })
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(b);
    const rollback = setup(failSource);
    rollback.state.move(a.reservations[0] as string, a.id, b.id);
    await tick();
    expect(failSource.mock.calls[2]?.[0]).toMatchObject({
      id: b.id,
      etag: '"target"',
      reservations: [],
    });
    expect(rollback.state.getSnapshot().trips[0]?.reservations).toEqual(a.reservations);
  });
  it("accepts suggestions without changing connector records", async () => {
    const { state, store } = setup();
    const reservation = {
      id: "https://pod.example/mail/trips/one#it",
      kind: "FlightReservation" as const,
    };
    state.accept({ ...b, id: "suggestion:x", reservations: [reservation.id] }, [reservation]);
    expect(state.getSnapshot().trips).toHaveLength(3);
    await tick();
    expect(state.getSnapshot().reservations).toEqual([reservation]);
    expect(store.addReservation).not.toHaveBeenCalled();
  });
  it("reports missing trips without issuing a write", async () => {
    const { state, saveTrip, failure } = setup();
    state.edit("missing", { name: "No" });
    await tick();
    expect(saveTrip).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
  });
});

it("reconciles a partially committed move if its compensation also fails", async () => {
  const save = vi
    .fn<(trip: Trip) => Promise<Trip>>()
    .mockResolvedValueOnce({ ...b, reservations: a.reservations, etag: '"target"' })
    .mockRejectedValue(new Error("offline"));
  const { state, store, failure } = setup(save);
  store.load = vi.fn(async () => ({
    trips: [a, { ...b, reservations: a.reservations }],
    reservations: [],
  }));
  state.move(a.reservations[0] as string, a.id, b.id);
  await tick();
  expect(store.load).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledWith(expect.stringContaining("Part of this move"));
  expect(state.getSnapshot().trips[1]?.reservations).toEqual(a.reservations);
});

it("moves an optimistic manual booking using its returned identifier after creation finishes", async () => {
  const { state } = setup();
  state.addBooking(a.id, {
    kind: "FlightReservation",
    provider: "Example",
    reservationNumber: "manual",
  });
  const temporary = state.getSnapshot().reservations[0]?.id as string;
  state.move(temporary, a.id, b.id);
  await tick();
  await tick();
  expect(state.resolveId(temporary)).toBe("https://pod.example/new#it");
  expect(state.getSnapshot().trips[0]?.reservations).not.toContain("https://pod.example/new#it");
  expect(state.getSnapshot().trips[1]?.reservations).toContain("https://pod.example/new#it");
});
it("keeps an accepted trip editable while its pod identifier is being assigned", async () => {
  const save = vi.fn(async (trip: Trip) => ({
    ...trip,
    id: trip.id.startsWith("pending:") ? "https://pod.example/accepted#it" : trip.id,
    etag: '"saved"',
  }));
  const { state } = setup(save);
  state.accept({ ...b, id: "suggestion:one" }, []);
  const temporary = state.getSnapshot().trips.at(-1)?.id as string;
  state.edit(temporary, { name: "My accepted trip" });
  await tick();
  await tick();
  expect(state.resolveId(temporary)).toBe("https://pod.example/accepted#it");
  expect(state.getSnapshot().trips.at(-1)?.name).toBe("My accepted trip");
});

it("handles a trip disappearing before a queued booking or move is persisted", async () => {
  const { state, saveTrip, failure } = setup();
  state.addBooking("missing", { kind: "FlightReservation" });
  await tick();
  state.move("booking", "missing", b.id);
  await tick();
  state.move("booking", a.id, "missing");
  await tick();
  expect(failure).toHaveBeenCalledTimes(3);
  expect(saveTrip).not.toHaveBeenCalled();
});
it("preserves uninvolved trips while moving a booking", async () => {
  const { state } = setup();
  state.add({ ...b, id: "https://pod.example/trips/third#it", name: "Third" });
  await tick();
  state.move(a.reservations[0] as string, a.id, b.id);
  await tick();
  expect(state.getSnapshot().trips[2]?.name).toBe("Third");
  expect(state.getSnapshot().trips[2]?.reservations).toEqual([]);
});
it("keeps the confirmed view when partial-move reconciliation is also offline", async () => {
  const save = vi
    .fn<(trip: Trip) => Promise<Trip>>()
    .mockResolvedValueOnce({ ...b, reservations: a.reservations, etag: '"target"' })
    .mockRejectedValue(new Error("offline"));
  const { state, store } = setup(save);
  store.load = vi.fn(async () => {
    throw new Error("offline");
  });
  state.move(a.reservations[0] as string, a.id, b.id);
  await tick();
  expect(state.getSnapshot().trips[1]?.reservations).toEqual([]);
  expect(state.getSnapshot().error).toContain("Part of this move");
});

it("removes a new booking when linking it to a trip fails, even if compensation is offline", async () => {
  for (const cleanupFails of [false, true]) {
    const { state, store, failure } = setup(
      vi.fn(async () => {
        throw new Error("conflict");
      }),
    );
    if (cleanupFails) vi.mocked(store.deleteReservation).mockRejectedValue(new Error("offline"));
    state.addBooking(a.id, { kind: "FlightReservation", title: "New booking" });
    await tick();
    expect(store.deleteReservation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "https://pod.example/new#it", etag: '"created"' }),
    );
    expect(state.getSnapshot().reservations).toEqual([]);
    expect(state.resolveId("pending:missing")).toBe("pending:missing");
    expect(failure).toHaveBeenCalledOnce();
  }
});
it("does not create an orphan booking for a trip that has disappeared", async () => {
  const { state, store } = setup();
  state.addBooking("missing", { kind: "FlightReservation" });
  await tick();
  expect(store.addReservation).not.toHaveBeenCalled();
  expect(store.deleteReservation).not.toHaveBeenCalled();
});

it("compensates a new booking on a definite 412 trip refusal", async () => {
  const refused = new StorageError("precondition-failed", {
    status: 412,
    method: "PUT",
    url: a.id,
  });
  const { state, store, failure } = setup(
    vi.fn(async () => {
      throw refused;
    }),
  );
  state.addBooking(a.id, { kind: "FlightReservation", title: "New booking" });
  await tick();
  expect(store.deleteReservation).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"));
});
it("keeps a new booking and reloads when the trip write outcome is unknown", async () => {
  const { state, store, failure } = setup(
    vi.fn(async () => {
      throw new UnconfirmedWriteError(new Error("connection reset"));
    }),
  );
  const linked = { ...a, reservations: [...a.reservations, "https://pod.example/new#it"] };
  store.load = vi.fn(async () => ({
    trips: [linked, b],
    reservations: [{ id: "https://pod.example/new#it", kind: "FlightReservation" as const }],
  }));
  state.addBooking(a.id, { kind: "FlightReservation", title: "New booking" });
  await tick();
  await tick();
  // The PUT may have committed: deleting the booking could leave the trip with a dangling link.
  expect(store.deleteReservation).not.toHaveBeenCalled();
  expect(store.load).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledWith(expect.stringContaining("couldn't confirm"));
  expect(state.getSnapshot().trips[0]?.reservations).toContain("https://pod.example/new#it");
});
it("does not roll back the target when the source write outcome is unknown", async () => {
  const save = vi
    .fn<(trip: Trip) => Promise<Trip>>()
    .mockResolvedValueOnce({ ...b, reservations: a.reservations, etag: '"target"' })
    .mockRejectedValueOnce(new UnconfirmedWriteError(new Error("connection reset")))
    .mockResolvedValue(b);
  const { state, store, failure } = setup(save);
  // The source PUT committed: the booking now lives only in the target trip.
  store.load = vi.fn(async () => ({
    trips: [
      { ...a, reservations: [] },
      { ...b, reservations: a.reservations },
    ],
    reservations: [],
  }));
  state.move(a.reservations[0] as string, a.id, b.id);
  await tick();
  await tick();
  // A rollback would remove the booking from the target too, leaving it in neither trip.
  expect(save).toHaveBeenCalledTimes(2);
  expect(store.load).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledWith(expect.stringContaining("couldn't confirm"));
  expect(state.getSnapshot().error).toContain("couldn't confirm");
  expect(state.getSnapshot().trips[0]?.reservations).toEqual([]);
  expect(state.getSnapshot().trips[1]?.reservations).toEqual(a.reservations);
});
it("marks a pending manual booking as manual so it is trusted while it saves", async () => {
  const { state } = setup();
  const booking = {
    kind: "FlightReservation" as const,
    provider: "Example",
    reservationNumber: "ABC",
  };
  state.addBooking(a.id, booking);
  const pending = state.getSnapshot().reservations[0];
  expect(pending).toMatchObject({ origin: "manual" });
  expect(pending && isTrusted(pending)).toBe(true);
  // An untrusted connector duplicate must not outrank the pending manual copy.
  const unverified = {
    ...booking,
    id: "https://pod.example/mail/trips/abc#it",
    modified: "2026-12-02T00:00:00Z",
    trust: "unverified" as const,
  };
  const pendingItem = pending as NonNullable<typeof pending>;
  expect(deduplicate([pendingItem, unverified]).map((item) => item.id)).toEqual([pendingItem.id]);
  // An explicit trust claim on the input is left to isTrusted, as in the store.
  state.addBooking(a.id, { ...booking, reservationNumber: "DEF", trust: "unverified" });
  const claimed = state.getSnapshot().reservations.at(-1);
  expect(claimed?.origin).toBeUndefined();
  expect(claimed && isTrusted(claimed)).toBe(false);
  await tick();
  await tick();
});
