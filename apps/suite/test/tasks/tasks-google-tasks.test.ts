// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  GoogleTasksImportError,
  type GoogleTasksImportErrorCode,
  MAX_GOOGLE_TASKS_JSON_BYTES,
  MAX_GOOGLE_TASKS_JSON_DEPTH,
  MAX_GOOGLE_TASKS_LISTS,
  MAX_GOOGLE_TASKS_TASKS,
  type ProjectImportDraft,
  parseGoogleTasksJson,
} from "../../src/apps/tasks/lib/google-tasks";
import { parseTodoistCsv } from "../../src/apps/tasks/lib/todoist";

const task = (values: Record<string, unknown> = {}) => ({
  kind: "tasks#task",
  id: "task-1",
  title: "Buy groceries",
  status: "needsAction",
  position: "00000000000000000001",
  updated: "2026-11-01T10:30:00.000Z",
  ...values,
});
const list = (tasks: unknown[] = [], values: Record<string, unknown> = {}) => ({
  kind: "tasks#taskList",
  id: "list-1",
  title: "Home",
  updated: "2026-11-01T10:30:00.000Z",
  items: tasks,
  ...values,
});
const takeout = (lists: unknown[] = [list()]) =>
  JSON.stringify({ kind: "tasks#taskLists", items: lists });
const single = (values: Record<string, unknown> = {}) => takeout([list([task(values)])]);

function fails(input: string, code: GoogleTasksImportErrorCode) {
  expect(() => parseGoogleTasksJson(input)).toThrowError(GoogleTasksImportError);
  try {
    parseGoogleTasksJson(input);
  } catch (error) {
    expect(error).toMatchObject({
      name: "GoogleTasksImportError",
      code,
      message: `Google Tasks import: ${code}`,
    });
  }
}

