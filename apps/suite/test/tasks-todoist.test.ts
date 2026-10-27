// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Tests assert fixture sizes before using entries.
import { describe, expect, it, vi } from "vitest";
import {
  MAX_TODOIST_CSV_BYTES,
  MAX_TODOIST_CSV_ROWS,
  MAX_TODOIST_TIME_ZONES,
  parseTodoistCsv,
  TodoistImportError,
  type TodoistImportErrorCode,
  type TodoistImportOptions,
} from "../src/apps/tasks/lib/todoist";

const options = { defaultTimeZone: "Europe/London" };
const headers = [
  "TYPE",
  "CONTENT",
  "DESCRIPTION",
  "PRIORITY",
  "INDENT",
  "AUTHOR",
  "RESPONSIBLE",
  "DATE",
  "DATE_LANG",
  "TIMEZONE",
  "DURATION",
  "DURATION_UNIT",
];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function csv(rows: Record<string, string>[], names = headers, newline = "\r\n"): string {
  return [
    names.map(quote).join(","),
    ...rows.map((row) => names.map((name) => quote(row[name] ?? "")).join(",")),
  ].join(newline);
}
const task = (fields: Record<string, string> = {}) => ({
  TYPE: "task",
  CONTENT: "Plan a picnic",
  ...fields,
});
function error(input: string, code: TodoistImportErrorCode, line = 2, ctx = options): void {
  expect(() => parseTodoistCsv(input, ctx)).toThrow(TodoistImportError);
  expect(() => parseTodoistCsv(input, ctx)).toThrow(
    expect.objectContaining({ name: "TodoistImportError", code, line }),
  );
}

