// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { markdownWhitespace } from "./helpers/docs-markdown-text";

const schema = getSchema(baseExtensions(vi.fn()));
const paragraph = (text: string, code = false): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(code ? { marks: [{ type: "code" }] } : {}) }],
});
const containers = ["bullet", "ordered", "task", "tabbed", "quote"] as const;
type Container = (typeof containers)[number];

// These fixtures are hand-written Markdown, independent of Suite's exporter.
function handwritten(text: string, kind: "span" | "fenced" | "indented", path: Container[]) {
  let source =
    kind === "span"
      ? `\`${text.startsWith(" ") && text.endsWith(" ") ? ` ${text} ` : text}\``
      : kind === "fenced"
        ? `Example\n\n~~~sh\n${text}\n~~~`
        : `Example\n\n${text
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n")}`;
  let content: JSONContent[] =
    kind === "span"
      ? [paragraph(text, true)]
      : [
          paragraph("Example"),
          {
            type: "codeBlock",
            ...(kind === "fenced" ? { attrs: { language: "sh" } } : {}),
            content: [{ type: "text", text }],
          },
        ];
  let column = 0;
  const widths = path.map((container) => {
    const width =
      container === "tabbed" ? 1 + 4 - ((column + 1) % 4) : container === "ordered" ? 4 : 2;
    column += width;
    return width;
  });
  for (const [index, container] of path.entries().toArray().toReversed()) {
    if (container === "quote") {
      source = source
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      content = [{ type: "blockquote", content }];
    } else {
      const marker =
        container === "ordered"
          ? "12. "
          : container === "task"
            ? "- [x] "
            : container === "tabbed"
              ? "-\t"
              : "- ";
      const indent = " ".repeat(widths[index] as number);
      source = `${marker}Container\n${indent}\n${source
        .split("\n")
        .map((line) => indent + line)
        .join("\n")}`;
      content = [
        {
          type:
            container === "ordered"
              ? "orderedList"
              : container === "task"
                ? "taskList"
                : "bulletList",
          ...(container === "ordered" ? { attrs: { start: 12 } } : {}),
          content: [
            {
              type: container === "task" ? "taskItem" : "listItem",
              ...(container === "task" ? { attrs: { checked: true } } : {}),
              content: [paragraph("Container"), ...content],
            },
          ],
        },
      ];
    }
  }
  return { source, expected: schema.nodeFromJSON({ type: "doc", content }).toJSON() };
}

it("round26 directly imports the literal tab command and preserves it after snapshot reopen", () => {
  const text = "cut -d '\t' -f2 data.tsv";
  const imported = importMarkdown(`- \`${text}\``, "commands.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject(
    paragraph(text, true),
  );
  const doc = new Doc();
  const reopenedDoc = new Doc();
  const editor = new Editor({ extensions: editorExtensions(doc, vi.fn()) });
  const reopened = new Editor({ extensions: editorExtensions(reopenedDoc, vi.fn()) });
  try {
    editor.commands.setContent(imported.json);
    applyUpdate(reopenedDoc, encodeStateAsUpdate(doc));
    expect(reopened.getJSON()).toEqual(editor.getJSON());
    expect(reopened.getText()).toContain(text);
  } finally {
    editor.destroy();
    reopened.destroy();
    doc.destroy();
    reopenedDoc.destroy();
  }
});

it.each([
  "span",
  "fenced",
  "indented",
] as const)("directly imports generated whitespace in %s code at every container depth", (kind) => {
  fc.assert(
    fc.property(
      markdownWhitespace.filter((space) => !/[\r\n]/.test(space)),
      fc.array(fc.constantFrom(...containers), { minLength: 1, maxLength: 8 }),
      (space, path) => {
        // Check every prefix, including the uncontained document, so each run
        // covers all nesting depths rather than only its deepest leaf.
        for (let depth = 0; depth <= path.length; depth++) {
          const line = `${space}cut -d '${space}>' -f2 data.tsv${space}`;
          const text = kind === "span" ? line : `${line}\n${space}\n\t${space}> finish${space}`;
          const { source, expected } = handwritten(text, kind, path.slice(0, depth));
          const imported = importMarkdown(source, "handwritten.md");
          expect(imported.skipped).toEqual([]);
          expect(imported.json).toEqual(expected);
        }
      },
    ),
    { seed: 2607, numRuns: 150 },
  );
});

it("keeps the unused columns of structural tabs before quoted indented code", () => {
  const text = "cut -d '\t' -f2 data.tsv\t";
  const imported = importMarkdown(`>\t\t${text}`, "quote.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text: `  ${text}` }],
  });
});

