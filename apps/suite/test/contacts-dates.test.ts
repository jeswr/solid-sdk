// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  ContactDatesError,
  type ContactDatesErrorCode,
  type DatesContact,
  extractContactDates,
  parseContactDate,
  planContactEvents,
  upcomingContactDates,
} from "../src/apps/contacts/lib/dates";

const mira = {
  id: "https://example.org/contacts/mira#this",
  name: "Mira Quill",
  birthday: "2000-02-29",
  anniversary: "--12-31",
} as const;
const feb28 = { leapDay: "feb28" } as const;
const mar1 = { leapDay: "mar1" } as const;
const window2025 = { start: "2025-01-01", end: "2025-12-31" };

function fails(action: () => unknown, code: ContactDatesErrorCode): void {
  expect(action).toThrow(ContactDatesError);
  expect(action).toThrow(expect.objectContaining({ code, message: `Contact dates: ${code}` }));
}

describe("contact date parsing", () => {
  it.each([
    ["2000-02-29", { year: 2000, month: 2, day: 29 }],
    ["--02-29", { month: 2, day: 29 }],
    ["0001-01-01", { year: 1, month: 1, day: 1 }],
    ["9999-12-31", { year: 9999, month: 12, day: 31 }],
    ["2024-04-30", { year: 2024, month: 4, day: 30 }],
    ["1900-02-28", { year: 1900, month: 2, day: 28 }],
    ["2400-02-29", { year: 2400, month: 2, day: 29 }],
  ])("parses %s without inferring a year", (input, output) => {
    expect(parseContactDate(input)).toEqual(output);
  });

  it.each([
    null,
    undefined,
    20250101,
    {},
    new Date("2025-01-01"),
    "",
    "2025",
    "02-29",
    "20250101",
    "--0229",
    "2025-1-01",
    "2025-01-1",
    "2025-01-01\n",
    "--01-01\n",
    " 2025-01-01",
    "2025-01-01 ",
    "2025-01-01Z",
    "2025-01-01T00:00:00Z",
    "0000-01-01",
    "10000-01-01",
    "-001-01-01",
    "２０２５-01-01",
    "1900-02-29",
    "2100-02-29",
    "2023-02-29",
    "2024-02-30",
    "2024-04-31",
    "--04-31",
    "--02-30",
    "--00-01",
    "--13-01",
    "--01-00",
    "--01-32",
    "2025-00-01",
    "2025-13-01",
  ])("rejects invalid or unsupported dates (%j)", (input) => {
    fails(() => parseContactDate(input), "invalid-date");
  });
});

describe("contact occasion extraction", () => {
  it("extracts both kinds, preserves order and omits absent fields", () => {
    expect(
      extractContactDates([mira, { id: "https://example.org/empty", name: "Orin Vale" }]),
    ).toEqual([
      {
        contactId: mira.id,
        contactName: mira.name,
        kind: "birthday",
        sourceDate: { year: 2000, month: 2, day: 29 },
      },
      {
        contactId: mira.id,
        contactName: mira.name,
        kind: "anniversary",
        sourceDate: { month: 12, day: 31 },
      },
    ]);
    expect(extractContactDates([])).toEqual([]);
    const contact = Object.assign(Object.create(null), mira);
    expect(extractContactDates([contact])).toEqual(extractContactDates([mira]));
  });

  it.each([
    null,
    {},
    "contacts",
    [null],
    [undefined],
    [new Date()],
    [[]],
    [{}],
    [{ ...mira, id: "" }],
    [{ ...mira, id: 1 }],
    [{ ...mira, name: "  " }],
    [{ ...mira, name: "Mira\nQuill" }],
    [{ ...mira, other: "unsupported" }],
    [{ ...mira, [Symbol("extra")]: true }],
    [Object.create(mira)],
    [new Array(1)],
  ])("rejects unsupported contact shapes (%j)", (input) => {
    fails(() => extractContactDates(input as readonly DatesContact[]), "invalid-contact");
  });

  it("rejects accessors without executing them and non-enumerable fields", () => {
    let accessed = false;
    const contact = { ...mira };
    Object.defineProperty(contact, "birthday", {
      get: () => {
        accessed = true;
        return "2000-01-01";
      },
    });
    fails(() => extractContactDates([contact]), "invalid-contact");
    expect(accessed).toBe(false);
    const disappearing = new Proxy(
      { ...mira },
      {
        getOwnPropertyDescriptor: () => undefined,
      },
    );
    fails(() => extractContactDates([disappearing]), "invalid-contact");
    fails(
      () =>
        extractContactDates([Object.defineProperty({ ...mira }, "name", { enumerable: false })]),
      "invalid-contact",
    );
  });

  it("rejects duplicates and invalid date fields even after valid records", () => {
    fails(() => extractContactDates([mira, mira]), "duplicate-contact");
    for (const value of [null, undefined, "", "2025-02-30", ["2000-01-01"]]) {
      for (const kind of ["birthday", "anniversary"]) {
        fails(
          () => extractContactDates([{ ...mira, [kind]: value } as DatesContact]),
          "invalid-date",
        );
      }
    }
  });
});

