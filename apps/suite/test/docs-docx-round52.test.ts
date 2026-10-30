// @vitest-environment jsdom
// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const quote = (...content: JSONContent[]): JSONContent => ({ type: "blockquote", content });
const list = (type: string, ...content: JSONContent[]): JSONContent => ({
  type,
  content: [{ type: type === "taskList" ? "taskItem" : "listItem", content }],
});
const table = (...content: JSONContent[]): JSONContent => ({
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableCell", content }] }],
});
const image: JSONContent = {
  type: "image",
  attrs: { src: "https://pod.test/chart.png", alt: "Chart" },
};
const readImage = async () => ({
  data: Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  ),
  width: 1,
  height: 1,
  type: "png" as const,
});

async function roundTrip(original: JSONContent, unavailable = false) {
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(
      await toDocx(
        original,
        unavailable
          ? async () => {
              throw new Error("offline");
            }
          : readImage,
      ),
    ),
  );
  const xml = await archive.read("word/document.xml", "utf-8");
  // Exercise native Word content after an external edit, without a JSON payload.
  archive.write("word/document.xml", xml.replace("Final", "Edited"));
  const imported = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: async () => "https://pod.test/chart.png",
    progress: vi.fn(),
  });
  return { json: importHtml(imported.html).json, xml };
}

it("round52 nested Markdown quotations keep attribution and distinct native Word indentation", async () => {
  const original = importMarkdown(
    "> Alice said:\n> > Bob said yes.\n> > > Carol agreed.\n>\n> Alice continued.\n\nFinal",
    "quotes.md",
  ).json;
  const { json, xml } = await roundTrip(original);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(document.getElementsByTagNameNS(word, "p"));
  expect(
    paragraphs
      .slice(0, 4)
      .map((paragraph) =>
        paragraph.getElementsByTagNameNS(word, "ind")[0]?.getAttributeNS(word, "left"),
      ),
  ).toEqual(["720", "1440", "2160", "720"]);
  expect(json).toEqual(
    importMarkdown(
      "> Alice said:\n> > Bob said yes.\n> > > Carol agreed.\n>\n> Alice continued.\n\nEdited",
      "quotes.md",
    ).json,
  );
});

it.each([
  p("Paragraph"),
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
  { type: "codeBlock", content: [{ type: "text", text: "code\tline\nnext" }] },
  { type: "horizontalRule" },
  image,
  table(p("Cell"), quote(p("Cell quote"))),
  table(p("Cell"), quote(p("Cell quote")), table(quote(p("Nested cell quote"))), {
    type: "paragraph",
  }),
])("round52 nested quotes retain $type blocks and sibling quote boundaries", async (block) => {
  const original = normaliseImport({
    type: "doc",
    content: [quote(p("Outer"), quote(block), quote(p("Sibling")), p("Outer again")), p("Final")],
  }).json;
  const { json } = await roundTrip(original);
  expect(json).toEqual(
    normaliseImport({
      ...original,
      content: [...(original.content ?? []).slice(0, -1), p("Edited")],
    }).json,
  );
});

it("round52 repeated tables retain the same surrounding quotation and independent cell scopes", async () => {
  const original = normaliseImport({
    type: "doc",
    content: [quote(table(quote(p("First cell quote"))), table(p("Second cell"))), p("Final")],
  }).json;
  const { json } = await roundTrip(original);
  expect(json).toEqual(
    normaliseImport({
      ...original,
      content: [...(original.content ?? []).slice(0, -1), p("Edited")],
    }).json,
  );
});

it.each([
  "bulletList",
  "orderedList",
  "taskList",
])("round52 quote depth composes with %s ancestry in both directions", async (type) => {
  const original = normaliseImport({
    type: "doc",
    content: [
      quote(
        p("Outer"),
        list(type, p("Item"), quote(p("Nested"), quote(p("Deep"))), p("Continuation")),
        p("Outer again"),
      ),
      list(
        type,
        p("First"),
        quote(p("Quoted"), quote(p("Nested")), list(type, p("Quoted list"))),
        p("After"),
      ),
      p("Final"),
    ],
  }).json;
  const { json } = await roundTrip(original);
  expect(json).toEqual(
    normaliseImport({
      ...original,
      content: [...(original.content ?? []).slice(0, -1), p("Edited")],
    }).json,
  );
});

it("round52 wrapper and unavailable-image paragraphs inherit the full quotation depth", async () => {
  const original = {
    type: "doc",
    content: [quote(p("Outer"), quote({ type: "wrapper", content: [image] })), p("Final")],
  };
  const { json } = await roundTrip(original, true);
  expect(json).toEqual(
    normaliseImport({
      type: "doc",
      content: [quote(p("Outer"), quote(p("[Image unavailable: Chart]"))), p("Edited")],
    }).json,
  );
});
