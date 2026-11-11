// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  bookingKey,
  type ReservationInput,
  type Trip,
  type TripSnapshot,
  type TripsStore,
} from "@jeswr/solid-trips";

class PartialMoveError extends Error {}
export interface TripsView extends TripSnapshot {
  saving: number;
  error?: string | undefined;
}
type Pending = {
  apply(snapshot: TripSnapshot): TripSnapshot;
  persist(snapshot: TripSnapshot): Promise<TripSnapshot>;
};
/** One session owns this ordered journal. Confirmed state plus pending intentions governs rollback. */
export function createTripsState(
  store: TripsStore,
  initial: TripSnapshot,
  onFailure: (message: string) => void,
) {
  let confirmed = initial;
  let pending: Pending[] = [];
  let view: TripsView = { ...initial, saving: 0 };
  let alive = true;
  const listeners = new Set<() => void>();
  const ids = new Map<string, string>();
  const actual = (id: string) => ids.get(id) ?? id;
  const publish = (error?: string) => {
    if (!alive) return;
    view = {
      ...pending.reduce((snapshot, op) => op.apply(snapshot), confirmed),
      saving: pending.length,
      error,
    };
    for (const listener of listeners) listener();
  };
  async function drain(next: Pending) {
    let error: string | undefined;
    try {
      confirmed = await next.persist(confirmed);
    } catch (cause) {
      if (cause instanceof PartialMoveError) {
        try {
          confirmed = await store.load();
        } catch {
          /* Keep the last confirmed view until a reload succeeds. */
        }
        error =
          "Part of this move reached your pod. Reload to check both trips before trying again.";
      } else error = "Couldn't save this change. Your itinerary has been restored.";
      if (alive) onFailure(error);
    }
    pending = pending.slice(1);
    publish(error);
    const following = pending[0];
    if (following) void drain(following);
  }
  function enqueue(operation: Pending) {
    const start = !pending.length;
    pending.push(operation);
    publish();
    if (start) void drain(operation);
  }
  function edit(id: string, patch: Partial<Omit<Trip, "id" | "etag">>) {
    const apply = (snapshot: TripSnapshot): TripSnapshot => ({
      ...snapshot,
      trips: snapshot.trips.map((trip) =>
        trip.id === actual(id) || trip.id === id ? { ...trip, ...patch } : trip,
      ),
    });
    enqueue({
      apply,
      persist: async (snapshot) => {
        const draft = apply(snapshot).trips.find((trip) => trip.id === actual(id));
        if (!draft) throw new Error("Trip no longer exists");
        const saved = await store.saveTrip(draft);
        return {
          ...snapshot,
          trips: snapshot.trips.map((trip) => (trip.id === actual(id) ? saved : trip)),
        };
      },
    });
  }
  return {
    getSnapshot: () => view,
    resolveId: actual,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      alive = false;
      listeners.clear();
    },
    edit,
    add(trip: Trip) {
      enqueue({
        apply: (snapshot) => ({ ...snapshot, trips: [...snapshot.trips, trip] }),
        persist: async (snapshot) => {
          const saved = await store.saveTrip(trip);
          ids.set(trip.id, saved.id);
          return { ...snapshot, trips: [...snapshot.trips, saved] };
        },
      });
    },
    addBooking(tripId: string, input: ReservationInput) {
      const temporary = { ...input, id: `pending:${crypto.randomUUID()}` };
      enqueue({
        apply: (snapshot) => ({
          reservations: [...snapshot.reservations, temporary],
          trips: snapshot.trips.map((trip) =>
            trip.id === actual(tripId) || trip.id === tripId
              ? { ...trip, reservations: [...trip.reservations, temporary.id] }
              : trip,
          ),
        }),
        persist: async (snapshot) => {
          const reservation = await store.addReservation(input);
          ids.set(temporary.id, reservation.id);
          const trip = snapshot.trips.find((entry) => entry.id === actual(tripId));
          if (!trip) throw new Error("Trip no longer exists");
          const saved = await store.saveTrip({
            ...trip,
            reservations: [...trip.reservations, reservation.id],
          });
          return {
            trips: snapshot.trips.map((entry) => (entry.id === saved.id ? saved : entry)),
            reservations: [...snapshot.reservations, reservation],
          };
        },
      });
    },
    move(reservationId: string, fromId: string, toId: string) {
      if (fromId === toId) return;
      const selected = view.reservations.find((item) => item.id === reservationId);
      const equivalents = new Set([
        reservationId,
        ...view.reservations
          .filter((item) => selected && bookingKey(item) === bookingKey(selected))
          .map((item) => item.id),
      ]);
      const equivalent = (id: string) => equivalents.has(id) || id === actual(reservationId);
      const apply = (snapshot: TripSnapshot) => ({
        ...snapshot,
        trips: snapshot.trips.map((trip) =>
          trip.id === actual(fromId)
            ? { ...trip, reservations: trip.reservations.filter((id) => !equivalent(id)) }
            : trip.id === actual(toId)
              ? {
                  ...trip,
                  reservations: [...new Set([...trip.reservations, actual(reservationId)])],
                }
              : trip,
        ),
      });
      enqueue({
        apply,
        persist: async (snapshot) => {
          const from = snapshot.trips.find((trip) => trip.id === actual(fromId));
          const to = snapshot.trips.find((trip) => trip.id === actual(toId));
          if (!from || !to) throw new Error("Trip no longer exists");
          const target = await store.saveTrip({
            ...to,
            reservations: [...new Set([...to.reservations, actual(reservationId)])],
          });
          try {
            const source = await store.saveTrip({
              ...from,
              reservations: from.reservations.filter((id) => !equivalent(id)),
            });
            return {
              ...snapshot,
              trips: snapshot.trips.map((trip) =>
                trip.id === source.id ? source : trip.id === target.id ? target : trip,
              ),
            };
          } catch (error) {
            try {
              await store.saveTrip({ ...to, etag: target.etag });
            } catch {
              throw new PartialMoveError();
            }
            throw error;
          }
        },
      });
    },
    accept(trip: Trip, reservations: TripSnapshot["reservations"]) {
      const draft = { ...trip, id: `pending:${crypto.randomUUID()}` };
      enqueue({
        apply: (snapshot) => ({
          trips: [...snapshot.trips, draft],
          reservations: [
            ...new Map(
              [...snapshot.reservations, ...reservations].map((item) => [item.id, item]),
            ).values(),
          ],
        }),
        persist: async (snapshot) => {
          const saved = await store.saveTrip(draft);
          ids.set(draft.id, saved.id);
          return {
            trips: [...snapshot.trips, saved],
            reservations: [
              ...new Map(
                [...snapshot.reservations, ...reservations].map((item) => [item.id, item]),
              ).values(),
            ],
          };
        },
      });
    },
  };
}
export type TripsState = ReturnType<typeof createTripsState>;
