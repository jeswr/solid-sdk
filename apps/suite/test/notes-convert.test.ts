// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type ChecklistItem,
  docsToNotes,
  moveCheckedToBottom,
  NotesConversionError,
  type NotesConversionErrorCode,
  type NotesDocument,
  notesToDocs,
  reorderChecklistItems,
  toggleChecklistItem,
  uncheckAll,
} from "../src/apps/notes/lib/convert";

const p = { type: "paragraph" };
const t = { type: "text", text: "Café 👩🏽‍💻 e\u0301 <literal>  " };
const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const listItem = (...content: unknown[]) => ({ type: "listItem", content });
const taskItem = (checked: boolean, ...content: unknown[]) => ({
  type: "taskItem",
  attrs: { checked },
  content,
});
const taskList = (...content: unknown[]) => ({ type: "taskList", content });
const bulletList = (...content: unknown[]) => ({ type: "bulletList", content });

function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
function fails(code: NotesConversionErrorCode, run: () => unknown): void {
  expect(run).toThrow(NotesConversionError);
  expect(run).toThrow(expect.objectContaining({ name: "NotesConversionError", code }));
}

const rich = doc(
  paragraph(),
  { ...p, attrs: {} },
  paragraph(t, { ...t, marks: [] }),
  ...([1, 2, 3] as const).map((level) => ({
    type: "heading",
    attrs: { level },
    content: [
      {
        ...t,
        marks: [
          { type: "bold", attrs: {} },
          { type: "italic" },
          {
            type: "link",
            attrs: {
              href: "https://example.org/notes?q=Robin#plan",
              target: "_blank",
              rel: "noopener noreferrer",
              class: null,
              title: "Robin's plan",
            },
          },
        ],
      },
    ],
  })),
  { type: "heading", attrs: { level: 1 } },
  bulletList(
    { ...listItem(p), attrs: {} },
    listItem(
      paragraph(t),
      {
        type: "orderedList",
        attrs: { start: 7 },
        content: [listItem(p, taskList(taskItem(true, p), taskItem(false, paragraph(t))))],
      },
      p,
    ),
  ),
  { type: "orderedList", content: [listItem(p)] },
  { type: "orderedList", attrs: {}, content: [listItem(p)] },
  { type: "taskList", attrs: {}, content: [taskItem(false, p)] },
);

