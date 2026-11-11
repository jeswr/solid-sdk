// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { LiteralAs, NamedNodeAs, OptionalAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";
import { type Reservation, type ReservationInput, reservationKinds, type Trip } from "./types.js";
export const SCHEMA = "http://schema.org/";
export { entities } from "./generated/model.js";
export function parseTrip(id: string, dataset: DatasetCore): Trip | undefined {
  const data = entities.Trip.parse(id, dataset);
  return data
    ? {
        ...data,
        id,
        startDate: data.startDate.toISOString().slice(0, 10),
        endDate: data.endDate.toISOString().slice(0, 10),
        created: data.created?.toISOString(),
        modified: data.modified?.toISOString(),
        reservations: [...(data.reservations ?? [])],
      }
    : undefined;
}
export function serializeTrip(trip: Trip): Promise<string> {
  if (
    !trip.name.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate) ||
    trip.startDate > trip.endDate
  )
    throw new TypeError("A trip needs a name and ordered dates");
  const data = {
    ...trip,
    startDate: new Date(`${trip.startDate}T00:00:00Z`),
    endDate: new Date(`${trip.endDate}T00:00:00Z`),
    created: trip.created ? new Date(trip.created) : undefined,
    modified: trip.modified ? new Date(trip.modified) : undefined,
  };
  const graph = entities.Trip.build(trip.id, data);
  const parsed = parseTrip(trip.id, graph);
  if (!parsed || parsed.startDate !== trip.startDate || parsed.endDate !== trip.endDate)
    throw new TypeError("Invalid trip dates");
  return entities.Trip.storeToTurtle(graph);
}
const target = {
  FlightReservation: "Flight",
  TrainReservation: "TrainTrip",
  BusReservation: "BusTrip",
  LodgingReservation: "LodgingBusiness",
  FoodEstablishmentReservation: "FoodEstablishment",
  EventReservation: "Event",
  RentalCarReservation: "Car",
} as const;
function timePath(kind: ReservationInput["kind"], field: "start" | "end") {
  if (kind === "LodgingReservation")
    return { child: false, predicate: field === "start" ? "checkinTime" : "checkoutTime" };
  if (kind === "FoodEstablishmentReservation")
    return { child: false, predicate: field === "start" ? "startTime" : "endTime" };
  if (kind === "RentalCarReservation")
    return { child: false, predicate: field === "start" ? "pickupTime" : "dropoffTime" };
  if (kind === "EventReservation")
    return { child: true, predicate: field === "start" ? "startDate" : "endDate" };
  return { child: true, predicate: field === "start" ? "departureTime" : "arrivalTime" };
}
const XSD = "http://www.w3.org/2001/XMLSchema#";
/** A date without a clock time is an all-day booking (for example an Event startDate). */
export const isAllDay = (value: string | undefined): boolean =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
/**
 * ISO calendar and clock validation, without inferring a zone for local times.
 * A bare calendar date is accepted as all-day and kept as given.
 */
