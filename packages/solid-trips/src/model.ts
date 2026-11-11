// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { LiteralAs, OptionalAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
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
export function parseReservations(dataset: DatasetCore): Reservation[] {
  const result: Reservation[] = [];
  const subjects = new Set(
    [...dataset]
      .filter((quad) => quad.subject.termType === "NamedNode")
      .map((quad) => quad.subject.value),
  );
  for (const id of subjects)
    for (const kind of reservationKinds) {
      const root = entities[kind].parse(id, dataset);
      if (!root) continue;
      const booking = root.booking
        ? new entities[target[kind]].Wrapper(root.booking, dataset, DataFactory)
        : undefined;
      const provider = root.provider
        ? new entities.Organization.Wrapper(root.provider, dataset, DataFactory).name
        : undefined;
      const underName = root.underName
        ? new entities.Person.Wrapper(root.underName, dataset, DataFactory).name
        : undefined;
      const item: Reservation = {
        id,
        kind,
        reservationNumber: root.reservationNumber,
        status: root.status,
        provider,
        underName,
        source: root.source,
        modified: root.modified?.toISOString(),
        trust: root.trust === "verified" ? "verified" : "unverified",
      };
      for (const field of ["title", "number", "address"] as const)
        if (booking && field in booking)
          item[field] = (booking as unknown as Record<string, string>)[field];
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
        if (owner && field in owner && (owner as unknown as Record<string, unknown>)[field])
          item[field] = OptionalFrom.subjectPredicate(
            owner,
            SCHEMA + path.predicate,
            LiteralAs.string,
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
    start: input.start ? new Date(input.start) : undefined,
    end: input.end ? new Date(input.end) : undefined,
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
  // Generated dateTime guards validate these values. Typed accessors retain their original
  // lexical offset for the itinerary; projecting Date alone loses that source information.
  for (const field of ["start", "end"] as const) {
    const value = input[field];
    if (!value) continue;
    const path = timePath(input.kind, field);
    OptionalAs.object(
      new TermWrapper(path.child ? booking : id, graph, DataFactory),
      SCHEMA + path.predicate,
      value,
      (text, factory) =>
        factory.literal(text, factory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime")),
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
