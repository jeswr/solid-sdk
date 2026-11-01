// AUTHORED-BY Claude Opus 5.5
import {
  RequestConflictError,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it } from "vitest";
import { requestCaps } from "../src/apps/home/lib/requests/caps";
import {
  addDuration,
  chipFor,
  dateInputValue,
  durationText,
  endOfDateInput,
  expiresAtFor,
  initialDuration,
  parseDuration,
  requestedDurationText,
} from "../src/apps/home/lib/requests/duration";
import {
  accessText,
  approvedMessage,
  cardLabels,
  decidedText,
  deniedMessage,
  headline,
  initials,
  isReadable,
  listText,
  purposeLine,
  purposeText,
  type ReadableRequest,
  requestCards,
  requesterHost,
  requesterName,
  reviewError,
  selectedDataTypes,
  splitRequests,
  unreadableNotice,
} from "../src/apps/home/lib/requests/model";

const STEPS = `${NS.HEALTH}StepCountObservation`;
const EXERCISE = `${NS.HEALTH}ObservationActivity`;
const NOW = new Date(2026, 10, 1, 9, 30);
const ZERO = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

function request(overrides: Partial<ReadableRequest> = {}): ReadableRequest {
  return {
    id: "https://pod.test/inbox/1.ttl",
    status: "pending",
    requester: "https://coach.example/card#me",
    dataTypes: [STEPS],
    modes: ["read"],
    modesByType: { [STEPS]: ["read"] },
    ...overrides,
  };
}

describe("durations", () => {
  it("parses whole-unit ISO 8601 durations and rejects everything else", () => {
    expect(parseDuration("P1Y2M3W4DT5H6M7S")).toEqual({
      years: 1,
      months: 2,
      weeks: 3,
      days: 4,
      hours: 5,
      minutes: 6,
      seconds: 7,
    });
    expect(parseDuration(" P1M ")).toEqual({ ...ZERO, months: 1 });
    for (const value of [undefined, "", "P", "PT", "P1MT", "P1.5D", "-P1D", "1 month", "P0D"])
      expect(parseDuration(value)).toBeUndefined();
    expect(parseDuration("P100001D")).toBeUndefined();
  });

  it("adds durations in local calendar time", () => {
    const end = addDuration(new Date(2026, 0, 31, 12), { ...ZERO, months: 1, hours: 1 });
    expect(end).toEqual(new Date(2026, 1, 28 + 3, 13));
    expect(addDuration(NOW, { ...ZERO, weeks: 1, days: 1, minutes: 30, seconds: 5 })).toEqual(
      new Date(2026, 10, 9, 10, 0, 5),
    );
  });

  it("maps exact durations to chips", () => {
    expect(chipFor({ ...ZERO, days: 1 })).toBe("day");
    expect(chipFor({ ...ZERO, hours: 24 })).toBe("day");
    expect(chipFor({ ...ZERO, months: 1 })).toBe("month");
    expect(chipFor({ ...ZERO, years: 1 })).toBe("year");
    expect(chipFor({ ...ZERO, months: 12 })).toBe("year");
    expect(chipFor({ ...ZERO, weeks: 2 })).toBeUndefined();
    expect(chipFor({ ...ZERO, months: 1, days: 1 })).toBeUndefined();
  });

  it("describes durations in words", () => {
    expect(durationText({ ...ZERO, months: 1 })).toBe("1 month");
    expect(durationText({ ...ZERO, weeks: 2, days: 3 })).toBe("2 weeks and 3 days");
    expect(durationText({ ...ZERO, years: 1, hours: 2, seconds: 1 })).toBe(
      "1 year, 2 hours and 1 second",
    );
  });

  it("reads and writes date inputs as local days", () => {
    expect(dateInputValue(new Date(2027, 0, 5))).toBe("2027-01-05");
    expect(endOfDateInput("2027-01-05")).toEqual(new Date(2027, 0, 5, 23, 59, 59, 999));
    expect(endOfDateInput("2027-02-30")).toBeUndefined();
    expect(endOfDateInput("5 Jan 2027")).toBeUndefined();
  });

  it("preselects the requested duration, a requested expiry date, or Until revoked", () => {
    expect(initialDuration({ requestedDuration: "P1M" }, NOW)).toEqual({
      value: "month",
      customDate: "2026-12-01",
    });
    expect(initialDuration({ requestedDuration: "P2W" }, NOW)).toEqual({
      value: "custom",
      customDate: "2026-11-15",
    });
    expect(initialDuration({ expiresAt: "2027-03-04T10:00:00" }, NOW)).toEqual({
      value: "custom",
      customDate: "2027-03-04",
    });
    expect(initialDuration({ expiresAt: "2020-01-01T00:00:00Z" }, NOW).value).toBe("until-revoked");
    expect(initialDuration({ expiresAt: "soon" }, NOW).value).toBe("until-revoked");
    expect(initialDuration({}, NOW)).toEqual({ value: "until-revoked", customDate: "" });
  });

  it("turns a chip choice into expiresAt, refusing past or invalid custom dates", () => {
    expect(expiresAtFor({ value: "until-revoked", customDate: "" }, NOW)).toBeUndefined();
    expect(expiresAtFor({ value: "day", customDate: "" }, NOW)).toEqual(
      new Date(2026, 10, 2, 9, 30),
    );
    expect(expiresAtFor({ value: "month", customDate: "" }, NOW)).toEqual(
      new Date(2026, 11, 1, 9, 30),
    );
    expect(expiresAtFor({ value: "year", customDate: "" }, NOW)).toEqual(
      new Date(2027, 10, 1, 9, 30),
    );
    expect(expiresAtFor({ value: "custom", customDate: "2026-11-01" }, NOW)).toEqual(
      new Date(2026, 10, 1, 23, 59, 59, 999),
    );
    expect(expiresAtFor({ value: "custom", customDate: "2026-10-31" }, NOW)).toBeNull();
    expect(expiresAtFor({ value: "custom", customDate: "" }, NOW)).toBeNull();
  });

  it("describes what a row asked for", () => {
    const format = (value: string) => `<${value}>`;
    expect(requestedDurationText({ requestedDuration: "P1M" }, format)).toBe("For 1 month");
    expect(requestedDurationText({ expiresAt: "2027-01-01T00:00:00Z" }, format)).toBe(
      "Until <2027-01-01T00:00:00Z>",
    );
    expect(requestedDurationText({ expiresAt: "whenever" }, format)).toBe("Until revoked");
    expect(requestedDurationText({}, format)).toBe("Until revoked");
  });
});