for (const convert of [notesToDocs, docsToNotes]) {
  describe(convert.name, () => {
    it("preserves all shared features, attrs, Unicode, mark order and empty blocks", () => {
      freeze(rich);
      const result = convert(rich);
      expect(result).toEqual(rich);
      expect(result).not.toBe(rich);
      expect(result.content[0]).not.toBe(rich.content[0]);
      const roundTrip = convert === notesToDocs ? docsToNotes(result) : notesToDocs(result);
      expect(roundTrip).toEqual(rich);
      // No nested result objects alias the source, even attrs, marks and their attrs.
      function detached(source: unknown, target: unknown): void {
        if (source !== null && typeof source === "object") {
          expect(target).not.toBe(source);
          for (const key of Object.keys(source)) {
            detached(
              (source as Record<string, unknown>)[key],
              (target as Record<string, unknown>)[key],
            );
          }
        }
      }
      detached(rich, result);
      expect(convert({ ...doc(p), attrs: {} })).toEqual({ ...doc(p), attrs: {} });
      expect(convert(Object.assign(Object.create(null), doc(p)))).toEqual(doc(p));
    });

    it.each([
      "https://example.org/path?x=1#part",
      "http://example.org/",
      "mailto:robin@example.org",
      "/docs/d/synthetic-ref",
    ])("preserves link destination %s without URL normalisation", (href) => {
      const value = doc(paragraph({ ...t, marks: [{ type: "link", attrs: { href } }] }));
      expect(convert(value)).toEqual(value);
    });

    it("preserves nullable link fields and optional text fields", () => {
      const attrs = {
        href: "https://example.org/",
        target: null,
        rel: null,
        class: "synthetic-link",
        title: null,
      };
      const value = doc(paragraph({ ...t, marks: [{ type: "link", attrs }] }));
      expect(convert(value)).toEqual(value);
    });

    it.each([
      "",
      "not a URL",
      "/",
      "//example.org/path",
      "javascript:alert(1)",
      "data:text/html,example",
      "ftp://example.org/",
      "mailto:",
      "https://example.org/white space",
      "https://example.org/\u0000",
      "https:\\example.org",
      "https://example.org/\ud800",
      7,
    ])("rejects unhandled or malformed link %j", (href) => {
      fails("invalid-input", () =>
        convert(doc(paragraph({ ...t, marks: [{ type: "link", attrs: { href } }] }))),
      );
    });

    it.each([
      "image",
      "table",
      "blockquote",
      "hardBreak",
      "codeBlock",
      "horizontalRule",
      "custom",
    ])("rejects unsupported node %s in both directions", (type) =>
      fails("unsupported-node", () => convert(doc({ type }))));
    it.each([
      "underline",
      "strike",
      "code",
      "textStyle",
      "highlight",
      "comment",
      "custom",
    ])("rejects unsupported mark %s", (type) =>
      fails("unsupported-mark", () => convert(doc(paragraph({ ...t, marks: [{ type }] })))));

    it.each([
      { ...doc(p), unknown: "private" },
      doc({ ...p, attrs: { textAlign: "center" } }),
      doc({ type: "heading", attrs: { level: 2, id: "private" } }),
      doc({ type: "orderedList", attrs: { type: "a" }, content: [listItem(p)] }),
      doc(taskList({ ...taskItem(false, p), attrs: { checked: false, id: "private" } })),
      doc(paragraph({ ...t, marks: [{ type: "bold", attrs: { color: "red" } }] })),
      doc(
        paragraph({
          ...t,
          marks: [{ type: "link", attrs: { href: "https://example.org", extra: 1 } }],
        }),
      ),
      doc({ ...p, [Symbol("private")]: true }),
    ])("rejects fields or attributes that would otherwise be discarded: %j", (value) => {
      fails("unsupported-attribute", () => convert(value));
    });

    it.each([
      doc(),
      p,
      doc(t),
      doc(listItem(p)),
      doc({ type: "doc", content: [p] }),
      doc(paragraph(p)),
      doc({ type: "bulletList", content: [] }),
      doc(bulletList(p)),
      doc(taskList(listItem(p))),
      doc(bulletList(taskItem(false, p))),
      doc(bulletList(listItem({ type: "heading", attrs: { level: 1 } }))),
      doc(taskList(taskItem(false, bulletList(listItem(p))))),
      doc({ ...p, text: "private" }),
      doc({ ...p, marks: [] }),
      doc(paragraph({ ...t, attrs: {} })),
      doc(paragraph({ ...t, content: [] })),
      doc(paragraph({ ...t, text: "" })),
      doc(paragraph({ ...t, marks: [{ type: "bold" }, { type: "bold" }] })),
    ])("rejects invalid ProseMirror structure: %j", (value) => {
      fails("invalid-structure", () => convert(value));
    });

    it.each([
      null,
      [],
      5,
      {},
      new Date(),
      { type: "doc" },
      { type: "doc", content: null },
      doc({ ...p, attrs: null }),
      doc({ ...p, content: undefined }),
      doc({ type: "heading" }),
      ...[0, 4, "1", 1.5, NaN].map((level) => doc({ type: "heading", attrs: { level } })),
      ...[0, -1, "2", 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].map((start) =>
        doc({ type: "orderedList", attrs: { start }, content: [listItem(p)] }),
      ),
      doc(taskList({ type: "taskItem", content: [p] })),
      doc(taskList({ type: "taskItem", attrs: { checked: "true" }, content: [p] })),
      doc(paragraph({ type: "text" })),
      doc(paragraph({ ...t, text: "\ud800" })),
      doc(paragraph({ ...t, marks: null })),
      doc(paragraph({ ...t, marks: [null] })),
      doc(paragraph({ ...t, marks: [{ type: "link" }] })),
      doc(paragraph({ ...t, marks: [{ type: "link", attrs: {} }] })),
      doc(
        paragraph({
          ...t,
          marks: [{ type: "link", attrs: { href: "https://example.org", target: 4 } }],
        }),
      ),
    ])("rejects malformed runtime JSON: %j", (value) => {
      const code =
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !("type" in value)
          ? "unsupported-node"
          : "invalid-input";
      fails(code, () => convert(value));
    });

    it("rejects sparse/custom arrays, accessors and hidden fields without invoking getters", () => {
      let accessed = false;
      const getter = () => {
        accessed = true;
        return [p];
      };
      const sparse = new Array(1);
      const custom = Object.assign([p], { metadata: 1 });
      const getterArray = [p];
      Object.defineProperty(getterArray, "0", { enumerable: true, get: getter });
      const hiddenArray = [p];
      Object.defineProperty(hiddenArray, "0", { enumerable: false });
      const inherited = [p];
      Object.setPrototypeOf(inherited, null);
      for (const value of [
        { type: "doc", content: sparse },
        { type: "doc", content: custom },
        { type: "doc", content: getterArray },
        { type: "doc", content: hiddenArray },
        { type: "doc", content: inherited },
        Object.defineProperty({ type: "doc" }, "content", { enumerable: true, get: getter }),
        Object.defineProperty(doc(p), "content", { enumerable: false }),
      ])
        fails("invalid-input", () => convert(value));
      expect(accessed).toBe(false);
    });

    it("bounds recursion and nested checklists with typed errors, including cyclic input", () => {
      let tasks: unknown = taskList(taskItem(false, p));
      for (let i = 0; i < 2; i += 1) tasks = taskList(taskItem(false, p, tasks));
      expect(convert(doc(tasks))).toEqual(doc(tasks));
      fails("limit-exceeded", () => convert(doc(taskList(taskItem(false, p, tasks)))));
      let nested: unknown = p;
      for (let i = 0; i < 35; i += 1) nested = bulletList(listItem(p, nested));
      fails("limit-exceeded", () => convert(doc(nested)));
      const cyclic = bulletList(listItem(p));
      cyclic.content = [listItem(p, cyclic)];
      fails("limit-exceeded", () => convert(doc(cyclic)));
    });

    it("does not echo private text or link values in typed errors", () => {
      try {
        convert(
          doc(paragraph({ ...t, marks: [{ type: "link", attrs: { href: "private value" } }] })),
        );
        expect.fail("must reject");
      } catch (error) {
        expect((error as Error).message).toBe("Notes conversion: invalid-input");
      }
    });
  });
}

