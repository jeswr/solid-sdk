// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseVTodo,
  serializeVTodo,
  toTaskData,
  type VTodoCalendar,
  VTodoError,
  type VTodoErrorCode,
  type VTodoTask,
} from "../src/apps/tasks/lib/vtodo";
import {
  escapeText,
  foldLine,
  unescapeText,
  unfoldLines,
} from "../src/apps/tasks/lib/vtodo/content-lines";
import { dateValue } from "../src/apps/tasks/lib/vtodo/dates";

const stamp = new Date("2026-10-26T09:00:00Z");
const completed = new Date("2026-10-27T10:00:00Z");
const productId = "-//example.org//Fictional tasks//EN";
const uid = "task-one@example.org";
const baseLines = [
  "BEGIN:VTODO",
  `UID:${uid}`,
  "DTSTAMP:20261026T090000Z",
  "SUMMARY:Water the fictional garden",
  "END:VTODO",
];

function component(extra: readonly string[] = []): string[] {
  return [...baseLines.slice(0, -1), ...extra, "END:VTODO"];
}
function calendar(lines: readonly string[] = component()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${productId}`,
    ...lines,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
function task(patch: Partial<VTodoTask> = {}): VTodoTask {
  return { uid, stamp, title: "Water the fictional garden", state: "open", ...patch };
}
function exchange(todo: VTodoTask = task()): VTodoCalendar {
  return { productId, tasks: [todo] };
}
function first(input = calendar()): VTodoTask {
  const result = parseVTodo(input).tasks[0];
  expect(result).toBeDefined();
  return result as VTodoTask;
}
function fails(action: () => unknown, code: VTodoErrorCode): void {
  expect(action).toThrow(VTodoError);
  expect(action).toThrow(
    expect.objectContaining({ name: "VTodoError", code, message: `VTODO: ${code}` }),
  );
}

describe("VTODO exchange", () => {
  it("reads and writes the minimal complete calendar deterministically", () => {
    expect(parseVTodo(calendar())).toEqual(exchange());
    expect(serializeVTodo(exchange())).toBe(calendar());
    expect(toTaskData(task())).toEqual({ task: { title: task().title, state: "open" } });
  });

  it("round-trips every requested field and projects the shared task-model fields", () => {
    const input = calendar(
      component([
        "DESCRIPTION:Ask Mira\\, then Noel\\; visit https://example.org/plan\\nUse \\\\tools",
        "DTSTART:20261026T100000Z",
        "DUE:20261028T110000Z",
        "COMPLETED:20261027T100000Z",
        "STATUS:COMPLETED",
        "PRIORITY:2",
        "PERCENT-COMPLETE:100",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10",
        "RELATED-TO:parent@example.org",
      ]),
    );
    const parsed = parseVTodo(input);
    const todo = first(input);
    expect(todo).toEqual(
      task({
        description: "Ask Mira, then Noel; visit https://example.org/plan\nUse \\tools",
        start: { kind: "utc", value: new Date("2026-10-26T10:00:00Z") },
        due: { kind: "utc", value: new Date("2026-10-28T11:00:00Z") },
        endedAt: completed,
        status: "COMPLETED",
        state: "closed",
        priority: "high",
        icalPriority: 2,
        percentComplete: 100,
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10",
        parentUid: "parent@example.org",
      }),
    );
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
    const mapped = toTaskData(todo, {
      resourceIds: new Map([["parent@example.org", "https://example.org/tasks/parent.ttl#it"]]),
    });
    expect(mapped).toEqual({
      task: {
        title: todo.title,
        description: todo.description,
        state: "closed",
        endedAt: completed,
        dueDate: new Date("2026-10-28T11:00:00Z"),
        priority: "high",
        parent: "https://example.org/tasks/parent.ttl#it",
      },
    });
    expect(mapped.task.endedAt).not.toBe(todo.endedAt);
    expect(mapped.task.dueDate).not.toBe(todo.due?.value);
  });

  it("retains date-only values and requires an explicit account-zone midnight for projection", () => {
    const parsed = parseVTodo(
      calendar(component(["DUE;VALUE=DATE:20261101", "DTSTART;VALUE=DATE:20261031"])),
    );
    const todo = parsed.tasks[0] as VTodoTask;
    expect(todo.due).toEqual({ kind: "date", value: "2026-11-01" });
    expect(todo.start).toEqual({ kind: "date", value: "2026-10-31" });
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
    fails(() => toTaskData(todo), "invalid-value");
    const midnight = new Date("2026-11-01T04:00:00Z");
    expect(toTaskData(todo, { allDayDueInstant: midnight })).toEqual({
      task: { title: todo.title, state: "open", dueDate: midnight },
      dueDay: "2026-11-01",
    });
    expect(toTaskData(todo, { allDayDueInstant: midnight }).task.dueDate).not.toBe(midnight);
  });

  it("handles leap days, early years and boundaries without Date's year-0-to-99 coercion", () => {
    for (const value of [
      "00010101T000000Z",
      "00991231T235959Z",
      "20240229T235959Z",
      "99991231T235959Z",
    ]) {
      const parsed = parseVTodo(calendar(component([`DUE:${value}`])));
      expect(serializeVTodo(parsed)).toContain(`DUE:${value}`);
    }
    expect(first(calendar(component(["DUE;VALUE=DATE:20240229"]))).due).toEqual({
      kind: "date",
      value: "2024-02-29",
    });
  });

  it.each([
    ["NEEDS-ACTION", "open"],
    ["IN-PROCESS", "open"],
    ["COMPLETED", "closed"],
    ["CANCELLED", "closed"],
  ] as const)("preserves status %s as model state %s", (status, state) => {
    const parsed = parseVTodo(calendar(component([`STATUS:${status.toLowerCase()}`])));
    expect(parsed.tasks[0]).toMatchObject({ status, state });
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
  });

  it("retains completion without explicit STATUS and emits a status for model-only closed tasks", () => {
    const parsed = parseVTodo(calendar(component(["COMPLETED:20261027T100000Z"])));
    expect(parsed.tasks[0]).toMatchObject({ endedAt: completed, state: "closed" });
    expect(serializeVTodo(parsed)).not.toContain("STATUS:");
    expect(first(serializeVTodo(exchange(task({ state: "closed" }))))).toMatchObject({
      status: "COMPLETED",
      state: "closed",
    });
  });

  it.each(
    Array.from({ length: 10 }, (_, value) => value),
  )("retains numeric priority %i and maps its band", (value) => {
    const parsed = parseVTodo(calendar(component([`PRIORITY:${value}`])));
    const expected = value === 0 ? undefined : value <= 4 ? "high" : value === 5 ? "medium" : "low";
    expect(parsed.tasks[0]?.priority).toBe(expected);
    expect(parsed.tasks[0]?.icalPriority).toBe(value);
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
  });

  it.each([
    ["high", 1],
    ["medium", 5],
    ["low", 9],
  ] as const)("exports model priority %s as %i", (priority, number) => {
    expect(serializeVTodo(exchange(task({ priority })))).toContain(`PRIORITY:${number}\r\n`);
  });

  it.each([0, 37, 100])("retains percent complete %i without changing lifecycle state", (value) => {
    const parsed = parseVTodo(calendar(component([`PERCENT-COMPLETE:${value}`])));
    expect(parsed.tasks[0]).toMatchObject({ percentComplete: value, state: "open" });
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
  });

  it("accepts case-insensitive names, explicit/quoted VALUE parameters and GREGORIAN scale", () => {
    const input = calendar([
      "calscale:gregorian",
      "begin:vtodo",
      `uid;value=text:${uid}`,
      "dtstamp;value=DATE-TIME:20261026T090000Z",
      'summary;value="text":Fictional task',
      "description;value=TEXT:",
      "due;value=DATE-TIME:20261101T000000Z",
      "dtstart;value=DATE-TIME:20261031T000000Z",
      "status;value=TEXT:in-process",
      "priority;value=INTEGER:+05",
      "percent-complete;value=INTEGER:00",
      "rrule;value=RECUR:BYDAY=MO;FREQ=WEEKLY",
      'related-to;reltype="parent";value=text:external@example.org',
      "end:vtodo",
    ])
      .replace("BEGIN:VCALENDAR", "begin:vcalendar")
      .replace("END:VCALENDAR", "end:vcalendar");
    const parsed = parseVTodo(input);
    expect(parsed.scale).toBe("GREGORIAN");
    expect(parsed.tasks[0]).toMatchObject({
      description: "",
      status: "IN-PROCESS",
      priority: "medium",
      percentComplete: 0,
    });
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
    const completion = first(calendar(component(["COMPLETED;VALUE=DATE-TIME:20261027T100000Z"])));
    expect(completion.endedAt).toEqual(completed);
  });

  it("preserves multiple tasks, including child-before-parent and external parent UIDs", () => {
    const input = calendar([
      ...component(["RELATED-TO;RELTYPE=PARENT:parent@example.org"]),
      ...component().map((line) => line.replace(uid, "parent@example.org")),
    ]);
    const parsed = parseVTodo(input);
    expect(parsed.tasks.map((todo) => todo.uid)).toEqual([uid, "parent@example.org"]);
    expect(parseVTodo(serializeVTodo(parsed))).toEqual(parsed);
    fails(() => toTaskData(parsed.tasks[0] as VTodoTask), "unresolved-parent");
  });

  it("unfolds one continuation character, retains whitespace and handles TEXT escape parity", () => {
    expect(first(calendar(component(["DESCRIPTION:first\r\n second\r\n\t third"])))).toMatchObject({
      description: "firstsecond third",
    });
    expect(unescapeText("a\\Nb\\nc\\,d\\;e\\\\f")).toBe("a\nb\nc,d;e\\f");
    for (let count = 0; count <= 6; count++) {
      const text = `${"\\".repeat(count)};,\n`;
      expect(unescapeText(escapeText(text))).toBe(text);
    }
    expect(
      first(calendar().replace("Water the fictional garden", "  Mira:\tNoel\u2028\u2029  ")).title,
    ).toBe("  Mira:\tNoel\u2028\u2029  ");
  });

  it("folds at 75 UTF-8 octets and preserves multibyte characters and escape boundaries", () => {
    for (const title of [
      "a".repeat(67),
      "a".repeat(68),
      "é".repeat(150),
      "🌱".repeat(150),
      `${"a".repeat(66)};\\\n${"b".repeat(140)}`,
    ]) {
      const output = serializeVTodo(exchange(task({ title })));
      for (const line of output.split("\r\n"))
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(first(output).title).toBe(title);
    }
    expect(foldLine("a".repeat(75))).toBe("a".repeat(75));
    expect(foldLine("a".repeat(76))).toBe(`${"a".repeat(75)}\r\n a`);
    expect(foldLine("")).toBe("");
    fails(() => foldLine("injected\nline"), "invalid-value");
  });

  it("round-trips synthetic arbitrary text without creating properties or components", () => {
    const text = fc
      .array(fc.constantFrom("a", " ", ",", ";", "\\", "\n", ":", "é", "🌱", "\t"), {
        maxLength: 180,
      })
      .map((characters) => `Fictional ${characters.join("")}`);
    fc.assert(
      fc.property(text, text, (title, description) => {
        const parsed = first(serializeVTodo(exchange(task({ title, description }))));
        expect(parsed.title).toBe(title);
        expect(parsed.description).toBe(description);
      }),
      { seed: 5545, numRuns: 100 },
    );
    const title = "Mira\nEND:VTODO\nBEGIN:VEVENT\nSUMMARY:Noel";
    expect(first(serializeVTodo(exchange(task({ title })))).title).toBe(title);
  });
});

describe("VTODO fail-closed input", () => {
  it.each([
    "VEVENT",
    "VJOURNAL",
    "VFREEBUSY",
    "VTIMEZONE",
    "VALARM",
    "X-FICTIONAL",
    "VCALENDAR",
  ])("rejects component %s, including mixed calendars", (name) => {
    fails(() => parseVTodo(calendar([`BEGIN:${name}`, `END:${name}`])), "unsupported-component");
    fails(
      () => parseVTodo(calendar([...component(), `BEGIN:${name}`, `END:${name}`])),
      "unsupported-component",
    );
    fails(
      () => parseVTodo(calendar(component([`BEGIN:${name}`, `END:${name}`]))),
      "unsupported-component",
    );
  });

  it.each([
    "DURATION:PT1H",
    "ATTENDEE:mailto:mira@example.org",
    "RECURRENCE-ID:20261026T090000Z",
    "EXDATE:20261026T090000Z",
    "RDATE:20261026T090000Z",
    "X-FICTIONAL:present",
    "CREATED:20261026T090000Z",
  ])("rejects unsupported property %s atomically", (property) => {
    fails(
      () =>
        parseVTodo(
          calendar([
            ...component(),
            ...component([property]).map((line) => line.replace(uid, "second@example.org")),
          ]),
        ),
      "unsupported-property",
    );
  });

  it.each([
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Fictional calendar",
    "SUMMARY:Calendar title",
  ])("rejects unsupported header %s", (header) => {
    fails(() => parseVTodo(calendar([header, ...component()])), "unsupported-property");
  });

  it.each([
    "DUE;TZID=Europe-London:20261101T090000",
    "DUE;VALUE=DATE-TIME;TZID=UTC:20261101T090000Z",
    "DUE;VALUE=PERIOD:20261101T090000Z",
    "SUMMARY;LANGUAGE=en:Fictional",
    "DESCRIPTION;ALTREP=fictional:Body",
    "RELATED-TO;RELTYPE=CHILD:parent@example.org",
    "RELATED-TO;RELTYPE=SIBLING:parent@example.org",
    "DTSTAMP;VALUE=DATE:20261101",
    "PRIORITY;VALUE=TEXT:1",
  ])("rejects unsupported parameter semantics in %s", (property) => {
    const name = property.split(/[;:]/u)[0];
    const lines = component().filter((line) => !line.startsWith(`${name}:`));
    fails(
      () => parseVTodo(calendar([...lines.slice(0, -1), property, "END:VTODO"])),
      "unsupported-parameter",
    );
  });

  it("rejects unsupported component/header parameters and malformed parameter syntax", () => {
    fails(
      () => parseVTodo(calendar().replace("BEGIN:VTODO", "BEGIN;VALUE=TEXT:VTODO")),
      "unsupported-parameter",
    );
    fails(
      () => parseVTodo(calendar().replace("END:VTODO", "END;VALUE=TEXT:VTODO")),
      "unsupported-parameter",
    );
    fails(
      () => parseVTodo(calendar().replace("VERSION:", "VERSION;VALUE=TEXT:")),
      "unsupported-parameter",
    );
    fails(
      () => parseVTodo(calendar(component(['DESCRIPTION;ALTREP="https://example.org/body":Body']))),
      "invalid-syntax",
    );
    fails(
      () => parseVTodo(calendar(component(["DUE;VALUE=DATE;value=DATE:20261101"]))),
      "duplicate",
    );
  });

  it.each(["UID", "DTSTAMP", "SUMMARY"])("requires singleton %s", (name) => {
    fails(
      () => parseVTodo(calendar(component().filter((line) => !line.startsWith(`${name}:`)))),
      "missing-required",
    );
  });

  it.each(["VERSION", "PRODID"])("requires header %s", (name) => {
    fails(
      () =>
        parseVTodo(
          calendar()
            .split("\r\n")
            .filter((line) => !line.startsWith(`${name}:`))
            .join("\r\n"),
        ),
      "missing-required",
    );
  });

  it.each([
    "UID:another@example.org",
    "DTSTAMP:20261027T090000Z",
    "SUMMARY:Another",
    "DUE:20261101T090000Z",
    "STATUS:COMPLETED",
    "PRIORITY:1",
    "PERCENT-COMPLETE:1",
    "RRULE:FREQ=DAILY",
    "RELATED-TO:parent@example.org",
  ])("rejects duplicate singleton %s", (property) => {
    const name = property.split(":")[0] as string;
    const initial = component().some((line) => line.startsWith(`${name}:`)) ? [] : [property];
    fails(() => parseVTodo(calendar(component([...initial, property]))), "duplicate");
  });

  it("rejects duplicate headers and UIDs", () => {
    fails(() => parseVTodo(calendar(["VERSION:2.0", ...component()])), "duplicate");
    fails(() => parseVTodo(calendar([...component(), ...component()])), "duplicate");
    fails(() => serializeVTodo({ productId, tasks: [task(), task()] }), "duplicate");
  });

  it.each([
    "DUE:20261101T090000",
    "DUE:20261101T090000+0100",
    "DUE:20260230T090000Z",
    "DUE:20261301T090000Z",
    "DUE:20260101T240000Z",
    "DUE:20260101T006000Z",
    "DUE:20260101T000060Z",
    "DUE:00000101T000000Z",
    "DUE;VALUE=DATE:20260229",
    "DUE;VALUE=DATE:20261131",
    "DUE;VALUE=DATE:2026-11-01",
    "DUE;VALUE=DATE:00000101",
    "COMPLETED:20261101",
    "STATUS:UNKNOWN",
    "PRIORITY:-1",
    "PRIORITY:10",
    "PRIORITY:1.5",
    "PRIORITY:1e0",
    "PERCENT-COMPLETE:101",
    "PERCENT-COMPLETE:-1",
    "PERCENT-COMPLETE:NaN",
    "RRULE:",
    "RRULE:FREQ=DAILY;",
    "DESCRIPTION:bad\\qescape",
    "DESCRIPTION:trailing\\",
    "DESCRIPTION:unescaped,comma",
    "DESCRIPTION:unescaped;semicolon",
    "RELATED-TO:task-one@example.org",
    "RELATED-TO:parent\\nnewline@example.org",
  ])("rejects invalid/unsupported value %s", (property) => {
    fails(() => parseVTodo(calendar(component([property]))), "invalid-value");
  });

  it("rejects inconsistent dates, missing recurrence start and lifecycle contradictions", () => {
    for (const lines of [
      ["DTSTART:20261101T090000Z", "DUE:20261101T090000Z"],
      ["DTSTART:20261101T090000Z", "DUE:20261101T080000Z"],
      ["DTSTART;VALUE=DATE:20261101", "DUE:20261102T090000Z"],
      ["DTSTART;VALUE=DATE:20261101", "DUE;VALUE=DATE:20261101"],
      ["STATUS:NEEDS-ACTION", "COMPLETED:20261101T090000Z"],
      ["STATUS:CANCELLED", "COMPLETED:20261101T090000Z"],
    ])
      fails(() => parseVTodo(calendar(component(lines))), "invalid-value");
    fails(() => parseVTodo(calendar(component(["RRULE:FREQ=DAILY"]))), "missing-required");
  });

  it.each([
    "",
    "BEGIN:VCALENDAR\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\rEND:VCALENDAR\r",
    "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    " BEGIN:VCALENDAR\r\n",
    "\tBEGIN:VCALENDAR\r\n",
    "BEGIN:VCALENDAR\r\n\r\nEND:VCALENDAR\r\n",
    "BEGIN:VTODO\r\nEND:VTODO\r\n",
    "END:VCALENDAR\r\n",
    "BEGIN:VCALENDAR\r\n",
  ])("rejects malformed framing %#", (input) => {
    fails(() => parseVTodo(input), "invalid-syntax");
  });

  it("rejects unclosed/misnested/trailing components and properties outside VTODO", () => {
    for (const input of [
      calendar().replace("END:VTODO\r\n", ""),
      calendar().replace("END:VCALENDAR\r\n", ""),
      calendar().replace("END:VTODO", "END:VEVENT"),
      calendar().replace("END:VCALENDAR", "END:VTODO"),
      calendar(component(["BEGIN:VTODO"])),
      `${calendar()}extra\r\n`,
      calendar([...component(), "SUMMARY:outside"]),
      calendar(component(["no colon"])),
    ])
      fails(() => parseVTodo(input), "invalid-syntax");
  });

  it("rejects wrong versions/scales, empty calendars and blank model-required text", () => {
    fails(() => parseVTodo(calendar().replace("VERSION:2.0", "VERSION:1.0")), "invalid-value");
    fails(() => parseVTodo(calendar(["CALSCALE:FICTIONAL", ...component()])), "invalid-value");
    fails(() => parseVTodo(calendar([])), "missing-required");
    for (const field of ["SUMMARY", "UID", "PRODID"]) {
      fails(
        () => parseVTodo(calendar().replace(new RegExp(`${field}:[^\\r]+`, "u"), `${field}:  `)),
        "missing-required",
      );
    }
  });

  it("rejects controls, malformed Unicode and non-string inputs without leaking contents", () => {
    for (const invalid of [
      "\u0000",
      "\u0007",
      "\u000b",
      "\u000c",
      "\u001f",
      "\u007f",
      "\ud800",
      "\udfff",
    ]) {
      fails(() => parseVTodo(calendar().replace("Water", `PRIVATE${invalid}`)), "invalid-value");
      fails(() => serializeVTodo(exchange(task({ title: `PRIVATE${invalid}` }))), "invalid-value");
    }
    fails(() => parseVTodo(null as unknown as string), "invalid-input");
    fails(
      () => serializeVTodo(exchange(task({ title: 42 as unknown as string }))),
      "invalid-value",
    );
    fails(() => serializeVTodo(exchange(task({ title: "PRIVATE\rtext" }))), "invalid-value");
    fails(
      () => parseVTodo(calendar().replace(`UID:${uid}`, "UID:private\\nidentifier")),
      "invalid-value",
    );
  });

  it("validates caller-created export objects and never drops unsupported fields", () => {
    for (const invalid of [null, 1]) {
      fails(() => serializeVTodo(invalid as unknown as VTodoCalendar), "invalid-input");
      fails(
        () => serializeVTodo({ productId, tasks: [invalid as unknown as VTodoTask] }),
        "invalid-input",
      );
    }
    fails(
      () => serializeVTodo({ ...exchange(), extra: true } as VTodoCalendar),
      "unsupported-property",
    );
    fails(
      () =>
        serializeVTodo(
          exchange({ ...task(), assignee: "https://example.org/mira#me" } as VTodoTask),
        ),
      "unsupported-property",
    );
    fails(() => serializeVTodo({ productId, tasks: [] }), "missing-required");
    fails(
      () => serializeVTodo({ productId, tasks: null } as unknown as VTodoCalendar),
      "missing-required",
    );
    fails(
      () => serializeVTodo({ ...exchange(), scale: "OTHER" } as unknown as VTodoCalendar),
      "invalid-value",
    );
    for (const patch of [
      { uid: "bad\nuid" },
      { state: "other" },
      { status: "OTHER" },
      { status: "COMPLETED", state: "open" },
      { endedAt: completed, state: "open" },
      { endedAt: completed, status: "CANCELLED", state: "closed" },
      { priority: "urgent" },
      { priority: "low", icalPriority: 1 },
      { percentComplete: 0.5 },
      { percentComplete: "10" },
      { percentComplete: -1 },
      { percentComplete: Infinity },
      { stamp: new Date(NaN) },
      { stamp: "2026-10-26T09:00:00Z" },
      { stamp: new Date("2026-10-26T09:00:00.001Z") },
      { stamp: new Date("+010000-01-01T00:00:00Z") },
      { rrule: 42 },
      { rrule: "FREQ=DAILY\r\nSUMMARY:injection" },
      { due: null },
      { due: { kind: "local", value: stamp } },
      { due: { kind: "date", value: 42 } },
      { due: { kind: "date", value: "2026-10-26", tzid: "UTC" } },
    ])
      fails(() => serializeVTodo(exchange(task(patch as Partial<VTodoTask>))), "invalid-value");
    fails(() => dateValue(1 as never), "invalid-value");
    fails(() => toTaskData(task({ parentUid: "\n" })), "missing-required");
    fails(() => toTaskData(task({ parentUid: "a\nb" })), "invalid-value");
  });

  it.each([
    undefined,
    "relative",
    "urn:example:parent",
    "https://",
    "https://[",
    "https://example.org/has space",
    "https://mira:password@example.org/task",
    "https://:443/task",
  ])("rejects unresolved/invalid parent mapping %#", (parent) => {
    const todo = task({ parentUid: "parent@example.org" });
    const resourceIds = new Map<string, string>();
    if (parent !== undefined) resourceIds.set("parent@example.org", parent);
    fails(() => toTaskData(todo, { resourceIds }), "unresolved-parent");
  });

  it("permits explicitly resolved HTTP parent resources", () => {
    const todo = task({ parentUid: "external@example.org" });
    const resourceIds = new Map([["external@example.org", "http://example.org/tasks/parent#it"]]);
    expect(toTaskData(todo, { resourceIds }).task.parent).toBe(
      "http://example.org/tasks/parent#it",
    );
  });

  it("checks malformed text helpers independently", () => {
    fails(() => unescapeText("a\\\\,b"), "invalid-value");
    expect(unfoldLines("a\r\n\tb\r\n")).toEqual(["ab"]);
  });
});
