// AUTHORED-BY Codex (GPT-6.1 Sol)
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  bookingTime,
  buildReservation,
  groupIntoTrips,
  parseReservations,
  parseReservationTime,
  reservationKinds,
} from "../src/index.js";

const doc = "https://pod.example/mail/account/trips/opaque.ttl";
async function fixture() {
  return readFile(new URL("fixtures/connector.ttl", import.meta.url), "utf8");
}
describe("CON-A8 writer interoperability", () => {
  it("reads all seven writer fixtures and groups all six dated bookings", async () => {
    const reservations = parseReservations(await parseRdf(await fixture(), "text/turtle"));
    expect(reservations).toHaveLength(7);
    expect(reservations.find((r) => r.kind === "FlightReservation")).toMatchObject({
      provider: "Example Air",
      status: "https://schema.org/ReservationConfirmed",
      start: "2026-12-01T09:00:00Z",
      trust: "verified",
      fromCode: "AAA",
      toCode: "BBB",
      underName: "Example Traveller",
    });
    expect(reservations.filter((r) => r.start)).toHaveLength(6);
    expect(groupIntoTrips(reservations, []).flatMap((t) => t.reservations)).toHaveLength(6);
    const missingReceiverTime = parseReservations(
      await parseRdf(
        (await fixture()).replaceAll(' ; s:dateModified "2026-12-01T09:00:00Z"^^x:dateTime', ""),
        "text/turtle",
      ),
    );
    expect(
      missingReceiverTime.find((r) => r.kind === "TrainReservation")?.modified,
    ).toBeUndefined();
  });
  it.each([
    "s:airline :air",
    "s:provider :air",
    's:provider "Example Air"',
  ])("reads a booking-level provider via %s", async (provider) => {
    const ttl = (await fixture())
      .replace("s:provider :air ; s:underName", "s:underName")
      .replace("s:airline :air", provider);
    expect(parseReservations(await parseRdf(ttl, "text/turtle"))[0]?.provider).toBe("Example Air");
  });
  it("reads a root provider literal, IRI status and typed times, ignoring sender keys and slug spelling", async () => {
    const ttl =
      (await fixture())
        .replace("s:provider :air", 's:provider "Literal Air"')
        .replace(
          's:reservationStatus "https://schema.org/ReservationConfirmed"',
          "s:reservationStatus <https://schema.org/ReservationConfirmed>",
        )
        .replace(
          's:departureTime "2026-12-01T09:00:00Z"',
          's:departureTime "2026-12-01T09:00:00+02:00"^^x:dateTime',
        )
        .replace("opaque.ttl", "sender-key-hash.ttl") +
      `\n<${doc}#unrelated> f:emailMarkupSenderKey "opaque-sender" .`;
    expect(parseReservations(await parseRdf(ttl, "text/turtle"))[0]).toMatchObject({
      provider: "Literal Air",
      status: "https://schema.org/ReservationConfirmed",
      start: "2026-12-01T09:00:00+02:00",
      trust: "verified",
    });
  });
  it.each([
    "2026-02-30T12:00:00Z",
    "no date",
    "2026-12-01T25:00:00Z",
    "2026-12-01T12:00:00+15:00",
  ])("drops invalid ISO time %s without dropping a booking", async (value) => {
    const data = parseReservations(
      await parseRdf(
        (await fixture()).replace('2026-12-01T09:00:00Z" ; f:', `${value}" ; f:`),
        "text/turtle",
      ),
    );
    expect(data[0]?.start).toBeUndefined();
  });
  it.each(reservationKinds)("round-trips a manual %s booking name", (kind) => {
    expect(
      parseReservations(
        buildReservation("https://pod.example/manual", { kind, title: "My booking" }),
      )[0]?.title,
    ).toBe("My booking");
  });
  it("only accepts reservation subjects from the fetched document", async () => {
    const graph = await parseRdf(
      (await fixture()) +
        '\n<https://pod.example/trips/reservations/manual#it> a s:FlightReservation ; s:reservationNumber "spoofed" .',
      "text/turtle",
    );
    expect(parseReservations(graph, doc)).toHaveLength(7);
  });
});

it("normalises datetime-local values with an optional offset, without guessing a zone", () => {
  expect(bookingTime("2026-12-01T09:30")).toBe("2026-12-01T09:30:00");
  expect(bookingTime("2026-12-01T09:30", "+02:30")).toBe("2026-12-01T09:30:00+02:30");
  expect(bookingTime("2026-12-01T09:30:45", "Z")).toBe("2026-12-01T09:30:45Z");
  expect(bookingTime("")).toBeUndefined();
  for (const [local, offset] of [
    ["", "Z"],
    ["bad", ""],
    ["2026-02-30T12:00", ""],
    ["2026-12-01T09:30", "+14:01"],
    ["2026-12-01T09:30", "+02:60"],
  ])
    expect(() => bookingTime(local as string, offset)).toThrow();
  expect(parseReservationTime(undefined)).toBeUndefined();
  expect(parseReservationTime("2026-12-01T09:30:60Z")).toBeUndefined();
  expect(parseReservationTime("2026-12-01T09:30:00.123+14:00")).toBe(
    "2026-12-01T09:30:00.123+14:00",
  );
});
it("accepts string modification times and handles missing receiver time deterministically", async () => {
  const data = parseReservations(
    await parseRdf(
      (await fixture()).replace('"2026-12-01T09:00:00Z"^^x:dateTime', '"2026-12-01T09:00:00Z"'),
      "text/turtle",
    ),
  );
  expect(data[0]?.modified).toBe("2026-12-01T09:00:00.000Z");
});

it("retains ISO times with minute precision from connector strings", async () => {
  const graph = await parseRdf(
    (await fixture()).replace(
      's:departureTime "2026-12-01T09:00:00Z"',
      's:departureTime "2026-12-01T09:00Z"',
    ),
    "text/turtle",
  );
  expect(parseReservations(graph)[0]?.start).toBe("2026-12-01T09:00Z");
  expect(groupIntoTrips(parseReservations(graph), []).length).toBeGreaterThan(0);
});

it("keeps manual xsd:dateTime literals valid by requiring seconds (the local-time form normalises them)", () => {
  expect(() =>
    buildReservation("https://pod.example/manual", {
      kind: "FlightReservation",
      start: "2026-12-01T09:30Z",
    }),
  ).toThrow("including seconds");
});