describe("requesters and purposes", () => {
  it("names the requester from the notification, else its host, never a raw IRI", () => {
    expect(requesterName(request({ requesterName: "  Mara \n Coach " }))).toBe("Mara Coach");
    expect(requesterName(request({ requesterName: "x".repeat(100) }))).toBe(`${"x".repeat(79)}…`);
    expect(requesterName(request({ requesterName: " " }))).toBe("coach.example");
    expect(requesterName(request({ requester: "urn:uuid:1" }))).toBe("Someone");
    expect(requesterHost(request())).toBe("coach.example");
    expect(requesterHost(request({ requester: "mailto:a@b" }))).toBeUndefined();
    expect(initials("Mara Coach")).toBe("MC");
    expect(initials("coach.example")).toBe("CE");
    expect(initials("élan vital training")).toBe("ÉV");
    expect(initials("  ")).toBe("?");
  });

  it("shows a purpose's words: requester text or a known DPV label, never an IRI", () => {
    expect(purposeText(undefined)).toBeUndefined();
    expect(purposeText("   ")).toBeUndefined();
    expect(purposeText(" build  your plan ")).toBe("build your plan");
    expect(purposeText("https://w3id.org/dpv#ServicePersonalisation")).toBe(
      "Personalise the service",
    );
    expect(purposeText("https://w3id.org/dpv#Unheard")).toBeUndefined();
    expect(purposeText("urn:purpose:1")).toBeUndefined();
    expect(purposeLine("build your training plan")).toBe("Build your training plan");
    expect(purposeLine(undefined)).toBeUndefined();
  });

  it("applies the headline rule", () => {
    expect(headline("MaraCoach", "build your training plan")).toBe(
      "To build your training plan, MaraCoach requests access to:",
    );
    expect(headline("MaraCoach", "https://w3id.org/dpv#ServicePersonalisation")).toBe(
      "To personalise the service, MaraCoach requests access to:",
    );
    expect(headline("Bob", "GPS mapping")).toBe("To GPS mapping, Bob requests access to:");
    expect(headline("Bob", "X")).toBe("To x, Bob requests access to:");
    expect(headline("Bob", "urn:x")).toBe("Bob requests access to:");
    expect(headline("Bob", undefined)).toBe("Bob requests access to:");
  });
});

