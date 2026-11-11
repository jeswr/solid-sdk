// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import { type Reply, RSVP_RESPONSE, summariseRsvps } from "../src/index.js";

const event = { url: "https://host.example/events/1/index.ttl#it" };
const reply = (patch: Partial<Reply> = {}): Reply => ({
  url: "https://host.example/r/a",
  event: event.url,
  agent: "https://guest.example/me",
  response: RSVP_RESPONSE.yes,
  additionalGuests: 2,
  repliedAt: new Date("2026-11-11T12:00:00Z"),
  ...patch,
});
it("tallies an empty invitation without capacity", () => {
  expect(summariseRsvps([], event)).toMatchObject({
    yes: 0,
    no: 0,
    maybe: 0,
    attending: 0,
    additionalGuests: 0,
    remaining: null,
    overCapacity: 0,
    late: [],
    latest: [],
    invalid: 0,
  });
});
it("uses the latest agent response, deterministic ties, and only yes plus-guests", () => {
  const replies = [
    reply(),
    reply({ url: "https://host.example/r/b", response: RSVP_RESPONSE.no }),
    reply({
      url: "https://host.example/r/c",
      agent: "https://other.example/me",
      response: RSVP_RESPONSE.maybe,
      additionalGuests: 50,
    }),
    reply({ url: "https://host.example/r/d", agent: "https://third.example/me" }),
    reply({
      url: "https://host.example/r/e",
      agent: "https://fourth.example/me",
      repliedAt: new Date("2026-11-10T12:00:00Z"),
      additionalGuests: 0,
    }),
  ];
  const summary = summariseRsvps(replies, {
    ...event,
    capacity: 3,
    rsvpDeadline: new Date("2026-11-11T11:59:00Z"),
  });
  expect(summary).toMatchObject({
    yes: 2,
    no: 1,
    maybe: 1,
    additionalGuests: 2,
    attending: 4,
    remaining: 0,
    overCapacity: 1,
    invalid: 0,
  });
  expect(summary.late).toHaveLength(3);
  expect(summariseRsvps([...replies].reverse(), { ...event, capacity: 3 })).toMatchObject({
    latest: summary.latest,
  });
});
it("keeps anonymous people with the same name distinct and applies changes by guest key", () => {
  const anonymous = reply({ agent: undefined, guestKey: "one", displayName: "Alex" });
  const other = reply({
    agent: undefined,
    guestKey: "two",
    displayName: "Alex",
    url: "https://host.example/r/b",
  });
  const changed = {
    ...anonymous,
    response: RSVP_RESPONSE.maybe,
    url: "https://host.example/r/c",
    repliedAt: new Date(+anonymous.repliedAt + 1000),
  };
  expect(summariseRsvps([anonymous, other, changed], { ...event, capacity: 8 })).toMatchObject({
    yes: 1,
    maybe: 1,
    attending: 3,
    remaining: 5,
  });
});
it("ignores older replies even when received later, invalid data and other event claims", () => {
  const current = reply();
  const old = reply({
    url: "https://host.example/r/b",
    repliedAt: new Date("2020-01-01T00:00:00Z"),
    response: RSVP_RESPONSE.no,
  });
  const result = summariseRsvps(
    [
      current,
      old,
      reply({ additionalGuests: NaN }),
      reply({ event: "https://other.example/e#it" }),
    ],
    { ...event, rsvpDeadline: current.repliedAt },
  );
  expect(result).toMatchObject({ yes: 1, invalid: 2, late: [] });
});

it("accepts the invitation document URL as well as its generated subject", () => {
  expect(summariseRsvps([reply()], { url: "https://host.example/events/1/index.ttl" }).yes).toBe(1);
});
