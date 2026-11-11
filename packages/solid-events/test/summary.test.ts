// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { type Reply, RSVP_RESPONSE, summariseRsvps } from "../src/index.js";

const event = { url: "https://host.example/events/1/index.ttl#it" };
const reply = (patch: Partial<Reply> = {}): Reply => ({
  url: "https://host.example/r/a",
  event: event.url,
  agent: "https://guest.example/me",
  verifiedAgent: patch.agent ?? "https://guest.example/me",
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
      additionalGuests: 20,
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
it("groups guest claims by receipt hash without merging names or verifying identity", () => {
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
    yes: 0,
    maybe: 0,
    attending: 0,
    remaining: 5,
    unverified: [changed, other],
    earlierReplies: [anonymous],
    unverifiedTally: { yes: 1, maybe: 1, no: 0, attending: 3, additionalGuests: 2 },
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

it("never lets a claimed WebID or a copied guest hash override verified authorship", () => {
  const verified = { ...reply(), verifiedAgent: "https://guest.example/me" };
  const forged = reply({
    verifiedAgent: undefined,
    url: "https://host.example/r/forged",
    response: RSVP_RESPONSE.no,
    repliedAt: new Date("2026-11-11T12:01:00Z"),
  });
  const result = summariseRsvps([verified, forged], event);
  expect(result).toMatchObject({ yes: 1, no: 0, latest: [verified], unverified: [forged] });
  const copied = { ...forged, agent: undefined, displayName: "Alex", guestKey: "sha256:copied" };
  expect(
    summariseRsvps([copied, { ...copied, url: `${copied.url}2` }], event).unverified,
  ).toHaveLength(1);
});
it("groups WebID claims by server time, retains earlier replies and estimates capacity separately", () => {
  const old = reply({ verifiedAgent: undefined, receivedAt: new Date("2026-11-11T12:00Z") });
  const changed = reply({
    verifiedAgent: undefined,
    url: `${old.url}2`,
    response: RSVP_RESPONSE.no,
    repliedAt: new Date("2026-11-10T12:00Z"),
    receivedAt: new Date("2026-11-11T12:01Z"),
  });
  const guest = reply({
    agent: undefined,
    displayName: "Tavi",
    guestKey: "sha256:tavi",
    verifiedAgent: undefined,
  });
  const verified = reply({ agent: "https://verified.example/me", additionalGuests: 0 });
  const result = summariseRsvps([old, changed, guest, verified], { ...event, capacity: 6 });
  expect(result).toMatchObject({
    yes: 1,
    attending: 1,
    remaining: 2,
    overCapacity: 0,
    unverifiedTally: { yes: 1, no: 1, maybe: 0, attending: 3, additionalGuests: 2 },
    unverified: [changed, guest],
    earlierReplies: [old],
  });
  expect(summariseRsvps([verified, guest, changed, old], { ...event, capacity: 2 })).toMatchObject({
    remaining: 0,
    overCapacity: 2,
    unverified: result.unverified,
  });
});
it("ignores a future claimed time when a valid server time exists", () => {
  const serverReply = reply({
    repliedAt: new Date("2099-01-01"),
    receivedAt: new Date("2026-11-11T12:00Z"),
  });
  expect(summariseRsvps([serverReply], event)).toMatchObject({ yes: 1, invalid: 0 });
});
it("rejects future claims and orders verified replies by server time ahead of claimed time", () => {
  const agent = "https://guest.example/me";
  const first = { ...reply(), verifiedAgent: agent, receivedAt: new Date("2026-11-11T12:01:00Z") };
  const later = {
    ...reply({
      url: "https://host.example/r/b",
      response: RSVP_RESPONSE.no,
      repliedAt: new Date("2026-11-11T11:59:00Z"),
    }),
    verifiedAgent: agent,
    receivedAt: new Date("2026-11-11T12:02:00Z"),
  };
  const future = {
    ...reply({ url: "https://host.example/r/future", repliedAt: new Date("2099-01-01") }),
    verifiedAgent: agent,
  };
  expect(summariseRsvps([first, later, future], event)).toMatchObject({
    yes: 0,
    no: 1,
    invalid: 1,
  });
});

it("still flags unverified late claims without adding them to verified counts", () => {
  const claim = reply({ verifiedAgent: undefined });
  const summary = summariseRsvps([claim], {
    ...event,
    rsvpDeadline: new Date(+claim.repliedAt - 1000),
  });
  expect(summary).toMatchObject({ yes: 0, latest: [], unverified: [claim], late: [claim] });
});
