// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { getSchema, type JSONContent } from "@tiptap/react";
import { Document, Packer, Paragraph } from "docx";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, importPlainText, normaliseImport } from "../src/apps/docs/lib/convert/schema";
import { wordCount } from "../src/apps/docs/lib/editor/logic";
import type { PodSession } from "../src/lib/session/pod-session";

const session = { fetch: vi.fn() } as unknown as PodSession;
const schema = getSchema(baseExtensions(session.fetch));
const text = (text: string): JSONContent => ({ type: "text", text });
const p = (value: string): JSONContent => ({ type: "paragraph", content: [text(value)] });
const word = fc.constantFrom("First item", "Second item", "punctuation <>& []", "😀");
const listKinds = ["bulletList", "orderedList", "taskList"] as const;
const codeWhitespace = fc
  .tuple(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 1, max: 3 }))
  .map(([spaces, tabs]) => `printf 'a${" ".repeat(spaces)}b'${"\t".repeat(tabs)}done`);
async function roundTrip(original: JSONContent) {
  const data = await Packer.toArrayBuffer(
    await toDocx(original, async () => ({
      data: new Uint8Array([1]),
      type: "png",
      width: 1,
      height: 1,
    })),
  );
  return convertImport(
    new NodeFile([data], "roundtrip.docx") as unknown as File,
    session,
    async () => "https://pod.test/image.png",
    vi.fn(),
  );
}

it("DOCX round trips generated documents covering every editor node and mark type, code whitespace and three-level mixed lists", async () => {
  const visitedNodes = new Set<string>();
  const visitedMarks = new Set<string>();
  const visitedListLevels = new Set<string>();
  await fc.assert(
    fc.asyncProperty(
      word,
      fc.integer({ min: 1, max: 3 }),
      fc.boolean(),
      fc.integer({ min: 1, max: 8 }),
      codeWhitespace,
      fc.integer({ min: 1, max: 3 }),
      fc.array(fc.constantFrom(...listKinds), { minLength: 2, maxLength: 2 }),
      async (value, level, checked, indent, code, depth, nestedKinds) => {
        const list = (type: string, remaining: number): JSONContent => {
          visitedListLevels.add(`${type}:${depth - remaining + 1}`);
          return {
            type,
            content: [true, false].map((first) => ({
              type: type === "taskList" ? "taskItem" : "listItem",
              ...(type === "taskList" ? { attrs: { checked: first && checked } } : {}),
              content: [
                p(`${value} ${first ? "Parent" : "Sibling"} ${remaining}`),
                ...(first && remaining > 1
                  ? [list(nestedKinds[remaining - 2] as string, remaining - 1)]
                  : []),
              ],
            })),
          };
        };
        const original = schema.nodeFromJSON({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: Object.keys(schema.marks).flatMap((type) => [
                {
                  ...text(type === "code" ? code : value),
                  marks: [
                    {
                      type,
                      ...(type === "link" ? { attrs: { href: "https://example.org/" } } : {}),
                    },
                  ],
                },
                { type: "hardBreak" },
              ]),
            },
            { type: "paragraph" },
            { type: "heading", attrs: { level }, content: [text(value)] },
            { type: "blockquote", content: [p(value)] },
            ...listKinds.map((type) => list(type, depth)),
            { type: "horizontalRule" },
            {
              type: "codeBlock",
              content: [text(`if ready:\n${" ".repeat(indent)}launch()\n\tfinish()`)],
            },
            { type: "image", attrs: { src: "https://pod.test/image.png", alt: "Photo" } },
            {
              type: "table",
              content: [
                { type: "tableRow", content: [{ type: "tableHeader", content: [p(value)] }] },
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      content: [
                        {
                          type: "bulletList",
                          content: [{ type: "listItem", content: [p(value)] }],
                        },
                        p(value),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });
        original.check();
        original.descendants((node) => {
          visitedNodes.add(node.type.name);
          for (const mark of node.marks) visitedMarks.add(mark.type.name);
        });
        visitedNodes.add("doc");
        const imported = await roundTrip(original.toJSON());
        expect(imported.json).toEqual(original.toJSON());
        expect(imported.skipped).toEqual([]);
      },
    ),
    { seed: 2107, numRuns: 40 },
  );
  expect([...visitedNodes].sort()).toEqual(Object.keys(schema.nodes).sort());
  expect([...visitedMarks].sort()).toEqual(Object.keys(schema.marks).sort());
  expect([...visitedListLevels].sort()).toEqual(
    listKinds.flatMap((type) => [1, 2, 3].map((level) => `${type}:${level}`)).sort(),
  );
});

it.each([
  "p",
  "h1",
  "h2",
  "h3",
])("preserves code whitespace at %s boundaries while ordinary HTML still collapses spaces", (tag) => {
  const source = `<${tag}><code>  printf\t'a  b'\t\t  </code></${tag}><p>  ordinary   prose  </p>`;
  const imported = importHtml(source);
  const [code, prose] = imported.json.content ?? [];
  expect(code?.content?.[0]).toEqual({
    type: "text",
    text: "  printf\t'a  b'\t\t  ",
    marks: [{ type: "code" }],
  });
  expect(prose?.content?.[0]?.text).toBe("ordinary prose");
  expect(imported.skipped).toEqual([]);
});

it("all importers return schema-valid documents for random input", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ maxLength: 80 }),
      fc.integer({ min: 1, max: 6 }),
      async (value, level) => {
        const sources = [
          importMarkdown(`${"#".repeat(level)} Detail\n\n${value}`, "random.md"),
          importMarkdown(value, "random.md"),
          importHtml(`<h${level}>Detail</h${level}><p>${value}</p>`),
          importPlainText(value),
          await roundTrip({ type: "doc", content: [p(value || "Empty")] }),
        ];
        for (const { json } of sources) {
          schema.nodeFromJSON(json).check();
          expect(() => wordCount(json)).not.toThrow();
        }
      },
    ),
    { seed: 2121, numRuns: 100 },
  );
});