describe("yearly all-day calendar plans", () => {
  it("retains source dates and recurrence policy instead of substituting the recurrence anchor", () => {
    const plans = planContactEvents([mira], { startYear: 2025, ...feb28 });
    expect(plans[0]).toEqual({
      contactId: mira.id,
      contactName: mira.name,
      kind: "birthday",
      sourceDate: { year: 2000, month: 2, day: 29 },
      title: "Mira Quill — birthday",
      allDay: true,
      startDate: "2025-02-28",
      durationDays: 1,
      recurrence: { frequency: "YEARLY", interval: 1, month: 2, day: 29, leapDay: "feb28" },
    });
    expect(plans[1]).toMatchObject({ startDate: "2025-12-31", title: "Mira Quill — anniversary" });
    expect(planContactEvents([mira], { startYear: 2025, ...mar1 })[0]?.startDate).toBe(
      "2025-03-01",
    );
    expect(planContactEvents([mira], { startYear: 2024, ...mar1 })[0]?.startDate).toBe(
      "2024-02-29",
    );
    expect(planContactEvents([mira], { startYear: 1900, ...feb28 })[0]?.startDate).toBe(
      "2000-02-29",
    );
    expect(planContactEvents([mira], { startYear: 9999, ...feb28 })[1]?.startDate).toBe(
      "9999-12-31",
    );
    expect(
      planContactEvents([{ ...mira, birthday: "--01-01" }], { startYear: 1, ...feb28 })[0]
        ?.startDate,
    ).toBe("0001-01-01");
    expect(planContactEvents([], { startYear: 2025, ...feb28 })).toEqual([]);
  });

  it.each([
    undefined,
    null,
    {},
    { startYear: 2025 },
    { startYear: 2025, leapDay: "skip" },
    { startYear: 2025, leapDay: "feb28", extra: true },
    ...[undefined, null, "2025", 0, 10000, 1.5, NaN, Infinity].map((startYear) => ({
      startYear,
      ...feb28,
    })),
  ])("rejects missing or unsupported planning options (%j)", (options) => {
    fails(() => planContactEvents([], options as never), "invalid-options");
  });
});

