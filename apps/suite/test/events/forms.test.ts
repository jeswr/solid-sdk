// AUTHORED-BY Codex (GPT-6.1 Sol)

import { EVENT_STATUS, type Invitation } from "@jeswr/solid-events";
import { expect, it } from "vitest";
import {
  filterInvitations,
  invitationForm,
  inviteesFromText,
  localDateTime,
} from "../../src/apps/events/lib/forms";

function form() {
  const value = new FormData();
  value.set("name", "  Supper  ");
  value.set("startDate", "2027-02-01T18:00");
  return value;
}
const owner = "https://host.example/me";
it("parses form dates, trims text, supports optional fields and preserves creation/sharing on edit", () => {
  const value = form();
  const now = new Date("2026-11-11T12:00:00Z");
  const data = invitationForm(value, owner, undefined, now);
  expect(data).toMatchObject({
    name: "Supper",
    visibility: "invitees",
    guestListVisible: false,
    publication: "published",
    created: now,
    modified: now,
  });
  value.set("description", "A lovely time");
  value.set("capacity", "12");
  value.set("endDate", "2027-02-01T22:00");
  value.set("rsvpDeadline", "2027-01-31T12:00");
  value.set("location", "Kitchen");
  value.set("address", "12 Lantern Lane");
  value.set("onlineUrl", "https://meeting.example/room");
  value.set("image", "https://images.example/a.jpg");
  value.set("visibility", "link");
  value.set("guestListVisible", "on");
  value.set("publication", "draft");
  const detailed = invitationForm(value, owner, undefined, now);
  expect(detailed).toMatchObject({
    capacity: 12,
    description: "A lovely time",
    publication: "draft",
    guestListVisible: true,
  });
  const existing = { ...data, url: "https://host.example/event", etag: '"a"' };
  expect(invitationForm(value, owner, existing)).toMatchObject({
    created: now,
    visibility: "invitees",
    guestListVisible: false,
    publication: "published",
  });
  value.set("capacity", "1.2");
  expect(() => invitationForm(value, owner)).toThrow();
  expect(localDateTime()).toBe("");
  expect(localDateTime(now)).toMatch(/^2026-11-11T\d\d:00$/);
});
it("validates, deduplicates and caps invitee WebIDs", () => {
  expect(inviteesFromText(" \n")).toEqual([]);
  expect(inviteesFromText(`${owner}\n${owner}\r\nhttps://friend.example/me`)).toHaveLength(2);
  expect(() => inviteesFromText("javascript:evil")).toThrow();
  expect(() =>
    inviteesFromText(Array.from({ length: 51 }, (_, i) => `https://guest.example/${i}`).join("\n")),
  ).toThrow("50");
});
it("partitions upcoming, past, draft, cancelled and postponed invitations", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const base = invitationForm(form(), owner);
  const entries = [
    { ...base, url: "a", startDate: new Date(+now + 1000) },
    { ...base, url: "b", startDate: new Date(+now - 1000) },
    { ...base, url: "c", publication: "draft" as const },
    { ...base, url: "d", eventStatus: EVENT_STATUS.cancelled },
    { ...base, url: "e", eventStatus: EVENT_STATUS.postponed },
    { ...base, url: "f", startDate: new Date(+now - 1000), endDate: new Date(+now + 1000) },
  ].map((e) => ({ ...e, etag: null })) satisfies Invitation[];
  expect(filterInvitations(entries, "Upcoming", now).map((e) => e.url)).toEqual(["f", "a", "e"]);
  expect(filterInvitations(entries, "Past", now).map((e) => e.url)).toEqual(["b"]);
  expect(filterInvitations(entries, "Drafts", now).map((e) => e.url)).toEqual(["c"]);
  expect(filterInvitations(entries, "Cancelled", now).map((e) => e.url)).toEqual(["d"]);
});

it("orders past invitations newest first, using an explicit end where present", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const data = invitationForm(form(), owner);
  const rows: Invitation[] = [
    { ...data, url: "older", etag: null, startDate: new Date(+now - 20000) },
    {
      ...data,
      url: "newer",
      etag: null,
      startDate: new Date(+now - 10000),
      endDate: new Date(+now - 5000),
    },
  ];
  expect(filterInvitations(rows, "Past", now).map((row) => row.url)).toEqual(["newer", "older"]);
});