it("normalises heading metadata and reports dropped nodes, marks, attributes and invalid content", () => {
  const result = normaliseImport({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 99, textAlign: "sideways", unknown: true },
        content: [text("Detail")],
      },
      { type: "heading", attrs: { level: "bad" }, content: [text("First")] },
      { type: "heading", attrs: { level: 0 }, content: [text("First")] },
      { type: "futureNode" },
      { type: "futureNode" },
      { type: "paragraph", content: [{ ...text("Keep"), marks: [{ type: "futureMark" }] }] },
      { type: "text", text: "" },
    ],
  });
  expect(result.json.content?.map((node) => node.attrs?.level)).toEqual([3, 1, 1, undefined]);
  expect(result.skipped).toEqual([
    { label: "Unsupported attributes", count: 1 },
    { label: "Unsupported alignment", count: 1 },
    { label: "Unsupported nodes", count: 2 },
    { label: "Unsupported marks", count: 1 },
    { label: "Invalid content", count: 1 },
  ]);
  expect(normaliseImport({ type: "unknown" }).json.content?.[0]?.type).toBe("paragraph");
  expect(normaliseImport(p("No root")).json.content?.[0]?.type).toBe("paragraph");
});

it("reports skipped HTML and unsafe attributes while retaining high headings and safe content", () => {
  const result = importHtml(
    '<h6>Detail</h6><div><p onclick="evil()">Keep <a href="javascript:evil()">link</a></p></div><script>evil()</script><img src="mailto:bad@example.org"><p><img src="https://pod.test/image.png">caption</p>',
  );
  expect(result.json.content?.[0]?.attrs?.level).toBe(3);
  expect(result.skipped).toEqual([
    { label: "Unsupported HTML", count: 2 },
    { label: "Unsupported attributes", count: 1 },
    { label: "Unsafe URLs", count: 2 },
  ]);
  expect(JSON.stringify(result.json)).toContain("caption");
  const markdown = importMarkdown(
    "<script>evil()</script>\n\n[link](javascript:evil())\n\n![unsafe](mailto:bad@example.org)",
    "skipped.md",
  );
  expect(markdown.skipped).toEqual([
    { label: "Unsupported HTML", count: 1 },
    { label: "Unsupported marks", count: 1 },
    { label: "Unsafe images", count: 1 },
  ]);
});

it("reports unrecognised DOCX formatting instead of silently dropping it", async () => {
  const source = new Document({
    styles: { paragraphStyles: [{ id: "Unknown", name: "Unsupported style" }] },
    sections: [{ children: [new Paragraph({ text: "Keep", style: "Unknown" })] }],
  });
  const result = await importDocx(await Packer.toArrayBuffer(source), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(result.html).toBe("<p>Keep</p>");
  expect(result.skipped).toEqual([{ label: "Unsupported DOCX formatting", count: 1 }]);
});