describe("Todoist project drafts", () => {
  it("imports section order, four levels, promotion and siblings with deterministic references", () => {
    const input = csv([
      task({ CONTENT: "Outside sections" }),
      { TYPE: "section", CONTENT: "Preparation", DESCRIPTION: "**Before** the trip" },
      task({
        CONTENT: "Pack supplies @home",
        PRIORITY: "1",
        AUTHOR: "Avery (avery@example.org)",
        RESPONSIBLE: "Morgan",
        DATE_LANG: "en",
      }),
      task({ CONTENT: "Food", INDENT: "2", PRIORITY: "2" }),
      task({ CONTENT: "Sandwiches", INDENT: "3", PRIORITY: "3" }),
      task({ CONTENT: "Bread", INDENT: "4", PRIORITY: "4" }),
      task({ CONTENT: "Drinks", INDENT: "2" }),
      task({ CONTENT: "Check forecast", INDENT: "1" }),
      { TYPE: "section", CONTENT: "Departure" },
      task({ CONTENT: "Leave" }),
    ]);
    const result = parseTodoistCsv(input, options);
    expect(result.sections).toEqual([
      {
        id: "section-1",
        title: "Preparation",
        description: "**Before** the trip",
        orderKey: 1,
        line: 3,
      },
      { id: "section-8", title: "Departure", description: "", orderKey: 8, line: 10 },
    ]);
    expect(
      result.tasks.map(({ id, parentId, sectionId, orderKey, priority }) => [
        id,
        parentId,
        sectionId,
        orderKey,
        priority,
      ]),
    ).toEqual([
      ["task-0", null, null, 0, 1],
      ["task-2", null, "section-1", 2, 1],
      ["task-3", "task-2", "section-1", 3, 2],
      ["task-4", "task-3", "section-1", 4, 3],
      ["task-5", "task-4", "section-1", 5, 4],
      ["task-6", "task-2", "section-1", 6, 1],
      ["task-7", null, "section-1", 7, 1],
      ["task-9", null, "section-8", 9, 1],
    ]);
    expect(result.tasks[1]).toMatchObject({
      title: "Pack supplies",
      labels: ["home"],
      author: "Avery (avery@example.org)",
      responsible: "Morgan",
      dateLang: "en",
      comments: [],
    });
    expect(result.warnings).toEqual([]);
    expect(parseTodoistCsv(input, options)).toEqual(result);
  });

  it("locates columns by exact name, ignores extra columns and defaults absent optional fields", () => {
    expect(
      parseTodoistCsv("\uFEFFCONTENT,EXTRA,TYPE\ntask title,ignored,task\n", options).tasks[0],
    ).toMatchObject({
      title: "task title",
      indent: 1,
      priority: 1,
      author: "",
      responsible: "",
      dateLang: "",
    });
    expect(parseTodoistCsv("TYPE,CONTENT", options)).toEqual({
      sections: [],
      tasks: [],
      warnings: [],
    });
    expect(parseTodoistCsv("TYPE,CONTENT\r\n", options).tasks).toEqual([]);
    expect(
      parseTodoistCsv("TYPE,EXTRA,CONTENT,EXTRA\ntask,a,Title,b", options).tasks[0]!.title,
    ).toBe("Title");
  });

  it.each([
    ["", 1],
    ["1", 1],
    ["2", 2],
    ["3", 3],
    ["4", 4],
  ])("imports Todoist priority %j as %i", (priority, expected) => {
    const result = parseTodoistCsv(csv([task({ PRIORITY: priority as string })]), options);
    expect(result.tasks[0]!.priority).toBe(expected);
  });

  it.each([
    "\r\n",
    "\n",
  ])("preserves RFC quoted commas, quotes, embedded newlines with %j separators", (newline) => {
    const result = parseTodoistCsv(
      csv(
        [
          task({ CONTENT: 'Read "chapter, one"', DESCRIPTION: `first${newline}second\rthird` }),
          {
            TYPE: "note",
            CONTENT: `Discuss, "later"${newline}with Morgan`,
            AUTHOR: "Avery",
            DESCRIPTION: "extra",
          },
          { TYPE: "mystery", CONTENT: "Skipped" },
        ],
        headers,
        newline,
      ),
      options,
    );
    expect(result.tasks[0]).toMatchObject({
      title: 'Read "chapter, one"',
      description: `first${newline}second\rthird`,
      line: 2,
      comments: [
        {
          content: `Discuss, "later"${newline}with Morgan`,
          author: "Avery",
          description: "extra",
          line: 5,
        },
      ],
    });
    expect(result.warnings).toEqual([{ code: "UNKNOWN_TYPE", line: 7 }]);
  });

  it("warns for orphan notes and unknown types while retaining the last task for comments", () => {
    const result = parseTodoistCsv(
      csv(
        [
          { TYPE: "note", CONTENT: "No task yet" },
          { TYPE: "TASK", CONTENT: "Case sensitive" },
          { TYPE: "", CONTENT: "Blank type" },
          task(),
          { TYPE: "note", CONTENT: "First comment @literal" },
          { TYPE: "section", CONTENT: "Later" },
          { TYPE: "unknown", CONTENT: "Not imported", INDENT: "invalid" },
          { TYPE: "note", CONTENT: "Second comment" },
          task({ INDENT: "2" }),
        ].slice(0, -1),
      ),
      options,
    );
    expect(result.warnings).toEqual([
      { code: "ORPHAN_NOTE", line: 2 },
      { code: "UNKNOWN_TYPE", line: 3 },
      { code: "UNKNOWN_TYPE", line: 4 },
      { code: "UNKNOWN_TYPE", line: 8 },
    ]);
    expect(result.tasks[0]!.orderKey).toBe(3);
    expect(result.tasks[0]!.comments.map((comment) => comment.content)).toEqual([
      "First comment @literal",
      "Second comment",
    ]);
  });
});

