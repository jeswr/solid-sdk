// AUTHORED-BY Claude Opus 5.5
import {
  RequestConflictError,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";

// The roles module brands its own errors; stand in for that brand here.
vi.mock("@jeswr/pod-access/roles", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isRoleError: (error: unknown) => error instanceof Error && error.name === "RoleError",
}));

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
  ADD_ONLY_TEXT,
  accessText,
  approvedMessage,
  cardLabels,
  classLocalName,
  decidedText,
  deniedMessage,
  EXPIRY_NOT_ENFORCED,
  finishedMessage,
  headline,
  initialSelection,
  initials,
  isReadable,
  isShareable,
  listText,
  NOT_SAVED,
  purposeLine,
  purposeText,
  type ReadableRequest,
  type RequestCard,
  recordedMessage,
  requestCards,
  requesterHost,
  requesterName,
  reviewError,
  selectedDataTypes,
  splitRequests,
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
    // Caps count code points: an emoji at the cut is kept whole, never split into a lone surrogate.
    const emoji = requesterName(request({ requesterName: "😀".repeat(100) }));
    expect(emoji).toBe(`${"😀".repeat(79)}…`);
    expect(requesterName(request({ requesterName: "😀".repeat(80) }))).toBe("😀".repeat(80));
    expect(requesterName(request({ requesterName: " " }))).toBe("coach.example");
    expect(requesterName(request({ requester: "urn:uuid:1" }))).toBe("Someone");
    expect(requesterHost(request())).toBe("coach.example");
    expect(requesterHost(request({ requester: "mailto:a@b" }))).toBeUndefined();
    expect(initials("Mara Coach")).toBe("MC");
    expect(initials("coach.example")).toBe("CE");
    expect(initials("élan vital training")).toBe("ÉV");
    expect(initials("  ")).toBe("?");
  });

  it("strips bidi and zero-width characters from requester names", () => {
    expect(requesterName(request({ requesterName: "Mara\u202EhcaoC\u202C" }))).toBe("MarahcaoC");
    expect(requesterName(request({ requesterName: "Ma\u200Bra\u200DCoach\uFEFF" }))).toBe(
      "MaraCoach",
    );
    expect(requesterName(request({ requesterName: "\u2066\u200F\u2069" }))).toBe("coach.example");
    expect(requesterName(request({ requesterName: "Bob\u0007 Smith" }))).toBe("Bob Smith");
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

  it("cleans purpose text like requester names and caps its length", () => {
    expect(purposeText("build\u202E nalp ruoy\u202C")).toBe("build nalp ruoy");
    expect(purposeText("plan\u200B your\u200D \u0007 runs\uFEFF")).toBe("plan your runs");
    expect(purposeText("\u2066\u200F\u2069")).toBeUndefined();
    const long = purposeText("a".repeat(500)) as string;
    expect(Array.from(long)).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
    // Cleaning runs before the IRI check, so a disguised IRI is still never shown.
    expect(purposeText("urn:\u200Bpurpose:1")).toBeUndefined();
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
  it("groups requested classes by Home data type and names each unsorted class", () => {
    const unknown = "https://vocab.example/Thing";
    const cards = requestCards({
      dataTypes: [STEPS, EXERCISE, unknown],
      modesByType: { [STEPS]: ["read"], [EXERCISE]: ["write", "read"], [unknown]: ["read"] },
    });
    expect(cards).toEqual([
      {
        id: "activity",
        label: "Activity",
        description: "Exercise and step counts.",
        domainId: "body-health",
        dataTypes: [STEPS, EXERCISE],
        shareableTypes: [STEPS, EXERCISE],
        modes: ["read", "write"],
      },
      {
        id: unknown,
        label: "Thing",
        description: expect.stringContaining("isn't sorted"),
        classIri: unknown,
        dataTypes: [unknown],
        shareableTypes: [unknown],
        modes: ["read"],
      },
    ]);
    expect(selectedDataTypes(cards, ["activity"])).toEqual([STEPS, EXERCISE]);
    expect(selectedDataTypes(cards, [])).toEqual([]);
    expect(cardLabels(cards)).toEqual(["Activity", "Thing"]);
    expect(cardLabels(cards, [unknown])).toEqual(["Thing"]);
    // Only sorted data starts checked: the owner opts in to anything else.
    expect(initialSelection(cards)).toEqual(["activity"]);
    expect(accessText(["read"])).toBe("Can see");
    expect(accessText(["read", "write"])).toBe("Can change");
    expect(accessText(["append"])).toBe("Can add");
    expect(listText(["Activity", "Sleep", "Steps"])).toBe("Activity, Sleep, and Steps");
  });

  it("keeps distinct unsorted classes apart, even when their names match", () => {
    const a = "https://a.example/ns#Thing";
    const b = "https://b.example/vocab/Thing";
    const cards = requestCards({
      dataTypes: [a, b],
      modesByType: { [a]: ["read"], [b]: ["read"] },
    });
    expect(cards.map((card) => [card.id, card.label, card.classIri])).toEqual([
      [a, "Thing", a],
      [b, "Thing", b],
    ]);
    expect(cardLabels(cards)).toEqual(["Thing", "Thing"]);
    expect(initialSelection(cards)).toEqual([]);
  });

  it("names a class from its fragment or last path segment, cleaned for display", () => {
    expect(classLocalName("https://vocab.example/ns#RunSession")).toBe("RunSession");
    expect(classLocalName("https://vocab.example/types/RunSession/")).toBe("RunSession");
    expect(classLocalName("https://vocab.example/types/Run%20Session")).toBe("Run Session");
    expect(classLocalName("https://vocab.example/a#Ev\u202Eil")).toBe("Evil");
    expect(classLocalName("https://vocab.example/a#%E2%80%AEEvil")).toBe("Evil");
    expect(classLocalName("https://vocab.example/a#%E0%A4%A")).toBe("%E0%A4%A");
    expect(classLocalName(`https://vocab.example/${"x".repeat(100)}`)).toBe(`${"x".repeat(59)}…`);
    expect(classLocalName("https://vocab.example/")).toBe("Other data");
    expect(classLocalName("not a url/Thing")).toBe("Thing");
    expect(classLocalName("#/")).toBe("Other data");
  });

  it("marks append-only and mode-less classes as not shareable", () => {
    const inbox = "https://vocab.example/Note";
    const empty = "https://vocab.example/Blank";
    const cards = requestCards({
      dataTypes: [STEPS, EXERCISE, inbox, empty],
      modesByType: { [STEPS]: ["read"], [EXERCISE]: ["append"], [inbox]: ["append"] },
    });
    const [activity, note, blank] = cards as [RequestCard, RequestCard, RequestCard];
    expect(activity.shareableTypes).toEqual([STEPS]);
    expect(isShareable(activity)).toBe(true);
    expect(isShareable(note)).toBe(false);
    expect(isShareable(blank)).toBe(false);
    expect(initialSelection(cards)).toEqual(["activity"]);
    // An add-only class is never sent, even when its card is somehow selected.
    expect(
      selectedDataTypes(
        cards,
        cards.map((card) => card.id),
      ),
    ).toEqual([STEPS]);
    expect(ADD_ONLY_TEXT).toBe("Can only add — can't be shared yet");
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
      "MaraCoach can now see and change your Activity and Doc. We couldn't tell MaraCoach; they'll see it next time they check.",
    );
    expect(deniedMessage("Bob", true)).toBe("You denied Bob's request.");
    expect(deniedMessage("Bob", false)).toContain("We couldn't tell Bob;");
    expect(finishedMessage("Bob", true)).toBe("You finished approving Bob's request.");
    expect(finishedMessage("Bob", false)).toContain("We couldn't tell Bob;");
    expect(EXPIRY_NOT_ENFORCED).toBe(
      "Access won't end automatically on this storage; remove it from Permissions when you're done.",
    );
  });

  it("words an approval from the choices the SDK recorded, not the ones sent", () => {
    const Doc = "https://vocab.example/Doc";
    const Other = "https://vocab.example/Other";
    const cards = requestCards({
      dataTypes: [STEPS, Doc],
      modesByType: { [STEPS]: ["read"], [Doc]: ["read", "write"] },
    });
    const both = { dataTypes: [STEPS, Doc], grantedTypes: [STEPS, Doc] };
    expect(
      recordedMessage("MaraCoach", cards, { ...both, grantedTypes: [STEPS], role: "editor" }, true),
    ).toBe("MaraCoach can now see your Activity.");
    expect(recordedMessage("MaraCoach", cards, { ...both, role: "editor" }, false)).toBe(
      "MaraCoach can now see and change your Activity and Doc. We couldn't tell MaraCoach; they'll see it next time they check.",
    );
    // A Viewer approval can only see, whatever was asked for.
    expect(
      recordedMessage("MaraCoach", cards, { ...both, grantedTypes: [Doc], role: "viewer" }, true),
    ).toBe("MaraCoach can now see your Doc.");
    // Chosen but not granted (it asked only to change, under a Viewer approval): not named.
    const changeOnly = requestCards({
      dataTypes: [STEPS, Doc],
      modesByType: { [STEPS]: ["read"], [Doc]: ["write"] },
    });
    expect(
      recordedMessage(
        "MaraCoach",
        changeOnly,
        { ...both, grantedTypes: [STEPS], role: "viewer" },
        true,
      ),
    ).toBe("MaraCoach can now see your Activity.");
    // Recorded types this sheet has no card for: name none.
    expect(
      recordedMessage(
        "Bob",
        cards,
        { dataTypes: [Other], grantedTypes: [Other], role: "editor" },
        true,
      ),
    ).toBe("You finished approving Bob's request.");
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
    expect(lists.unreadable).toEqual([{ id: "f", status: "unreadable" }]);
    expect(isReadable({ id: "x", status: "unreadable" })).toBe(false);
  });

  it("drops requests answered in this session from the waiting lists", () => {
    const lists = splitRequests(
      [request({ id: "a" }), request({ id: "b" }), { id: "f", status: "unreadable" }],
      new Date(),
      new Set(["a", "f"]),
    );
    expect(lists.pending.map((entry) => entry.id)).toEqual(["b"]);
    expect(lists.unreadable).toEqual([]);
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
      retry: false,
    });
    expect(reviewError(new UnsupportedAccessModelError("unknown"), false)).toMatchObject({
      message: "Answering requests isn't available on this storage yet",
    });
    expect(reviewError(new Error("The access records folder is shared"), true, false)).toEqual({
      kind: "error",
      category: "unreachable",
      message: "You're offline. Reconnect and try again.",
      retry: true,
    });
    expect(reviewError(new Error(""), true)).toMatchObject({
      message: "Your answer wasn't saved. Try again.",
    });
    expect(reviewError("boom", false)).toMatchObject({ category: "unknown" });
  });

  it("never shows an unmapped SDK message: fixed copy, the raw error only on the console", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new Error(" The access records folder https://pod.test/.access/ is shared ");
    expect(reviewError(raw, true)).toEqual({
      kind: "error",
      category: "unknown",
      message: NOT_SAVED,
      retry: true,
    });
    expect(NOT_SAVED).toBe("Your answer wasn't saved. Try again.");
    expect(logged).toHaveBeenCalledWith(expect.any(String), raw);
    logged.mockRestore();
  });

  it.each([
    ["Conditional write failed (412)", "Something else changed this request", true],
    ["The access records folder ACL kept changing", "Something else changed this request", true],
    ["Every approved data type needs an owner registration", "isn't registered in your pod", false],
    ["Registered container is missing", "isn't registered in your pod", false],
    ["This request claims an approval that was never recorded", "You can still deny it", false],
    [
      "This request only asks to add data, which no sharing role allows on its own, so it can't be approved",
      "only asks to add data, which can't be shared yet",
      false,
    ],
    ["Decision grants no requested modes", "only asks to add data", false],
    ["Cannot deny an approval", "can't be denied now. Finish approving it", false],
    ["Cannot approve a denial", "You already denied this request", false],
    [
      "An earlier approval of this request is still finishing with different choices; finish it first",
      "Choose Finish approving to complete it as it was first chosen",
      false,
    ],
    ["Request no longer exists", "isn't in your inbox any more", false],
  ])("maps the SDK's %j to plain copy", (raw, copy, retry) => {
    const failure = reviewError(new Error(raw), true);
    expect(failure).toMatchObject({ kind: "error", category: "unknown", retry });
    expect(failure.kind === "error" && failure.message).toContain(copy);
    expect(failure.kind === "error" && failure.message).not.toContain(raw);
  });

  it("says which refusals mean finish the pinned approval, and which leave only Deny", () => {
    const flags = (raw: string) => {
      const failure = reviewError(new Error(raw), true);
      return failure.kind === "error" ? [failure.finish, failure.deny] : [];
    };
    expect(
      flags(
        "An earlier approval of this request is still finishing with different choices; finish it first",
      ),
    ).toEqual([true, undefined]);
    expect(flags("Cannot deny an approval")).toEqual([true, undefined]);
    expect(flags("This request claims an approval that was never recorded")).toEqual([
      undefined,
      true,
    ]);
    expect(flags("Conditional write failed (412)")).toEqual([undefined, undefined]);
    // The SDK no longer explains unreadable entries here: they get the fixed copy.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(reviewError(new Error("Unreadable access request"), false)).toMatchObject({
      message: NOT_SAVED,
    });
    logged.mockRestore();
  });

  it("never shows a sharing-layer error's own message, which names a document", () => {
    const roleError = (code: string) =>
      Object.assign(new Error(`Refused: https://pod.test/health/activity.ttl`), {
        name: "RoleError",
        code,
      });
    const cases: [string, string, string, boolean][] = [
      ["conflict", "unknown", "Something else changed this request at the same time.", true],
      [
        "unsupported",
        "unsupported",
        "Sharing this data isn't available on this storage yet",
        false,
      ],
      ["owner-lockout", "unknown", "would lock you out of your own data", false],
      ["scope", "unknown", "Your answer wasn't saved. Try again.", true],
    ];
    for (const [code, category, copy, retry] of cases) {
      const failure = reviewError(roleError(code), true);
      expect(failure).toMatchObject({ kind: "error", category, retry });
      expect(failure.kind === "error" && failure.message).toContain(copy);
      expect(failure.kind === "error" && failure.message).not.toContain("https://");
    }
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