describe("Google Tasks JSON import", () => {
  it("projects a realistic multi-list Takeout into ordered, local import drafts", () => {
    const input = takeout([
      list([
        task({ id: "child", title: " Milk ", parent: "parent", position: "0002" }),
        task({
          id: "later",
          title: "Call plumber",
          position: "0003",
          due: "2026-11-05T00:00:00.000Z",
        }),
        task({
          id: "parent",
          title: "Shopping",
          position: "0001",
          notes: "Bring bags\nUse vouchers",
          links: [
            { type: "email", description: "Receipt", link: "https://mail.example/receipt" },
            { type: "generic", description: "Shop", link: "https://shop.example" },
          ],
        }),
        task({ id: "earlier-child", title: "Bread", parent: "parent", position: "0001" }),
      ]),
      list(
        [
          task({
            id: "parent",
            title: "Send invoice",
            status: "completed",
            completed: "2026-11-01T12:34:56.123456789+01:00",
            hidden: true,
            notes: "Filed",
            due: "2026-10-31T00:00:00Z",
          }),
          { id: "deleted", deleted: true },
        ],
        { id: "work", title: " Work " },
      ),
    ]);
    const result = parseGoogleTasksJson(input);
    const [home, work] = result.projects;
    expect(home).toEqual({
      id: "project-0",
      name: "Home",
      sections: [],
      warnings: [],
      tasks: [
        {
          id: "task-0-2",
          sourceId: "parent",
          title: "Shopping",
          description:
            "Bring bags\nUse vouchers\nReceipt: https://mail.example/receipt\nShop: https://shop.example",
          parentId: null,
          indent: 1,
          orderKey: 0,
          line: 3,
        },
        {
          id: "task-0-3",
          sourceId: "earlier-child",
          title: "Bread",
          description: "",
          parentId: "task-0-2",
          indent: 2,
          orderKey: 1,
          line: 4,
        },
        {
          id: "task-0-0",
          sourceId: "child",
          title: "Milk",
          description: "",
          parentId: "task-0-2",
          indent: 2,
          orderKey: 2,
          line: 1,
        },
        {
          id: "task-0-1",
          sourceId: "later",
          title: "Call plumber",
          description: "",
          parentId: null,
          indent: 1,
          orderKey: 3,
          line: 2,
          due: {
            kind: "date",
            date: "2026-11-05",
            dateTime: "2026-11-05T00:00:00.000Z",
            timeZone: "UTC",
          },
        },
      ].map((entry) => ({
        ...entry,
        state: "open",
        sectionId: null,
        labels: [],
        author: "",
        responsible: "",
        dateLang: "",
        comments: [],
      })),
    });
    expect(work).toMatchObject({
      id: "project-1",
      name: "Work",
      sections: [],
      tasks: [
        {
          id: "task-1-0",
          sourceId: "parent",
          title: "Send invoice",
          state: "closed",
          completedAt: "2026-11-01T11:34:56.123Z",
          due: { kind: "date", date: "2026-10-31" },
        },
      ],
      warnings: [
        { code: "HIDDEN_COMPLETED", list: 2, task: 1 },
        { code: "DELETED_TASK", list: 2, task: 2 },
      ],
    });
    expect(result.warnings).toEqual(work?.warnings);
    expect(
      result.projects
        .flatMap((project) => project.tasks)
        .every((entry) => !Object.hasOwn(entry, "priority")),
    ).toBe(true);
    const shared: readonly ProjectImportDraft[] = [
      ...result.projects,
      parseTodoistCsv("TYPE,CONTENT\ntask,Read", { defaultTimeZone: "UTC" }),
    ];
    expect(shared).toHaveLength(3);
  });

  it("accepts empty lists, missing items, and a leading BOM", () => {
    expect(parseGoogleTasksJson('\uFEFF{"kind":"tasks#taskLists"}')).toEqual({
      projects: [],
      warnings: [],
    });
    expect(parseGoogleTasksJson(takeout([list([], { items: undefined })])).projects).toMatchObject([
      { name: "Home", tasks: [] },
    ]);
    expect(parseGoogleTasksJson(takeout()).projects).toHaveLength(1);
  });

  it("accepts tasks.list API responses with an explicit or fallback project name", () => {
    const input = JSON.stringify({
      kind: "tasks#tasks",
      items: [task({ kind: undefined, hidden: true, deleted: false, notes: "", links: [] })],
    });
    expect(parseGoogleTasksJson(input).projects[0]).toMatchObject({
      name: "Imported tasks",
      warnings: [],
      tasks: [{ state: "open", description: "" }],
    });
    expect(parseGoogleTasksJson(input, { singleListName: " My list " }).projects[0]?.name).toBe(
      "My list",
    );
    expect(parseGoogleTasksJson('{"kind":"tasks#tasks"}').projects[0]?.tasks).toEqual([]);
    expect(
      parseGoogleTasksJson(takeout([list([], { kind: undefined })])).projects[0]?.tasks,
    ).toEqual([]);
    for (const options of [null, [], { singleListName: " " }, { singleListName: 2 }]) {
      expect(() => parseGoogleTasksJson(input, options as never)).toThrowError(
        GoogleTasksImportError,
      );
    }
  });

  it("keeps literal text, links and optional completion dates without tokenising or resolving", () => {
    const result = parseGoogleTasksJson(
      single({
        title: "Read @work p1",
        notes: "  [link](https://example.org)  ",
        links: [{ description: "", link: "mailto:a@example.org" }],
        status: "completed",
      }),
    );
    expect(result.projects[0]?.tasks[0]).toMatchObject({
      title: "Read @work p1",
      labels: [],
      state: "closed",
      description: "  [link](https://example.org)  \n: mailto:a@example.org",
    });
    expect(result.projects[0]?.tasks[0]).not.toHaveProperty("completedAt");
    expect(
      parseGoogleTasksJson(
        single({ links: [{ description: "Docs", link: "https://example.org" }] }),
      ).projects[0]?.tasks[0]?.description,
    ).toBe("Docs: https://example.org");
  });

  it("orders equal and large zero-padded positions stably without numeric precision loss", () => {
    const tasks = [
      task({ id: "later", position: "99999999999999999999" }),
      task({ id: "first", position: "99999999999999999998" }),
      task({ id: "tie", position: "99999999999999999998" }),
    ];
    expect(
      parseGoogleTasksJson(takeout([list(tasks)])).projects[0]?.tasks.map((entry) => entry.id),
    ).toEqual(["task-0-1", "task-0-2", "task-0-0"]);
  });

  it("promotes absent, deleted and other-list parents with indexed warnings", () => {
    const result = parseGoogleTasksJson(
      takeout([
        list([
          task({ parent: "missing" }),
          task({ id: "gone", deleted: true }),
          task({ id: "orphan", parent: "gone" }),
          task({ id: "cross-list", parent: "elsewhere" }),
        ]),
        list([task({ id: "elsewhere" })], { id: "other" }),
      ]),
    );
    expect(
      result.projects[0]?.tasks.every((entry) => entry.parentId === null && entry.indent === 1),
    ).toBe(true);
    expect(result.warnings).toEqual([
      { code: "DELETED_TASK", list: 1, task: 2 },
      { code: "UNKNOWN_PARENT", list: 1, task: 1 },
      { code: "UNKNOWN_PARENT", list: 1, task: 3 },
      { code: "UNKNOWN_PARENT", list: 1, task: 4 },
    ]);
  });

  it("flattens deeper descendants under their root, sorting the resulting siblings", () => {
    const result = parseGoogleTasksJson(
      takeout([
        list([
          task({ id: "grandchild", parent: "child", position: "0001" }),
          task({ id: "great-grandchild", parent: "grandchild", position: "0003" }),
          task({ id: "root", position: "0009" }),
          task({ id: "child", parent: "root", position: "0002" }),
        ]),
      ]),
    );
    expect(
      result.projects[0]?.tasks.map(({ id, parentId, indent, orderKey }) => ({
        id,
        parentId,
        indent,
        orderKey,
      })),
    ).toEqual([
      { id: "task-0-2", parentId: null, indent: 1, orderKey: 0 },
      { id: "task-0-0", parentId: "task-0-2", indent: 2, orderKey: 1 },
      { id: "task-0-3", parentId: "task-0-2", indent: 2, orderKey: 2 },
      { id: "task-0-1", parentId: "task-0-2", indent: 2, orderKey: 3 },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "DEPTH_FLATTENED",
      "DEPTH_FLATTENED",
    ]);
  });

  it("rejects self-parenting and disconnected cycles", () => {
    fails(single({ parent: "task-1" }), "INVALID_HIERARCHY");
    fails(
      takeout([list([task(), task({ id: "a", parent: "b" }), task({ id: "b", parent: "a" })])]),
      "INVALID_HIERARCHY",
    );
  });

  it.each([
    "2026-11-05T00:00:00Z",
    "2026-11-05t23:59:59.1z",
    "2026-11-05T00:00:00.123456+14:00",
    "2026-11-05T00:00:00-12:30",
    "2024-02-29T00:00:00+00:00",
  ])("retains the due calendar date regardless of timestamp offset: %s", (due) => {
    expect(parseGoogleTasksJson(single({ due })).projects[0]?.tasks[0]?.due).toEqual({
      kind: "date",
      date: due.slice(0, 10),
      dateTime: `${due.slice(0, 10)}T00:00:00.000Z`,
      timeZone: "UTC",
    });
  });

  it.each([
    null,
    7,
    "",
    "2026-11-05",
    "2026-11-05T00:00Z",
    "2026-11-05T00:00:00",
    "2026-02-29T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-11-05T24:00:00Z",
    "2026-11-05T00:60:00Z",
    "2026-11-05T00:00:60Z",
    "0000-01-01T00:00:00Z",
    "2026-11-05T00:00:00+24:00",
    "2026-11-05T00:00:00+00:60",
    "2026-11-05T00:00:00-00:00",
    "2026-11-05T00:00:00Z\n",
    "9999-12-31T23:59:59-01:00",
    "0001-01-01T00:00:00+00:01",
  ])("rejects invalid or unsupported RFC 3339 values: %j", (due) => {
    fails(single({ due }), "INVALID_DATE");
    fails(single({ status: "completed", completed: due }), "INVALID_DATE");
  });

  it("requires completion timestamps to belong to completed tasks", () => {
    fails(single({ completed: "2026-11-01T00:00:00Z" }), "INVALID_DATA");
  });

  it.each([
    "null",
    "[]",
    "1",
    "true",
    '"secret"',
    "{}",
    '{"kind":"wrong"}',
  ])("rejects non-object or unrecognised roots: %s", (input) => fails(input, "INVALID_DATA"));

  it.each([
    "",
    "secret file contents",
    '{"kind":"tasks#taskLists",}',
    '{"secret":',
    '{"kind":"tasks#taskLists","items":[}',
    "\uD800",
    "\uD800x",
    "\uDC00",
  ])("returns a content-free typed error for malformed input: %j", (input) =>
    fails(input, "INVALID_JSON"));

  it.each([
    { id: "" },
    { id: 4 },
    { title: " " },
    { title: false },
    { status: "open" },
    { status: null },
    { kind: "wrong" },
    { notes: null },
    { links: {} },
    { links: [null] },
    { links: [{ description: "Docs", link: false }] },
    { links: [{ link: "https://example.org" }] },
    { parent: " " },
    { parent: 4 },
    { position: 1 },
    { position: "" },
    { position: "01\n" },
    { position: "01\r" },
    { position: "abc" },
    { deleted: 1 },
    { hidden: "true" },
  ])("rejects malformed task fields: %j", (values) => fails(single(values), "INVALID_DATA"));

  it("rejects malformed lists, duplicate source identities and task records", () => {
    for (const lists of [
      [null],
      [list([], { id: "" })],
      [list([], { kind: "wrong" })],
      [list([], { title: "" })],
      [list([], { items: null })],
      [list([null])],
      [list([task(), task()])],
      [list(), list()],
    ])
      fails(takeout(lists), "INVALID_DATA");
    fails('{"kind":"tasks#taskLists","items":{}}', "INVALID_DATA");
    fails('{"kind":"tasks#tasks","items":null}', "INVALID_DATA");
    fails(42 as unknown as string, "INVALID_JSON");
  });

  it("ignores magic keys and inherited fields even with a polluted Object prototype", () => {
    const polluted =
      '{"kind":"tasks#taskLists","__proto__":{"items":[{"id":"injected"}]},"items":[{"id":"__proto__","title":"Safe","__proto__":{"title":"Unsafe"},"items":[{"id":"constructor","title":"Read","status":"needsAction","position":"01","__proto__":{"parent":"fake","priority":1}},{"id":"__proto__","title":"Child","status":"needsAction","position":"02","parent":"constructor"}]}]}';
    expect(
      parseGoogleTasksJson(polluted).projects[0]?.tasks.map((entry) => entry.parentId),
    ).toEqual([null, "task-0-0"]);
    const keys = [
      "root",
      "depth",
      "items",
      "parent",
      "due",
      "completed",
      "deleted",
      "hidden",
      "notes",
      "links",
      "singleListName",
      "kind",
      "status",
      "title",
      "position",
      "id",
    ];
    const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
    try {
      for (const key of keys)
        Object.defineProperty(Object.prototype, key, {
          value: "polluted",
          configurable: true,
          writable: true,
        });
      expect(parseGoogleTasksJson(single({ kind: undefined })).projects[0]?.tasks[0]).toMatchObject(
        { parentId: null, state: "open", description: "" },
      );
      expect(parseGoogleTasksJson('{"kind":"tasks#tasks"}').projects[0]?.name).toBe(
        "Imported tasks",
      );
      expect(parseGoogleTasksJson('{"kind":"tasks#taskLists"}').projects).toEqual([]);
      fails(single({ title: undefined }), "INVALID_DATA");
      fails(single({ status: undefined }), "INVALID_DATA");
      fails(single({ position: undefined }), "INVALID_DATA");
      fails(single({ id: undefined }), "INVALID_DATA");
    } finally {
      keys.forEach((key, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
        else Reflect.deleteProperty(Object.prototype, key);
      });
    }
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("caps UTF-8 bytes including BOM and handles multi-byte text at the boundary", () => {
    const base = single({ notes: "" });
    const fill = MAX_GOOGLE_TASKS_JSON_BYTES - base.length;
    const padded = single({ notes: "x".repeat(fill) });
    expect(parseGoogleTasksJson(padded).projects[0]?.tasks[0]?.description).toHaveLength(fill);
    fails(`${padded} `, "JSON_TOO_LARGE");
    fails(`\uFEFF${padded}`, "JSON_TOO_LARGE");
    for (const char of ["é", "漢", "😀"]) {
      const bytes = new TextEncoder().encode(char).length;
      const notes = char.repeat(Math.floor(fill / bytes));
      expect(parseGoogleTasksJson(single({ notes })).projects[0]?.tasks[0]?.description).toBe(
        notes,
      );
      fails(single({ notes: notes + char }), "JSON_TOO_LARGE");
    }
  });

  it("checks structural depth before parsing, ignoring braces and escapes in strings", () => {
    const json = (depth: number) =>
      `{"kind":"tasks#taskLists","extra":${"[".repeat(depth - 1)}0${"]".repeat(depth - 1)}}`;
    expect(parseGoogleTasksJson(json(MAX_GOOGLE_TASKS_JSON_DEPTH)).projects).toEqual([]);
    fails(json(MAX_GOOGLE_TASKS_JSON_DEPTH + 1), "JSON_TOO_DEEP");
    const notes = '{["\\'.repeat(100);
    expect(parseGoogleTasksJson(single({ notes })).projects[0]?.tasks[0]?.description).toBe(notes);
  });

  it("bounds list counts and counts all tasks across lists including deleted records", () => {
    const lists = Array.from({ length: MAX_GOOGLE_TASKS_LISTS }, (_, index) =>
      list([], { id: `list-${index}` }),
    );
    expect(parseGoogleTasksJson(takeout(lists)).projects).toHaveLength(MAX_GOOGLE_TASKS_LISTS);
    fails(takeout([...lists, list()]), "TOO_MANY_LISTS");
    const deleted = Array.from({ length: MAX_GOOGLE_TASKS_TASKS / 2 }, (_, index) => ({
      id: `${index}`,
      deleted: true,
    }));
    expect(
      parseGoogleTasksJson(takeout([list(deleted), list(deleted, { id: "other" })])).warnings,
    ).toHaveLength(MAX_GOOGLE_TASKS_TASKS);
    fails(takeout([list(deleted), list([...deleted, task()], { id: "other" })]), "TOO_MANY_TASKS");
  });

  it("handles a full-budget reversed hierarchy without recursive stack overflow", () => {
    const tasks = Array.from({ length: MAX_GOOGLE_TASKS_TASKS }, (_, index) =>
      task({
        id: `${index}`,
        ...(index === MAX_GOOGLE_TASKS_TASKS - 1 ? {} : { parent: `${index + 1}` }),
      }),
    );
    const result = parseGoogleTasksJson(takeout([list(tasks)]));
    expect(result.projects[0]?.tasks).toHaveLength(MAX_GOOGLE_TASKS_TASKS);
    expect(result.warnings).toHaveLength(MAX_GOOGLE_TASKS_TASKS - 2);
    expect(result.projects[0]?.tasks[0]?.parentId).toBeNull();
  });
});