it("recognizes tab-indented fences at the original list content column", () => {
  const text = "\tcut -d '\t' -f2 data.tsv\u2028>\t";
  const imported = importMarkdown(`- Example\n\n  \t~~~sh\n  \t${text}\n  \t~~~`, "fences.md");
  expect(imported.skipped).toEqual([]);
  expect(
    imported.json.content?.[0]?.content?.[0]?.content?.[1],
    JSON.stringify(imported.json),
  ).toMatchObject({
    type: "codeBlock",
    attrs: { language: "sh" },
    content: [{ type: "text", text }],
  });
});

it("recognizes tab-indented quotes at the original list content column", () => {
  const text = "cut -d '\t' -f2 data.tsv";
  const imported = importMarkdown(`- Example\n\n  \t> \`${text}\``, "quotes.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.content?.[0]?.content?.[1]).toMatchObject({
    type: "blockquote",
    content: [paragraph(text, true)],
  });
});

it("preserves code whitespace with indented fences and shorter content indentation", () => {
  const text = "\u2028> cut -d '\t' -f2 data.tsv\t";
  const imported = importMarkdown(`  ~~~sh\n${text}\n  ~~~`, "short-indent.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text }],
  });
});

it("uses one column of list padding before first-line indented code", () => {
  const text = "cut -d '\t' -f2 data.tsv\u00a0";
  const imported = importMarkdown(`-     ${text}`, "first-line-code.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.content?.[0]?.content?.[1]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text }],
  });
});

it("preserves code in bare quotes and quote-like text in lazy continuations", () => {
  const text = "cut -d '\t' -f2 data.tsv";
  const imported = importMarkdown(`>\`${text}\`\n    > \`${text}\``, "lazy.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]).toMatchObject({
    type: "blockquote",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text, marks: [{ type: "code" }] },
          { type: "text", text: "\n    > " },
          { type: "text", text, marks: [{ type: "code" }] },
        ],
      },
    ],
  });
});

it("retains container boundaries for thematic breaks and unfinished fences", () => {
  expect(importMarkdown("- - -", "rule.md").json.content?.[0]?.type).toBe("horizontalRule");
  expect(importMarkdown("~~~", "empty.md").json.content?.[0]?.type).toBe("codeBlock");
  const text = "cut -d '\t' -f2 data.tsv\t";
  const imported = importMarkdown(`~~~\n${text}\n`, "unfinished.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]).toMatchObject({
    type: "codeBlock",
    content: [{ type: "text", text }],
  });
});

it.each([
  {
    source: "> - `first\n>   second`",
    label: "Code span line breaks converted to spaces",
    text: "first second",
  },
  {
    source: "- Example\r\n\r\n  ~~~\r\n  first\r  second\r\n  ~~~",
    label: "Carriage returns converted to line feeds",
    text: "first\nsecond",
  },
])("reports required CommonMark content normalization: $label", ({ source, label, text }) => {
  const imported = importMarkdown(source, "normalized.md");
  expect(imported.skipped).toContainEqual({ label, count: 1 });
  expect(JSON.stringify(imported.json)).toContain(JSON.stringify(text));
  expect(importMarkdown("`unchanged\t`", "unchanged.md").skipped).toEqual([]);
});

it.each([
  "span",
  "fenced",
  "indented",
] as const)("preserves %s code through 24 mixed container levels", (kind) => {
  const path: Container[] = Array.from({ length: 24 }, (_, index) =>
    index % 2 ? "quote" : "bullet",
  );
  const fixture = handwritten("\tcut -d '\u2028>\t' -f2 data.tsv\u00a0", kind, path);
  const imported = importMarkdown(fixture.source, "deep.md");
  expect(imported.skipped).toEqual([]);
  expect(imported.json).toEqual(fixture.expected);
});

it.each([
  "span",
  "fenced",
  "indented",
] as const)("preserves %s code in tab-indented list items and mixed quote containers", (kind) => {
  const text = "cut -d '\t' -f2 data.tsv\t";
  for (const path of [[], ["quote"], ["quote", "quote"]] satisfies Container[][]) {
    const fixture = handwritten(text, kind, ["bullet"]);
    // At the root of the parent item a tab supplies the four columns used by
    // its child. Content tabs are deliberately left untouched.
    const indent = path.length % 2 ? "\t  " : "\t";
    let source = `-   Parent\n\n${fixture.source
      .split("\n")
      .map((line) => indent + line)
      .join("\n")}`;
    for (const _container of path)
      source = source
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    const imported = importMarkdown(source, "tabs.md");
    expect(imported.skipped).toEqual([]);
    let content: JSONContent[] = [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph("Parent"), ...(fixture.expected.content as JSONContent[])],
          },
        ],
      },
    ];
    for (const _container of path) content = [{ type: "blockquote", content }];
    expect(imported.json).toEqual(schema.nodeFromJSON({ type: "doc", content }).toJSON());
  }
});