describe("content and labels", () => {
  it.each([
    ["@first **Read** @home now @last", "**Read** now", ["first", "home", "last"]],
    [
      "Read @café @二 @home-office @under_score @A1 @A1",
      "Read",
      ["café", "二", "home-office", "under_score", "A1", "A1"],
    ],
    [
      "Mail avery@example.org and https://example.org/@name @plain",
      "Mail avery@example.org and https://example.org/@name",
      ["plain"],
    ],
    [
      "**@bold** [a @label](https://example.org/a @path) `@code` @real",
      "**@bold** [a @label](https://example.org/a @path) `@code`",
      ["real"],
    ],
    ["``a ` @code`` @label", "``a ` @code``", ["label"]],
    ["```\n@code\n```\n@label\nEnd", "```\n@code\n```\n\nEnd", ["label"]],
    [
      "Keep \\@escaped and <https://example.org/ @link> @yes",
      "Keep \\@escaped and <https://example.org/ @link>",
      ["yes"],
    ],
    ["[@ref][id @link] (text @plain) @yes", "[@ref][id @link] (text @plain) ", ["yes"]],
    ["Keep @ @bad! @end. @@double", "Keep @ @bad! @end. @@double", []],
    ["Keep  **markdown**\n  indentation", "Keep  **markdown**\n  indentation", []],
    ["Keep `unclosed @code", "Keep `unclosed @code", []],
    ["Keep [unclosed @link", "Keep [unclosed @link", []],
    ["Keep [link](a(b @path)c) @yes", "Keep [link](a(b @path)c)", ["yes"]],
    ["Keep <a @tag> tail", "Keep <a @tag> tail", []],
    ["Keep \\` @label", "Keep \\`", ["label"]],
    ["@label\tTitle", "Title", ["label"]],
    ["Plan (@label) @home", "Plan (@label)", ["home"]],
    ["Title `path\\` @label", "Title `path\\`", ["label"]],
    ["Title\n~~~ts\n@code\n~~~\n@yes", "Title\n~~~ts\n@code\n~~~", ["yes"]],
    ["Title\n~~~~\n~~~\n@code\n~~~~\n@yes", "Title\n~~~~\n~~~\n@code\n~~~~", ["yes"]],
    ["Title\n~~~\n~~~more\n@code\n~~~\n@yes", "Title\n~~~\n~~~more\n@code\n~~~", ["yes"]],
    ["Title\n~~~\n\n@code", "Title\n~~~\n\n@code", []],
    ["Title\n    @code\n\t@code\n@yes", "Title\n    @code\n\t@code", ["yes"]],
    ["Title\n```\n~~~~\n@code\n```\n@yes", "Title\n```\n~~~~\n@code\n```", ["yes"]],
    ["Title\n```ts\ntext ``` @literal\n```\n@yes", "Title\n```ts\ntext ``` @literal\n```", ["yes"]],
    ["Title\n```\n@code\n`````\n@yes", "Title\n```\n@code\n`````", ["yes"]],
    ["Title\n````\n```\n@code\n````\n@yes", "Title\n````\n```\n@code\n````", ["yes"]],
    ["Title\n```\n``` @literal\n@code\n```\n@yes", "Title\n```\n``` @literal\n@code\n```", ["yes"]],
    ["Title\n```\n    ```\n@code\n   ```\t \n@yes", "Title\n```\n    ```\n@code\n   ```", ["yes"]],
    ["Title\n```\n@code\n~~~\n@literal", "Title\n```\n@code\n~~~\n@literal", []],
    ["Title\n```\n@literal", "Title\n```\n@literal", []],
    ["Title\n```ts\n@literal\n```", "Title\n```ts\n@literal\n```", []],
    ["Title ```@inline``` @yes", "Title ```@inline```", ["yes"]],
    ["```info` @literal``` @yes", "```info` @literal```", ["yes"]],
    ["Title\r\n```\r\n@code\r\n````\r\n@yes", "Title\r\n```\r\n@code\r\n````", ["yes"]],
    ["Title\r```\r@code\r````\r@yes", "Title\r```\r@code\r````", ["yes"]],
  ])("splits labels while preserving markup: %s", (content, title, labels) => {
    const result = parseTodoistCsv(csv([task({ CONTENT: content as string })]), options).tasks[0]!;
    expect(result.title).toBe((title as string).trim());
    expect(result.labels).toEqual(labels);
  });
});

