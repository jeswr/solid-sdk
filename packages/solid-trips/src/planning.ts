// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { Reservation, Trip } from "./types.js";

const DAY = 86_400_000;
/** Three clear days between bookings starts a new suggestion. */
export const DEFAULT_GAP_DAYS = 3;
const key = (value: string) => value.trim().toLocaleLowerCase("en-GB");
export function bookingKey(item: Reservation): string {
  return item.reservationNumber?.trim() && item.provider?.trim()
    ? JSON.stringify([key(item.reservationNumber), key(item.provider)])
    : item.id;
}
/**
 * Trusted means a verified email markup sender, or the user's own manual record that
 * claims no email trust. Missing trust on any other record is never trusted.
 */
export function isTrusted(item: Pick<Reservation, "trust" | "origin">): boolean {
  return item.trust === "verified" || (item.origin === "manual" && item.trust !== "unverified");
}
/**
 * A trusted copy always beats an untrusted one, whatever its timestamp, so a spoofed
 * later email cannot replace a verified booking. Within a trust rank the newest
 * `modified` wins; equal timestamps use the lexical identifier for stable results.
 */
export function deduplicate(reservations: readonly Reservation[]): Reservation[] {
  const byKey = new Map<string, Reservation>();
  for (const item of reservations) {
    const k = bookingKey(item);
    const old = byKey.get(k);
    if (old && isTrusted(old) !== isTrusted(item)) {
      if (isTrusted(item)) byKey.set(k, item);
      continue;
    }
    const parsedTime = Date.parse(item.modified ?? "");
    const parsedPrevious = Date.parse(old?.modified ?? "");
    const time = Number.isFinite(parsedTime) ? parsedTime : Number.NEGATIVE_INFINITY;
    const previous = Number.isFinite(parsedPrevious) ? parsedPrevious : Number.NEGATIVE_INFINITY;
    if (!old || time > previous || (time === previous && item.id < old.id)) byKey.set(k, item);
  }
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
}
/** Keep calendar dates and local clock spelling; never infer a zone from a place. */
export function itinerary(trip: Pick<Trip, "reservations">, reservations: readonly Reservation[]) {
  const ids = new Set(trip.reservations);
  const members = reservations.filter((item) => ids.has(item.id));
  const keys = new Set(members.map(bookingKey));
  const days = new Map<string, Reservation[]>();
  for (const item of deduplicate(reservations).filter((entry) => keys.has(bookingKey(entry)))) {
    const date = item.start?.slice(0, 10) ?? "Undated";
    days.set(date, [...(days.get(date) ?? []), item]);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      items: items.sort(
        (a, b) =>
          (a.start ?? "").slice(11, 19).localeCompare((b.start ?? "").slice(11, 19)) ||
          a.id.localeCompare(b.id),
      ),
    }));
}
function dayNumber(value: string | undefined): number {
  return Date.parse(`${value?.slice(0, 10)}T00:00:00Z`);
}
function lastDay(item: Reservation): number {
  const end = dayNumber(item.end);
  return Number.isFinite(end) ? Math.max(end, dayNumber(item.start)) : dayNumber(item.start);
}
function destination(item: Reservation): string {
  return item.toCode ?? item.to ?? item.location ?? item.address ?? item.title ?? "Travel";
}
/** Suggestions only: explicit membership always wins, including older duplicate IRIs. */
export function groupIntoTrips(
  reservations: readonly Reservation[],
  existingTrips: readonly Trip[],
  options: { gapDays?: number; homeAirport?: string } = {},
): Trip[] {
  const gap = options.gapDays ?? DEFAULT_GAP_DAYS;
  if (!Number.isFinite(gap) || gap < 0) throw new TypeError("gapDays must be non-negative");
  const claimed = new Set(existingTrips.flatMap((trip) => trip.reservations));
  const claimedKeys = new Set(reservations.filter((item) => claimed.has(item.id)).map(bookingKey));
  const items = deduplicate(reservations)
    .filter(
      (item) =>
        !claimed.has(item.id) &&
        !claimedKeys.has(bookingKey(item)) &&
        Number.isFinite(dayNumber(item.start)),
    )
    .sort(
      (a, b) =>
        dayNumber(a.start) - dayNumber(b.start) ||
        (a.start ?? "").localeCompare(b.start ?? "") ||
        a.id.localeCompare(b.id),
    );
  const groups: Reservation[][] = [];
  let group: Reservation[] = [];
  let latest = 0;
  let home = options.homeAirport ? key(options.homeAirport) : "";
  let returned = false;
  for (const item of items) {
    const start = dayNumber(item.start);
    const nextDestination = destination(item);
    const currentDestinations = new Set(
      group.flatMap((entry) =>
        [entry.toCode, entry.to, entry.location, entry.address]
          .filter((v): v is string => !!v)
          .map(key),
      ),
    );
    const transport = [
      "FlightReservation",
      "TrainReservation",
      "BusReservation",
      "RentalCarReservation",
    ].includes(item.kind);
    const differentStay =
      !transport &&
      currentDestinations.size > 0 &&
      !currentDestinations.has(key(nextDestination)) &&
      start > latest + DAY;
    if (group.length && (returned || start - latest > gap * DAY || differentStay)) {
      groups.push(group);
      group = [];
      home = options.homeAirport ? key(options.homeAirport) : "";
    }
    if (!group.length && item.kind === "FlightReservation") home ||= key(item.fromCode ?? "");
    group.push(item);
    latest = Math.max(group.length === 1 ? Number.NEGATIVE_INFINITY : latest, lastDay(item));
    returned = item.kind === "FlightReservation" && !!home && key(item.toCode ?? "") === home;
  }
  if (group.length) groups.push(group);
  return groups.map((members) => {
    const first = members[0] as Reservation;
    const end = Math.max(...members.map(lastDay));
    const place = destination(first);
    return {
      id: `suggestion:${encodeURIComponent(first.id)}`,
      name: `Trip to ${place}`,
      destination: place,
      startDate: first.start?.slice(0, 10) as string,
      endDate: new Date(end).toISOString().slice(0, 10),
      reservations: members.map((entry) => entry.id),
    };
  });
}