// Compile-time contracts: both functions expose the shared JSON shape.
const valid: NotesDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Robin" }] }],
};
notesToDocs(valid);
docsToNotes(valid);

describe("checklist transforms", () => {
  const a = { text: "Apples", checked: false };
  const b = { text: "Bread", checked: true };
  const c = { text: "Tea", checked: true };
  const d = { text: "Pears", checked: false };
  const items = [a, b, c, d];
  freeze(items);

  it("toggles either flag, preserves text and other items, and composes reversibly", () => {
    expect(toggleChecklistItem(items, 0)).toEqual([{ ...a, checked: true }, b, c, d]);
    expect(toggleChecklistItem(items, 1)).toEqual([a, { ...b, checked: false }, c, d]);
    expect(toggleChecklistItem(toggleChecklistItem(items, 0), 0)).toEqual(items);
    expect(toggleChecklistItem(items, 0)[1]).toBe(b);
    expect(items).toEqual([a, b, c, d]);
  });

  it("reorders in both directions with final indices, including same-position moves", () => {
    expect(reorderChecklistItems(items, 0, 3)).toEqual([b, c, d, a]);
    expect(reorderChecklistItems(items, 3, 0)).toEqual([d, a, b, c]);
    expect(reorderChecklistItems(items, 1, 2)).toEqual([a, c, b, d]);
    expect(reorderChecklistItems(items, 2, 2)).toEqual(items);
    expect(reorderChecklistItems(items, 2, 2)).not.toBe(items);
    expect(reorderChecklistItems([a], 0, 0)).toEqual([a]);
  });

  it("partitions stably and preserves item references and duplicates", () => {
    expect(moveCheckedToBottom(items)).toEqual([a, d, b, c]);
    expect(moveCheckedToBottom([b, a, b, a])).toEqual([a, a, b, b]);
    expect(moveCheckedToBottom([b, c])).toEqual([b, c]);
    expect(moveCheckedToBottom([a, d])).toEqual([a, d]);
    expect(moveCheckedToBottom(items)[0]).toBe(a);
    expect(moveCheckedToBottom(moveCheckedToBottom(items))).toEqual(moveCheckedToBottom(items));
  });

  it("unchecks all idempotently, preserving text and array order", () => {
    const result = uncheckAll(items);
    expect(result).toEqual([a, { ...b, checked: false }, { ...c, checked: false }, d]);
    expect(result[0]).toBe(a);
    expect(uncheckAll(result)).toEqual(result);
    expect(uncheckAll([{ text: "", checked: true }])).toEqual([{ text: "", checked: false }]);
    expect(items).toEqual([a, b, c, d]);
  });

  it("handles empty bulk operations with fresh arrays", () => {
    const empty: ChecklistItem[] = [];
    expect(uncheckAll(empty)).toEqual([]);
    expect(uncheckAll(empty)).not.toBe(empty);
    expect(moveCheckedToBottom(empty)).toEqual([]);
    expect(moveCheckedToBottom(empty)).not.toBe(empty);
    fails("invalid-index", () => toggleChecklistItem(empty, 0));
    fails("invalid-index", () => reorderChecklistItems(empty, 0, 0));
  });

  it.each([
    -1,
    4,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
  ])("rejects invalid indices %j", (at) => {
    fails("invalid-index", () => toggleChecklistItem(items, at as number));
    fails("invalid-index", () => reorderChecklistItems(items, at as number, 0));
    fails("invalid-index", () => reorderChecklistItems(items, 0, at as number));
  });

  it.each([
    null,
    5,
    [null],
    [{}],
    [{ text: "A", checked: 1 }],
    [{ text: "\ud800", checked: false }],
    new Array(1),
  ])("validates the full collection for every operation: %j", (value) => {
    const invalid = value as unknown as ChecklistItem[];
    for (const run of [
      () => toggleChecklistItem(invalid, 0),
      () => reorderChecklistItems(invalid, 0, 0),
      () => moveCheckedToBottom(invalid),
      () => uncheckAll(invalid),
    ])
      fails("invalid-input", run);
  });

  it("rejects unknown checklist fields rather than dropping them", () => {
    const invalid = [{ text: "A", checked: false, id: "https://example.org/items/1" }];
    fails("unsupported-attribute", () => uncheckAll(invalid));
  });
});