describe("dates and time zones", () => {
  it("reuses one formatter for case variants while preserving each supplied timezone", () => {
    const zones = Array.from({ length: 64 }, (_, mask) =>
      Array.from("Europe/London", (char, index) =>
        mask & (1 << index) ? char.toUpperCase() : char.toLowerCase(),
      ).join(""),
    );
    const NativeFormatter = Intl.DateTimeFormat;
    const formatter = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: The constructor spy must be constructable.
      .mockImplementation(function (locales, config) {
        return new NativeFormatter(locales, config);
      });
    try {
      const result = parseTodoistCsv(
        csv(zones.map((timeZone) => task({ TIMEZONE: timeZone, DATE: "2026-07-04T13:00" }))),
        options,
      );
      expect(result.tasks.map(({ due }) => due)).toEqual(
        zones.map((timeZone) => ({
          kind: "dateTime",
          dateTime: "2026-07-04T12:00:00.000Z",
          timeZone,
        })),
      );
      expect(formatter).toHaveBeenCalledExactlyOnceWith("en-GB", {
        ...formatter.mock.calls[0]![1],
        timeZone: "europe/london",
      });
    } finally {
      formatter.mockRestore();
    }
  });

  it("accepts 32 zones including the default and reuses them at capacity", () => {
    expect(MAX_TODOIST_TIME_ZONES).toBe(32);
    const zones = Intl.supportedValuesOf("timeZone").slice(0, MAX_TODOIST_TIME_ZONES - 1);
    const timeZones = [
      ...zones,
      options.defaultTimeZone,
      ...zones.map((zone) => zone.toUpperCase()),
      zones[0]!,
    ];
    const NativeFormatter = Intl.DateTimeFormat;
    const formatter = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: The constructor spy must be constructable.
      .mockImplementation(function (locales, config) {
        return new NativeFormatter(locales, config);
      });
    try {
      const result = parseTodoistCsv(
        csv(timeZones.map((timeZone) => task({ TIMEZONE: timeZone, DATE: "2026-07-04T13:00Z" }))),
        options,
      );
      expect(result.tasks.map(({ due }) => due)).toEqual(
        timeZones.map((timeZone) => ({
          kind: "dateTime",
          dateTime: "2026-07-04T13:00:00.000Z",
          timeZone,
        })),
      );
      expect(formatter).toHaveBeenCalledTimes(MAX_TODOIST_TIME_ZONES);
    } finally {
      formatter.mockRestore();
    }
  });

  it("rejects a 33rd zone before constructing it and resets the budget for each import", () => {
    const zones = Intl.supportedValuesOf("timeZone").slice(0, MAX_TODOIST_TIME_ZONES);
    const timeZones = [...zones, options.defaultTimeZone];
    const input = csv(
      Array.from({ length: MAX_TODOIST_CSV_ROWS }, (_, index) =>
        task({ TIMEZONE: timeZones[index % timeZones.length]!, DATE: "2026-07-04T13:00Z" }),
      ),
    );
    const NativeFormatter = Intl.DateTimeFormat;
    const formatter = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: The constructor spy must be constructable.
      .mockImplementation(function (locales, config) {
        return new NativeFormatter(locales, config);
      });
    try {
      expect(() => parseTodoistCsv(input, options)).toThrow(
        expect.objectContaining({
          name: "TodoistImportError",
          code: "INVALID_TIMEZONE",
          line: MAX_TODOIST_TIME_ZONES + 1,
        }),
      );
      expect(formatter).toHaveBeenCalledTimes(MAX_TODOIST_TIME_ZONES);
      formatter.mockClear();
      const result = parseTodoistCsv(csv([task({ TIMEZONE: zones.at(-1)! })]), options);
      expect(result.tasks).toHaveLength(1);
      expect(formatter).toHaveBeenCalledTimes(2);
    } finally {
      formatter.mockRestore();
    }
  });

  it.each([
    ["Asia/Kolkata", "Asia/Kolkata"],
    ["Kwajalein", "Kwajalein"],
  ])("rejects Unicode case collisions with %s", (validZone, invalidZone) => {
    const ctx = { defaultTimeZone: validZone };
    error("TYPE,CONTENT", "INVALID_TIMEZONE", 1, { defaultTimeZone: invalidZone });
    for (const date of ["", "2026-07-04T13:00", "2026-07-04T13:00Z"]) {
      // The valid zone is already cached as the default or by an earlier row.
      error(csv([task({ TIMEZONE: invalidZone, DATE: date })]), "INVALID_TIMEZONE", 2, ctx);
      error(
        csv([task({ TIMEZONE: validZone }), task({ TIMEZONE: invalidZone, DATE: date })]),
        "INVALID_TIMEZONE",
        3,
      );
    }
  });

  it.each([
    ["2026-07-04", "Europe/London", "2026-07-03T23:00:00.000Z", "date"],
    ["2026-01-04", "Europe/London", "2026-01-04T00:00:00.000Z", "date"],
    ["2024-02-29", "UTC", "2024-02-29T00:00:00.000Z", "date"],
    ["2024-02-29", "utc", "2024-02-29T00:00:00.000Z", "date"],
    ["2026-07-04T13:45", "", "2026-07-04T12:45:00.000Z", "dateTime"],
    ["2026-07-04T13:45:12.123", "Asia/Kathmandu", "2026-07-04T08:00:12.123Z", "dateTime"],
    ["2026-07-04T00:00:00.1", "UTC", "2026-07-04T00:00:00.100Z", "dateTime"],
    ["2026-07-04T00:00:00.12", "UTC", "2026-07-04T00:00:00.120Z", "dateTime"],
    ["2026-10-25T01:30Z", "Europe/London", "2026-10-25T01:30:00.000Z", "dateTime"],
    ["2026-10-25T01:30+01:00", "Europe/London", "2026-10-25T00:30:00.000Z", "dateTime"],
    ["2026-07-04T23:15:59-03:30", "America/St_Johns", "2026-07-05T02:45:59.000Z", "dateTime"],
    ["2026-07-04T23:15+00:00", "UTC", "2026-07-04T23:15:00.000Z", "dateTime"],
    ["2026-01-01T12:00", "Australia/Lord_Howe", "2026-01-01T01:00:00.000Z", "dateTime"],
    ["0099-02-28", "UTC", "0099-02-28T00:00:00.000Z", "date"],
    ["2026-07-04T13:00", "US/Eastern", "2026-07-04T17:00:00.000Z", "dateTime"],
    ["2026-07-04T13:00", "CET", "2026-07-04T11:00:00.000Z", "dateTime"],
    ["9999-12-29T23:59:59", "UTC", "9999-12-29T23:59:59.000Z", "dateTime"],
    ["9999-12-29T22:59:59", "Europe/Paris", "9999-12-29T21:59:59.000Z", "dateTime"],
    ["9999-12-29T23:59:59Z", "Europe/Paris", "9999-12-29T23:59:59.000Z", "dateTime"],
  ])("resolves %s in %s", (dateText, timeZone, dateTime, kind) => {
    const due = parseTodoistCsv(csv([task({ DATE: dateText, TIMEZONE: timeZone })]), options)
      .tasks[0]!.due!;
    expect(due).toEqual({
      kind,
      dateTime,
      timeZone: timeZone || options.defaultTimeZone,
      ...(kind === "date" ? { date: dateText } : {}),
    });
  });

  it("preserves natural-language dates verbatim without interpreting locale, recurrence or whitespace", () => {
    const result = parseTodoistCsv(
      csv([
        task({ DATE: "every monday", DATE_LANG: "en" }),
        task({ DATE: " demain ", DATE_LANG: "fr", TIMEZONE: "Europe/Paris" }),
        task({ DATE: "every\nmonday" }),
        task({ DATE: "2026 Christmas" }),
        task(),
      ]),
      options,
    );
    expect(result.tasks.map(({ dueText, due }) => [dueText, due])).toEqual([
      ["every monday", undefined],
      [" demain ", undefined],
      ["every\nmonday", undefined],
      ["2026 Christmas", undefined],
      [undefined, undefined],
    ]);
    expect(result.warnings).toEqual([
      { code: "UNPARSED_DATE", line: 2 },
      { code: "UNPARSED_DATE", line: 3 },
      { code: "UNPARSED_DATE", line: 4 },
      { code: "UNPARSED_DATE", line: 6 },
    ]);
  });

  it.each([
    "2026-02-29",
    "2024-02-30",
    "2026-13-01",
    "2026-00-01",
    "0000-01-01",
    "2026-01-00",
    "2026-01-01T24:00",
    "2026-01-01T12:60",
    "2026-01-01T12:00:60",
    "2026-01-01T12:00:00.1234",
    "2026-01-01T12:00+24:00",
    "2026-01-01T12:00+01:60",
    "2026-01-01T12:00-00:00",
    "2026-01-01 12:00",
    "20260101",
    "2026-W01-1",
    "2026-001",
    "2026",
    "2026-01-01\n",
    "0001-01-01",
    "9999-12-31",
  ])("rejects invalid or unsupported ISO date %j", (dateText) => {
    error(csv([task({ DATE: dateText })]), "INVALID_DATE");
  });
  it.each([
    ["9999-12-29T23:59:59", "Europe/Paris"],
    ["9999-12-29T23:59:59.999", "Asia/Tokyo"],
  ])("rejects an unsupported timezone sample at the date boundary: %s %s", (dateText, timeZone) => {
    error(csv([task({ DATE: dateText, TIMEZONE: timeZone })]), "INVALID_DATE");
  });
  it.each([
    ["2026-03-29T01:30", "Europe/London"],
    ["2026-10-25T01:30", "Europe/London"],
    ["2026-10-04T02:15", "Australia/Lord_Howe"],
    ["2026-04-05T01:45", "Australia/Lord_Howe"],
    ["2011-12-30", "Pacific/Apia"],
  ])("rejects a missing or ambiguous local time %s %s", (dateText, timeZone) => {
    error(csv([task({ DATE: dateText, TIMEZONE: timeZone })]), "INVALID_DATE");
  });
  it.each([
    "Invalid/Zone",
    "+01:00",
    " ",
    "PST",
    "Europe/London\n",
  ])("rejects invalid row timezone %j even without a date", (timeZone) => {
    error(csv([task({ TIMEZONE: timeZone })]), "INVALID_TIMEZONE");
  });
  it.each([
    "",
    "Invalid/Zone",
    "+00:00",
    undefined,
    1,
  ])("rejects invalid default timezone %j", (zone) => {
    error("TYPE,CONTENT", "INVALID_TIMEZONE", 1, { defaultTimeZone: zone } as TodoistImportOptions);
  });
  it("rejects missing options with a typed error", () => {
    expect(() =>
      parseTodoistCsv("TYPE,CONTENT", undefined as unknown as TodoistImportOptions),
    ).toThrow(TodoistImportError);
  });
});

