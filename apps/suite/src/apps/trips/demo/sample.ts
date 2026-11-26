// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { ReservationInput, TripsStore } from "@jeswr/solid-trips";
import type { PodSession } from "@/lib/session/pod-session";

const seeds = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureSample(
  session: PodSession,
  store: TripsStore,
  now = new Date(),
): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const previous = seeds.get(session.fetch);
  if (previous) return previous;
  const task = seed(store, now).catch((error: unknown) => {
    seeds.delete(session.fetch);
    throw error;
  });
  seeds.set(session.fetch, task);
  return task;
}
async function seed(store: TripsStore, now: Date) {
  if ((await store.load()).trips.length) return;
  const date = (days: number) =>
    new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const groups: {
    name: string;
    destination: string;
    days: number;
    bookings: ReservationInput[];
  }[] = [
    {
      name: "A long weekend in Lisbon",
      destination: "Lisbon",
      days: 18,
      bookings: [
        {
          kind: "FlightReservation",
          title: "Flight to Lisbon",
          provider: "Example Air",
          reservationNumber: "EX4Q8R",
          number: "EX204",
          fromCode: "LHR",
          toCode: "LIS",
          from: "London Heathrow",
          to: "Lisbon",
          start: `${date(18)}T09:30:00+00:00`,
          end: `${date(18)}T12:15:00+00:00`,
          trust: "verified",
        },
        {
          kind: "LodgingReservation",
          provider: "Example Stays",
          reservationNumber: "STAY42",
          title: "Casa da Aurora (fictional)",
          address: "12 Example Square, Lisbon",
          start: `${date(18)}T15:00:00+00:00`,
          end: `${date(21)}T11:00:00+00:00`,
          trust: "unverified",
        },
        {
          kind: "FlightReservation",
          provider: "Example Air",
          reservationNumber: "EX4Q8R-RETURN",
          number: "EX205",
          fromCode: "LIS",
          toCode: "LHR",
          from: "Lisbon",
          to: "London Heathrow",
          start: `${date(21)}T17:20:00+00:00`,
          end: `${date(21)}T20:00:00+00:00`,
          trust: "verified",
        },
      ],
    },
    {
      name: "York by rail",
      destination: "York",
      days: -24,
      bookings: [
        {
          kind: "TrainReservation",
          provider: "Example Rail",
          reservationNumber: "RAIL88",
          number: "ER81",
          from: "London King's Cross",
          to: "York",
          start: `${date(-24)}T10:00:00+00:00`,
          end: `${date(-24)}T12:05:00+00:00`,
          trust: "verified",
        },
      ],
    },
  ];
  for (const group of groups) {
    const reservations = [];
    for (const booking of group.bookings)
      reservations.push(
        (await store.addReservation({ ...booking, underName: "Robin Example" })).id,
      );
    await store.saveTrip({
      id: `sample:${group.days}`,
      name: group.name,
      destination: group.destination,
      startDate: date(group.days),
      endDate: date(group.days + (group.days > 0 ? 3 : 0)),
      notes: "Fictional sample bookings. Make yourself at home.",
      reservations,
    });
  }
}