describe("data type cards", () => {
  it("groups requested classes by Home data type and keeps unknown ones as Other data", () => {
    const unknown = "https://vocab.example/Thing";
    const cards = requestCards({
      dataTypes: [STEPS, EXERCISE, unknown],
      modesByType: { [STEPS]: ["read"], [EXERCISE]: ["write", "read"] },
    });
    expect(cards).toEqual([
      {
        id: "activity",
        label: "Activity",
        description: "Exercise and step counts.",
        domainId: "body-health",
        dataTypes: [STEPS, EXERCISE],
        modes: ["read", "write"],
      },
      {
        id: unknown,
        label: "Other data",
        description: expect.stringContaining("isn't sorted"),
        dataTypes: [unknown],
        modes: [],
      },
    ]);
    expect(selectedDataTypes(cards, ["activity"])).toEqual([STEPS, EXERCISE]);
    expect(selectedDataTypes(cards, [])).toEqual([]);
    expect(cardLabels(cards)).toEqual(["Activity", "Other data"]);
    expect(cardLabels(cards, [unknown])).toEqual(["Other data"]);
    expect(accessText(["read"])).toBe("Can see");
    expect(accessText(["read", "write"])).toBe("Can change");
    expect(accessText(["append"])).toBe("Can add");
    expect(listText(["Activity", "Sleep", "Steps"])).toBe("Activity, Sleep, and Steps");
  });

  it("confirms decisions in plain words, saying when the requester wasn't told", () => {
    const cards = requestCards({
      dataTypes: [STEPS, "https://vocab.example/Doc"],
      modesByType: { [STEPS]: ["read"], "https://vocab.example/Doc": ["write"] },
    });
    expect(approvedMessage("MaraCoach", cards, ["activity"], true)).toBe(
      "MaraCoach can now see your Activity.",
    );
    expect(
      approvedMessage(
        "MaraCoach",
        cards,
        cards.map((card) => card.id),
        false,
      ),
    ).toBe(
      "MaraCoach can now see and change your Activity and Other data. We couldn't tell MaraCoach; they'll see it next time they check.",
    );
    expect(deniedMessage("Bob", true)).toBe("You denied Bob's request.");
    expect(deniedMessage("Bob", false)).toContain("We couldn't tell Bob;");
  });
});

describe("pending and decided lists", () => {
  it("orders pending newest first, keeps 30 days of decisions and counts unreadable", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const lists = splitRequests(
      [
        request({ id: "a", created: "2026-10-30T00:00:00Z" }),
        request({ id: "b", created: "2026-10-31T00:00:00Z" }),
        request({ id: "c", status: "approving" }),
        request({ id: "d" }),
        request({ id: "e", created: "not a date" }),
        { id: "f", status: "unreadable" },
        request({ id: "g", status: "approved", decidedAt: "2026-10-20T00:00:00Z" }),
        request({ id: "h", status: "denied", decidedAt: "2026-10-25T00:00:00Z" }),
        request({ id: "i", status: "denied", decidedAt: "2026-09-01T00:00:00Z" }),
        request({ id: "j", status: "approved" }),
        request({ id: "k", status: "denied", decidedAt: "2026-10-25T00:00:00Z" }),
      ],
      now,
    );
    expect(lists.pending.map((entry) => entry.id)).toEqual(["b", "a", "c", "d", "e"]);
    expect(lists.decided.map((entry) => entry.id)).toEqual(["h", "k", "g"]);
    expect(lists.unreadable).toBe(1);
    expect(isReadable({ id: "x", status: "unreadable" })).toBe(false);
    expect(unreadableNotice(1)).toBe("1 request couldn't be read");
    expect(unreadableNotice(3)).toBe("3 requests couldn't be read");
  });

  it("labels decisions", () => {
    const format = (value: string) => value.slice(0, 10);
    expect(
      decidedText(request({ status: "approved", decidedAt: "2026-10-20T00:00:00Z" }), format),
    ).toBe("Approved 2026-10-20");
    expect(decidedText(request({ status: "denied" }), format)).toBe("Denied");
  });
});

describe("errors and capabilities", () => {
  it("classifies decision failures for the sheet", () => {
    expect(reviewError(new RequestConflictError("x", "approved"), true)).toEqual({
      kind: "conflict",
    });
    expect(reviewError(new UnsupportedAccessModelError("acp"), true)).toEqual({
      kind: "error",
      category: "unsupported",
      message: "Approving requests isn't available on this storage yet",
    });
    expect(reviewError(new UnsupportedAccessModelError("unknown"), false)).toMatchObject({
      message: "Answering requests isn't available on this storage yet",
    });
    expect(reviewError(new Error("The access records folder is shared"), true, false)).toEqual({
      kind: "error",
      category: "unreachable",
      message: "You're offline. Reconnect and try again.",
    });
    expect(reviewError(new Error(" The access records folder is shared "), true)).toEqual({
      kind: "error",
      category: "unknown",
      message: "The access records folder is shared",
    });
    expect(reviewError(new Error(""), true)).toMatchObject({
      message: "Your answer wasn't saved. Try again.",
    });
    expect(reviewError("boom", false)).toMatchObject({ category: "unknown" });
  });

  it("reads request capabilities from overrides, falling back to the public caps", () => {
    expect(requestCaps({})).toEqual({ accessRequests: false, grantExpiry: false });
    expect(requestCaps({}, '{"accessRequests":true}')).toEqual({
      accessRequests: true,
      grantExpiry: false,
    });
    expect(
      requestCaps({ accessRequests: false, grantExpiry: true }, '{"accessRequests":true}'),
    ).toEqual({ accessRequests: false, grantExpiry: true });
  });
});