export function parseReservationTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, date, hours = "00", minutes = "00", seconds, zone] = match;
  const day = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date ||
    Number(hours) > 23 ||
    Number(minutes) > 59 ||
    Number(seconds ?? 0) > 59
  )
    return undefined;
  if (zone && zone !== "Z") {
    const h = Number(zone.slice(1, 3)),
      m = Number(zone.slice(4));
    if (h > 14 || m > 59 || (h === 14 && m !== 0)) return undefined;
  }
  return value;
}
/** datetime-local form values plus an optional explicit offset; never use the browser zone. */
export function bookingTime(local: string, offset = ""): string | undefined {
  if (!local) {
    if (offset) throw new TypeError("Choose a local time before adding an offset");
    return undefined;
  }
  const value = `${local.length === 16 ? `${local}:00` : local}${offset}`;
  if (!parseReservationTime(value))
    throw new TypeError("Use a valid local date and time and an offset such as +01:00 or Z");
  return value;
}
// Generator gap: a field cannot project both a literal and an IRI. Keep this
// compatibility bridge in the facade; generated entities still recognise roots.
function providerName(subject: TermWrapper, predicate = "provider"): string | undefined {
  return OptionalFrom.subjectPredicate(subject, SCHEMA + predicate, (term) => {
    if (
      term.termType === "Literal" &&
      term.datatype.value === "http://www.w3.org/2001/XMLSchema#string"
    )
      return term.value;
    if (term.termType === "NamedNode")
      return new entities.Organization.Wrapper(term.value, subject.dataset, DataFactory).name;
    return undefined;
  });
}
export interface ParseReservationsOptions {
  /**
   * The document is in the user's own owner-only manual bookings container. Only the
   * store sets this, from the document location, never from RDF content.
   */
  manual?: boolean;
}
export function parseReservations(
  dataset: DatasetCore,
  documentUrl?: string,
  options: ParseReservationsOptions = {},
): Reservation[] {
  const result: Reservation[] = [];
  const subjects = new Set(
    [...dataset]
      .filter(
        (quad) =>
          quad.subject.termType === "NamedNode" &&
          (!documentUrl || quad.subject.value.split("#")[0] === documentUrl.split("#")[0]),
      )
      .map((quad) => quad.subject.value),
  );
  for (const id of subjects)
    for (const kind of reservationKinds) {
      const root = entities[kind].parse(id, dataset);
      if (!root) continue;
      const booking = root.booking
        ? new entities[target[kind]].Wrapper(root.booking, dataset, DataFactory)
        : undefined;
      const reservation = new entities[kind].Wrapper(id, dataset, DataFactory);
      const provider =
        providerName(reservation) ??
        (booking && (providerName(booking, "airline") ?? providerName(booking)));
      const underName = root.underName
        ? new entities.Person.Wrapper(root.underName, dataset, DataFactory).name
        : undefined;
      const item: Reservation = {
        id,
        kind,
        reservationNumber: root.reservationNumber,
        status:
          root.status ??
          OptionalFrom.subjectPredicate(reservation, `${SCHEMA}reservationStatus`, (term) =>
            term.termType === "NamedNode" ? NamedNodeAs.string(term) : undefined,
          ),
        title: root.title,
        provider,
        underName,
        source: root.source,
        modified:
          root.modified?.toISOString() ??
          (() => {
            const lexical = OptionalFrom.subjectPredicate(
              reservation,
              `${SCHEMA}dateModified`,
              (term) => (term.termType === "Literal" ? LiteralAs.string(term) : undefined),
            );
            const valid = parseReservationTime(lexical);
            return valid ? new Date(valid).toISOString() : undefined;
          })(),
        // Connector records without a trust flag fail closed to unverified. A manual
        // record claims no email trust unless one was stated explicitly.
        trust: options.manual ? root.trust : root.trust === "verified" ? "verified" : "unverified",
      };
      if (options.manual) item.origin = "manual";
      for (const field of ["title", "number", "address"] as const)
        if (booking && field in booking)
          item[field] ??= (booking as unknown as Record<string, string>)[field];
      for (const field of ["from", "to", "location"] as const) {
        const owner = field in root ? root : booking;
        const link =
          owner && field in owner ? (owner as unknown as Record<string, string>)[field] : undefined;
        if (!link) continue;
        const place = new entities.Place.Wrapper(link, dataset, DataFactory);
        item[field] = place.name;
        if (field !== "location") {
          item[field === "from" ? "fromCode" : "toCode"] = new entities.Airport.Wrapper(
            link,
            dataset,
            DataFactory,
          ).iataCode;
          item[field === "from" ? "fromAddress" : "toAddress"] = place.address;
        } else item.address = place.address;
      }
      for (const field of ["start", "end"] as const) {
        const path = timePath(kind, field);
        const owner = path.child ? booking : new entities[kind].Wrapper(id, dataset, DataFactory);
        if (owner)
          item[field] = parseReservationTime(
            OptionalFrom.subjectPredicate(owner, SCHEMA + path.predicate, (term) =>
              term.termType === "Literal" &&
              [`${XSD}string`, `${XSD}dateTime`, `${XSD}date`].includes(term.datatype.value)
                ? LiteralAs.string(term)
                : undefined,
            ),
          );
      }
      result.push(item);
    }
  return result;
}
export function buildReservation(url: string, input: ReservationInput) {
  if (!reservationKinds.includes(input.kind)) throw new TypeError("Unknown reservation type");
  const id = `${url}#it`,
    booking = `${url}#booking`,
    provider = `${url}#provider`,
    underName = `${url}#person`;
  const from = `${url}#from`,
    to = `${url}#to`,
    location = `${url}#location`;
  const data = {
    ...input,
    start: input.start,
    end: input.end,
    modified: input.modified ? new Date(input.modified) : undefined,
    booking,
    provider: input.provider ? provider : undefined,
    underName: input.underName ? underName : undefined,
    from: input.from || input.fromCode ? from : undefined,
    to: input.to || input.toCode ? to : undefined,
    location: input.location || input.address ? location : undefined,
  };
  const graph = new Store(entities[input.kind].build(id, data));
  const add = (store: Store) => {
    graph.addQuads([...store]);
  };
  add(entities[target[input.kind]].build(booking, data));
  if (input.provider) add(entities.Organization.build(provider, { name: input.provider }));
  if (input.underName) add(entities.Person.build(underName, { name: input.underName }));
  for (const [node, name, code, address] of [
    [from, input.from, input.fromCode, input.fromAddress],
    [to, input.to, input.toCode, input.toAddress],
    [location, input.location, undefined, input.address],
  ] as const) {
    if (name || code || address) {
      add(entities.Place.build(node, { name, address }));
      if (code) add(entities.Airport.build(node, { iataCode: code }));
    }
  }
  // Generator gap: dateTime maps to Date, losing the original lexical UTC offset.
  // The facade validates ISO times; typed accessors keep manual bookings as xsd:dateTime
  // with that offset intact. The lead tracks a generator lexical-dateTime projection.
  for (const field of ["start", "end"] as const) {
    const value = input[field];
    if (!value) continue;
    // xsd:dateTime needs seconds even when a connector string used ISO minute precision;
    // an all-day date is written as xsd:date.
    const allDay = isAllDay(value);
    if ((!allDay && !/T\d{2}:\d{2}:\d{2}/.test(value)) || !parseReservationTime(value))
      throw new TypeError("Use a valid ISO date and time including seconds");
    const path = timePath(input.kind, field);
    OptionalAs.object(
      new TermWrapper(path.child ? booking : id, graph, DataFactory),
      SCHEMA + path.predicate,
      value,
      (text, factory) =>
        factory.literal(text, factory.namedNode(`${XSD}${allDay ? "date" : "dateTime"}`)),
    );
  }
  const parsed = parseReservations(graph)[0];
  if (
    !parsed ||
    (input.start && parsed.start !== input.start) ||
    (input.end && parsed.end !== input.end)
  )
    throw new TypeError("Use a valid ISO date and time, with an offset when known");
  return graph;
}
export function serializeReservation(url: string, input: ReservationInput): Promise<string> {
  return entities[input.kind].storeToTurtle(buildReservation(url, input));
}