describe("upcoming dates", () => {
  it("includes endpoints, omits unknown ages, and computes known anniversary years", () => {
    expect(upcomingContactDates([mira], { start: "2025-02-28", end: "2025-12-31" }, feb28)).toEqual(
      [
        {
          contactId: mira.id,
          contactName: mira.name,
          kind: "birthday",
          sourceDate: { year: 2000, month: 2, day: 29 },
          date: "2025-02-28",
          age: 25,
        },
        {
          contactId: mira.id,
          contactName: mira.name,
          kind: "anniversary",
          sourceDate: { month: 12, day: 31 },
          date: "2025-12-31",
        },
      ],
    );
    expect(
      upcomingContactDates(
        [{ ...mira, anniversary: "2020-12-31" }],
        { start: "2025-12-31", end: "2025-12-31" },
        mar1,
      )[0]?.age,
    ).toBe(5);
    expect(
      upcomingContactDates([mira], { start: "2025-03-01", end: "2025-03-01" }, mar1)[0]?.age,
    ).toBe(25);
    expect(upcomingContactDates([mira], { start: "2025-03-01", end: "2025-12-30" }, feb28)).toEqual(
      [],
    );
    expect(upcomingContactDates([mira], { start: "2025-01-01", end: "2025-02-27" }, feb28)).toEqual(
      [],
    );
    expect(upcomingContactDates([], window2025, feb28)).toEqual([]);
  });

  it("expands every year across December/January, leap years and century rules", () => {
    const contact = { id: mira.id, name: mira.name, birthday: "--02-29" };
    const list = (start: string, end: string) =>
      upcomingContactDates([contact], { start, end }, mar1).map((item) => item.date);
    expect(list("2023-12-31", "2026-01-01")).toEqual(["2024-02-29", "2025-03-01"]);
    expect(list("1899-01-01", "1901-12-31")).toEqual(["1899-03-01", "1900-03-01", "1901-03-01"]);
    expect(list("1999-01-01", "2001-12-31")).toEqual(["1999-03-01", "2000-02-29", "2001-03-01"]);
  });

  it("applies leap policies to anniversaries and orders dates across the new year", () => {
    const contact = { id: mira.id, name: mira.name, anniversary: "2024-02-29" };
    expect(upcomingContactDates([contact], window2025, feb28)[0]).toMatchObject({
      kind: "anniversary",
      date: "2025-02-28",
      age: 1,
    });
    expect(upcomingContactDates([contact], window2025, mar1)[0]?.date).toBe("2025-03-01");
    expect(
      planContactEvents([contact], { startYear: 2025, ...feb28 })[0]?.recurrence,
    ).toMatchObject({ month: 2, day: 29, leapDay: "feb28" });
    const boundary = { ...contact, birthday: "--01-01", anniversary: "--12-31" };
    expect(
      upcomingContactDates([boundary], { start: "2025-12-31", end: "2026-01-01" }, feb28).map(
        (item) => item.date,
      ),
    ).toEqual(["2025-12-31", "2026-01-01"]);
  });

  it("suppresses pre-origin events, includes age zero, and handles boundary years", () => {
    expect(
      upcomingContactDates([mira], { start: "1999-01-01", end: "2000-02-28" }, feb28).map(
        (item) => item.kind,
      ),
    ).toEqual(["anniversary"]);
    expect(
      upcomingContactDates([mira], { start: "2000-02-29", end: "2000-02-29" }, feb28)[0]?.age,
    ).toBe(0);
    expect(upcomingContactDates([mira], { start: "1900-01-01", end: "1900-01-01" }, mar1)).toEqual(
      [],
    );
    const contact = {
      id: mira.id,
      name: mira.name,
      birthday: "0001-01-01",
      anniversary: "--12-31",
    };
    expect(
      upcomingContactDates([contact], { start: "0001-01-01", end: "0001-01-01" }, feb28)[0]?.age,
    ).toBe(0);
    expect(
      upcomingContactDates([contact], { start: "9999-12-31", end: "9999-12-31" }, mar1)[0]?.date,
    ).toBe("9999-12-31");
  });

  it("sorts ties deterministically independent of input order, without merging occasions", () => {
    const a = {
      id: "https://example.org/a",
      name: "Orin Vale",
      birthday: "--01-01",
      anniversary: "--01-01",
    };
    const b = { ...a, id: "https://example.org/b", birthday: "--01-02" };
    const c = { ...a, id: "https://example.org/c" };
    const forward = upcomingContactDates([a, b, c], window2025, feb28);
    expect(upcomingContactDates([c, b, a], window2025, feb28)).toEqual(forward);
    expect(forward.map((item) => [item.date, item.contactId.slice(-1), item.kind])).toEqual([
      ["2025-01-01", "a", "anniversary"],
      ["2025-01-01", "a", "birthday"],
      ["2025-01-01", "b", "anniversary"],
      ["2025-01-01", "c", "anniversary"],
      ["2025-01-01", "c", "birthday"],
      ["2025-01-02", "b", "birthday"],
    ]);
  });

  it.each([
    null,
    undefined,
    [],
    { start: "2025-01-01", end: "2025-12-31", extra: true },
    { start: "2026-01-01", end: "2025-12-31" },
  ])("rejects invalid window shapes and reversed bounds (%j)", (window) => {
    fails(() => upcomingContactDates([], window as never, feb28), "invalid-window");
  });

  it.each([
    {},
    { start: "--01-01", end: "2025-01-01" },
    { start: "2025-01-01", end: "--01-01" },
    { start: "2025-02-30", end: "2025-03-01" },
  ])("rejects unsupported window dates (%j)", (window) => {
    fails(() => upcomingContactDates([], window as never, feb28), "invalid-date");
  });

  it.each([
    null,
    undefined,
    {},
    { leapDay: "skip" },
    { ...feb28, startYear: 2025 },
  ])("validates list options (%j)", (options) => {
    fails(() => upcomingContactDates([], window2025, options as never), "invalid-options");
  });

  it("validates all contacts even when the window would exclude their dates", () => {
    fails(
      () => upcomingContactDates([{ ...mira, anniversary: "not a date" }], window2025, feb28),
      "invalid-date",
    );
  });

  it("does not mutate frozen inputs or share mutable source dates across occurrences/calls", () => {
    const contacts = Object.freeze([Object.freeze({ ...mira })]);
    const options = Object.freeze({ startYear: 2025, ...feb28 });
    const window = Object.freeze({ start: "2025-01-01", end: "2026-12-31" });
    const first = upcomingContactDates(contacts, window, Object.freeze({ ...feb28 }));
    const second = upcomingContactDates(contacts, window, feb28);
    expect(first).toEqual(second);
    expect(first[0]?.sourceDate).not.toBe(first[2]?.sourceDate);
    expect(first[0]?.sourceDate).not.toBe(second[0]?.sourceDate);
    expect(planContactEvents(contacts, options)).toEqual(planContactEvents(contacts, options));
    expect(extractContactDates(contacts)[0]?.sourceDate).not.toBe(
      extractContactDates(contacts)[0]?.sourceDate,
    );
    expect(contacts[0]).toEqual(mira);
  });
});