describe("validation", () => {
  it.each([
    "",
    "\uFEFF",
    "TYPE",
    "CONTENT",
    "type,content",
    "TYPE,TYPE,CONTENT",
    "TYPE,CONTENT,INDENT,INDENT",
    ",CONTENT",
  ])("rejects missing or duplicate headers %j", (input) => {
    error(input, "INVALID_CSV", 1);
  });
  it.each([
    ['TYPE,CONTENT\ntask,"unclosed', 2],
    ['TYPE,CONTENT\ntask,un"quoted', 2],
    ['TYPE,CONTENT\ntask,"closed"junk', 2],
    ['TYPE,CONTENT\ntask,"closed" ', 2],
    ["TYPE,CONTENT\rtask,Title", 1],
    ["TYPE,CONTENT\ntask,One\rtask,Two", 2],
    ["TYPE,CONTENT\ntask,Title\0", 2],
    ["TYPE,CONTENT\ntask", 2],
    ["TYPE,CONTENT\ntask,Title,Extra", 2],
    ["TYPE,CONTENT\n\n", 2],
    ["TYPE,CONTENT\ntask,", 2],
    ["TYPE,CONTENT\nsection, ", 2],
    ["TYPE,CONTENT\ntask,@label", 2],
  ])("rejects malformed CSV %j", (input, line) => {
    error(input as string, "INVALID_CSV", line as number);
  });
  it.each([
    null,
    123,
    {},
    undefined,
    ["TYPE", "CONTENT"],
  ])("rejects non-string input %j", (input) => {
    error(input as string, "INVALID_CSV", 1);
  });
  it.each(["\ud800", "\ud800X", "\udfff"])("rejects unpaired surrogate %j", (input) => {
    error(`TYPE,CONTENT\ntask,${input}`, "INVALID_CSV", 1);
  });
  it.each([
    "0",
    "5",
    "-1",
    "1.5",
    "01",
    " ",
    "NaN",
    "1\n",
  ])("rejects invalid indent %j", (indent) => {
    error(csv([task({ INDENT: indent })]), "INVALID_INDENT");
  });
  it("rejects jumps, initial nesting and nesting after a new section", () => {
    error(csv([task({ INDENT: "2" })]), "INVALID_INDENT");
    error(csv([task(), task({ INDENT: "3" })]), "INVALID_INDENT", 3);
    error(
      csv([task(), { TYPE: "section", CONTENT: "Next" }, task({ INDENT: "2" })]),
      "INVALID_INDENT",
      4,
    );
    error(csv([task(), task({ INDENT: "2" }), task(), task({ INDENT: "3" })]), "INVALID_INDENT", 5);
  });
  it.each([
    "0",
    "5",
    "p1",
    " 1",
    "1 ",
    "1.0",
    "NaN",
    "1\n",
  ])("rejects invalid priority %j", (priority) => {
    error(csv([task({ PRIORITY: priority })]), "INVALID_PRIORITY");
  });
  it.each([
    ["15", "minute", 15],
    ["1.5", "day", 1.5],
    ["001.500", "day", 1.5],
    ["5.00", "minute", 5],
  ])("imports duration %s %s", (duration, durationUnit, amount) => {
    expect(
      parseTodoistCsv(
        csv([task({ DURATION: duration as string, DURATION_UNIT: durationUnit as string })]),
        options,
      ).tasks[0]!.duration,
    ).toEqual({ amount, unit: durationUnit });
  });
  it.each(["", "None"])("imports an absent duration with unit %j", (unit) => {
    const result = parseTodoistCsv(
      csv([task({ DURATION_UNIT: unit }), task({ DURATION: "5", DURATION_UNIT: "minute" })]),
      options,
    );
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).not.toHaveProperty("duration");
    expect(result.tasks[1]!.duration).toEqual({ amount: 5, unit: "minute" });
    expect(result.warnings).toEqual([]);
  });
  it.each([
    ["", "minute"],
    ["", "none"],
    ["", "None "],
    ["1", "None"],
    ["5", ""],
    ["1", "hour"],
    ["1", "minutes"],
    ["1", "DAY"],
    ["0", "day"],
    ["-1", "day"],
    ["NaN", "day"],
    ["Infinity", "minute"],
    ["1e2", "minute"],
    [" 1", "day"],
    ["1\n", "day"],
    ["9".repeat(400), "day"],
    ["9007199254740993", "minute"],
    ["1.0000000000000001", "minute"],
  ])("rejects duration %j %j", (duration, durationUnit) => {
    error(csv([task({ DURATION: duration, DURATION_UNIT: durationUnit })]), "INVALID_DURATION");
  });
  it("keeps errors free of private row data", () => {
    try {
      parseTodoistCsv(
        csv([task({ CONTENT: "Private fictional title", PRIORITY: "private-value" })]),
        options,
      );
    } catch (caught) {
      expect(String(caught)).toBe("TodoistImportError: Todoist import: INVALID_PRIORITY (line 2)");
    }
  });
});

