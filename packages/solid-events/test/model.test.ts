// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  entities,
  eventDocumentUrl,
  type RsvpData,
  validateEvent,
  validateInvitee,
  validateRsvp,
} from "../src/index.js";
import { event, rsvp } from "./fixtures.js";

describe("generated independent entities", () => {
  it("round-trips every invitation property and schema.org IRI enums", async () => {
    const data = {
      ...event,
      description: "Plain <b>text</b>",
      endDate: new Date("2027-02-01T21:00:00Z"),
      location: "Glasshouse",
      address: "12 Lantern Lane",
      onlineUrl: "https://meeting.example/room",
      image: "https://images.example/cover.jpg",
      capacity: 12,
      rsvpDeadline: new Date("2027-01-31T12:00:00Z"),
    };
    expect(
      await entities.Event.parseDocument(
        "https://host.example/event",
        await entities.Event.serialize("https://host.example/event", data),
      ),
    ).toEqual(data);
    expect(() => validateEvent(data)).not.toThrow();
  });
  it("round-trips RSVP alone and named guest records", async () => {
    const data = {
      ...rsvp,
      displayName: "Cleo Wren",
      guestKey: "a-random-guest",
      comment: "Pudding!",
    };
    expect(
      await entities.Rsvp.parseDocument(
        "https://host.example/reply",
        await entities.Rsvp.serialize("https://host.example/reply", data),
      ),
    ).toEqual(data);
    expect(() => validateRsvp(data)).not.toThrow();
    const invitee = {
      webId: rsvp.agent,
      displayName: "Cleo",
      event: rsvp.event,
      invitedAt: rsvp.repliedAt,
    };
    expect(
      await entities.Invitee.parseDocument(
        "https://host.example/invitee",
        await entities.Invitee.serialize("https://host.example/invitee", invitee),
      ),
    ).toEqual(invitee);
    expect(() => validateInvitee(invitee)).not.toThrow();
    expect(() =>
      validateInvitee({ event: rsvp.event, invitedAt: rsvp.repliedAt, displayName: "Cleo" }),
    ).not.toThrow();
  });
  it("does not accept a missing MUST or invalid IRI enum", () => {
    expect(
      entities.Event.parse(
        "https://host.example/e",
        entities.Event.build("https://host.example/e", { ...event, name: "" }),
      ),
    ).toBeUndefined();
    expect(
      entities.Rsvp.parse(
        "https://host.example/r",
        entities.Rsvp.build("https://host.example/r", {
          ...rsvp,
          response: "bad" as RsvpData["response"],
        }),
      ),
    ).toBeUndefined();
    expect(() => entities.Event.subject("relative")).toThrow();
  });
});
describe("domain validation", () => {
  it.each([
    "file:///etc/passwd",
    "https://user:secret@pod.example/e",
    "https://pod.example/e?q=1",
    "https://pod.example/evil>iri",
    "relative",
  ])("refuses unsafe event URL %s", (url) => expect(() => eventDocumentUrl(url)).toThrow());
  it("accepts http(s) and strips the entity fragment", () => {
    expect(eventDocumentUrl("https://pod.example/e#it")).toBe("https://pod.example/e");
    expect(eventDocumentUrl("http://pod.example/e")).toBe("http://pod.example/e");
  });
  it.each([
    { name: " " },
    { startDate: new Date("invalid") },
    { endDate: new Date("invalid") },
    { endDate: event.startDate },
    { rsvpDeadline: new Date("invalid") },
    { rsvpDeadline: new Date("2030-01-01T00:00:00Z") },
    { capacity: -1 },
    { capacity: 1.5 },
    { capacity: 1000001 },
    { onlineUrl: "javascript:alert(1)" },
    { image: "https://user:secret@images.example/a" },
    { organizer: "bad" },
  ])("rejects malformed event %j", (patch) =>
    expect(() => validateEvent({ ...event, ...patch })).toThrow());
  it("supports zero capacity, optional end and a deadline at the start", () =>
    expect(() =>
      validateEvent({ ...event, capacity: 0, rsvpDeadline: event.startDate }),
    ).not.toThrow());
  it("requires named guest identity without a WebID", () => {
    expect(() => validateRsvp({ ...rsvp, agent: undefined })).toThrow();
    expect(() =>
      validateRsvp({ ...rsvp, agent: undefined, displayName: "Cleo", guestKey: "receipt" }),
    ).not.toThrow();
    expect(() => validateRsvp({ ...rsvp, additionalGuests: -1 })).toThrow();
    expect(() => validateRsvp({ ...rsvp, agent: "javascript:evil" })).toThrow();
    expect(() => validateInvitee({ event: rsvp.event, invitedAt: rsvp.repliedAt })).toThrow();
    expect(() =>
      validateInvitee({ event: rsvp.event, invitedAt: rsvp.repliedAt, webId: "file:///tmp/me" }),
    ).toThrow();
  });
});

it("caps additional guests at twenty", () => {
  expect(() => validateRsvp({ ...rsvp, additionalGuests: 20 })).not.toThrow();
  expect(() => validateRsvp({ ...rsvp, additionalGuests: 21 })).toThrow();
});
it("marks the WAC-writing package security critical", async () => {
  const { readFile } = await import("node:fs/promises");
  expect(
    JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
      .securityCritical,
  ).toBe(true);
});

it("shares the same URL validator across document and image policy", async () => {
  const { validateHttpUrl } = await import("../src/index.js");
  expect(validateHttpUrl("https://images.example/a?q=1#cover").href).toBe(
    "https://images.example/a?q=1#cover",
  );
  for (const value of [
    "file:///tmp/a",
    "https://user:secret@host.example/a",
    "https://host.example/evil>iri",
    "https://host.example/a\n",
    "relative",
  ])
    expect(() => validateHttpUrl(value)).toThrow();
});

it("enforces the guest cap in the generated model too", () => {
  const url = "https://host.example/r";
  expect(
    entities.Rsvp.parse(url, entities.Rsvp.build(url, { ...rsvp, additionalGuests: 21 })),
  ).toBeUndefined();
});
