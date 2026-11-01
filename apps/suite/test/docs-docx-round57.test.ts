// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const formats = [
  ["a", "lowerLetter"],
  ["A", "upperLetter"],
  ["i", "lowerRoman"],
  ["I", "upperRoman"],
] as const;

async function exported(json: JSONContent) {
  return openArrayBuffer(await Packer.toArrayBuffer(await toDocx(json, vi.fn())));
}

async function reimport(archive: Awaited<ReturnType<typeof exported>>) {
  const result = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  return importHtml(result.html).json;
}

afterEach(() => vi.unstubAllGlobals());

it.each(
  formats,
)("round57 native Word %s numbering survives import sanitization", async (type, format) => {
  const archive = await exported({
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Prepare" }] }],
          },
        ],
      },
    ],
  });
  archive.write(
    "word/numbering.xml",
    (await archive.read("word/numbering.xml", "utf-8")).replaceAll(
      '<w:numFmt w:val="decimal"/>',
      `<w:numFmt w:val="${format}"/>`,
    ),
  );
  expect((await reimport(archive)).content?.[0]?.attrs).toMatchObject({ start: 3, type });
});

it.each(
  formats,
)("round57 DOCX preserves pasted %s clause labels and their start on round trip", async (type, format) => {
  vi.stubGlobal("ClipboardEvent", Event);
  const editor = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p></p>",
  });
  try {
    editor.view.pasteHTML(`<ol type="${type}" start="3"><li>Prepare</li><li>Review</li></ol>`);
    const original = editor.getJSON();
    expect(original.content?.[0]?.attrs).toMatchObject({ start: 3, type });
    const archive = await exported(original);
    expect(await archive.read("word/numbering.xml", "utf-8")).toContain(
      `<w:numFmt w:val="${format}"/>`,
    );
    expect(await reimport(archive)).toEqual(original);
  } finally {
    editor.destroy();
  }
});

it("round57 DOCX preserves independent mixed list formats in nested lists, quotes and cells", async () => {
  const lists: JSONContent[] = formats.map(([type], index) => ({
    type: "orderedList",
    attrs: { type, start: index + 3 },
    content: [
      {
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: `Clause ${type}` }] }],
      },
    ],
  }));
  lists[0]?.content?.[0]?.content?.push(lists[1] as JSONContent);
  const original = normaliseImport({
    type: "doc",
    content: [
      lists[0] as JSONContent,
      { type: "blockquote", content: [lists[2] as JSONContent] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [lists[3] as JSONContent] }],
          },
        ],
      },
    ],
  }).json;
  expect(await reimport(await exported(original))).toEqual(original);
});

it.each([
  undefined,
  null,
  "1",
  "unsupported",
])("round57 DOCX uses decimal numbering for list type %s", async (type) => {
  const original: JSONContent = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3, ...(type === undefined ? {} : { type }) },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Prepare" }] }],
          },
        ],
      },
    ],
  };
  const archive = await exported(original);
  expect(await archive.read("word/numbering.xml", "utf-8")).toContain(
    '<w:numFmt w:val="decimal"/>',
  );
  expect((await reimport(archive)).content?.[0]?.attrs).toMatchObject({ start: 3, type: null });
});