describe("input budgets", () => {
  it("rejects a long inexact decimal without a backtracking suffix expression", () => {
    error(
      csv([task({ DURATION: `1.${"0".repeat(100_000)}1`, DURATION_UNIT: "minute" })]),
      "INVALID_DURATION",
    );
  });
  it("preserves long Markdown fences containing a bare CR without backtracking", () => {
    const fence = "~".repeat(100_000);
    const title = `Title\n${fence}\rtext\n@literal\n${fence}`;
    const result = parseTodoistCsv(csv([task({ CONTENT: `${title}\n@real` })]), options).tasks[0]!;
    expect(result.title).toBe(title);
    expect(result.labels).toEqual(["real"]);
  });
  it("accepts exactly 4 MiB and rejects bound+1 before CSV syntax or timezone work", () => {
    const prefix = "TYPE,CONTENT\ntask,";
    const atBound = prefix + "a".repeat(MAX_TODOIST_CSV_BYTES - prefix.length);
    expect(new TextEncoder().encode(atBound).length).toBe(4 * 1024 * 1024);
    expect(parseTodoistCsv(atBound, options).tasks[0]!.title.length).toBe(
      MAX_TODOIST_CSV_BYTES - prefix.length,
    );
    error(`${atBound}a`, "CSV_TOO_LARGE", 1, { defaultTimeZone: "invalid" });
  });
  it("counts UTF-8 bytes, including astral characters, before materialising records", () => {
    const prefix = "TYPE,CONTENT\ntask,";
    const multibyte = "é中😀";
    const pad = (MAX_TODOIST_CSV_BYTES - prefix.length) % 9;
    const atBound =
      prefix +
      multibyte.repeat(Math.floor((MAX_TODOIST_CSV_BYTES - prefix.length) / 9)) +
      "x".repeat(pad);
    expect(new TextEncoder().encode(atBound).length).toBe(MAX_TODOIST_CSV_BYTES);
    expect(parseTodoistCsv(atBound, options).tasks).toHaveLength(1);
    error(`${atBound}a`, "CSV_TOO_LARGE", 1);
  });
  it.each([
    "",
    "\n",
  ])("accepts exactly 20,000 data records with ending %j, rejects bound+1 before draft work", (ending) => {
    const atBound = `TYPE,CONTENT\n${Array.from({ length: MAX_TODOIST_CSV_ROWS }, (_, i) => `task,Task ${i}`).join("\n")}`;
    const result = parseTodoistCsv(atBound + ending, options);
    expect(result.tasks).toHaveLength(20_000);
    expect(result.tasks.at(-1)).toMatchObject({ id: "task-19999", orderKey: 19_999, line: 20_001 });
    error(`${atBound}\ntask,One more${ending}`, "CSV_TOO_LARGE", 20_002, {
      defaultTimeZone: "invalid",
    });
  });
  it("counts skipped, note and section records but does not count quoted newlines", () => {
    const atBound = `TYPE,CONTENT\n${'unknown,"first\nsecond"\n'.repeat(MAX_TODOIST_CSV_ROWS - 2)}section,Section\nnote,Orphan`;
    const result = parseTodoistCsv(atBound, options);
    expect(result.warnings).toHaveLength(MAX_TODOIST_CSV_ROWS - 1);
    expect(result.warnings.at(-1)).toEqual({
      code: "ORPHAN_NOTE",
      line: 2 * MAX_TODOIST_CSV_ROWS - 1,
    });
    error(`${atBound}\nnote,Too much`, "CSV_TOO_LARGE", 2 * MAX_TODOIST_CSV_ROWS);
  });
});
