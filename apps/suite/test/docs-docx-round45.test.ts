// @vitest-environment jsdom
// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { embeddedDocument } from "../src/apps/docs/lib/convert/docx-payload";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const p = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const image: JSONContent = {
  type: "image",
  attrs: { src: "https://pod.test/map.png", alt: "Map" },
};
const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
function list(type: string, ...blocks: JSONContent[]): JSONContent {
  return {
    type,
    ...(type === "orderedList" ? { attrs: { start: 7 } } : {}),
    content: [
      { type: type === "taskList" ? "taskItem" : "listItem", content: blocks },
      { type: type === "taskList" ? "taskItem" : "listItem", content: [p("Sibling")] },
    ],
  };
}
async function editedRoundTrip(
  original: JSONContent,
  unavailable = false,
  edit = (xml: string) => xml,
) {
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(
      await toDocx(original, async () => {
        if (unavailable) throw new Error("offline image");
        return { data: pixel, width: 1, height: 1, type: "png" };
      }),
    ),
  );
  const xml = await archive.read("word/document.xml", "utf-8");
  archive.write("word/document.xml", edit(xml.replace("Final", "Edited")));
  expect(await embeddedDocument(archive)).toBeUndefined();
  const imported = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: async () => "https://pod.test/map.png",
    progress: vi.fn(),
  });
  return { json: importHtml(imported.html).json, xml };
}

it.each([
  "bulletList",
  "orderedList",
  "taskList",
])("round45 standalone quotes end preceding %s lists after a Word edit", async (type) => {
  const original = normaliseImport({
    type: "doc",
    content: [list(type, p("First")), { type: "blockquote", content: [p("Quote")] }, p("Final")],
  }).json;
  const { json } = await editedRoundTrip(original);
  expect(json).toEqual({
    ...original,
    content: [
      ...(original.content ?? []).slice(0, -1),
      normaliseImport({ type: "doc", content: [p("Edited")] }).json.content?.[0],
    ],
  });
});

it.each([
  "bulletList",
  "orderedList",
  "taskList",
])("round45 every paragraph-producing block keeps its %s item context after a Word edit", async (type) => {
  for (const block of [
    image,
    { type: "horizontalRule" },
    { type: "codeBlock", content: [{ type: "text", text: "code" }] },
    { type: "blockquote", content: [p("Quoted continuation")] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
  ]) {
    for (const nested of [false, true]) {
      const original = normaliseImport({
        type: "doc",
        content: [
          list(
            type,
            p("First"),
            ...(nested
              ? [list(type, p("Nested"), block, p("Continuation"))]
              : [block, p("Continuation")]),
          ),
          p("Final"),
        ],
      }).json;
      const { json } = await editedRoundTrip(original);
      const expected = {
        ...original,
        content: [
          ...(original.content ?? []).slice(0, -1),
          normaliseImport({ type: "doc", content: [p("Edited")] }).json.content?.[0],
        ],
      };
      expect(json, `${block.type}, nested ${nested}`).toEqual(expected);
    }
  }
});

it.each([
  "bulletList",
  "orderedList",
  "taskList",
])("round45 unavailable images retain %s continuation context", async (type) => {
  const original = normaliseImport({
    type: "doc",
    content: [list(type, p("First"), image, p("Continuation")), p("Final")],
  }).json;
  const { json } = await editedRoundTrip(original, true);
  const expected = normaliseImport({
    type: "doc",
    content: [
      list(type, p("First"), p("[Image unavailable: Map]"), p("Continuation")),
      p("Edited"),
    ],
  }).json;
  expect(json).toEqual(expected);
});

it("round45 detached continuation styles retain their block type when Word removes the preceding list", async () => {
  for (const block of [
    { type: "blockquote", content: [p("Quote")] },
    { type: "codeBlock", content: [{ type: "text", text: "code\tindented\nnext" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
    { type: "horizontalRule" },
  ]) {
    const original = normaliseImport({
      type: "doc",
      content: [list("bulletList", p("First"), block), p("Final")],
    }).json;
    const { json } = await editedRoundTrip(original, false, (source) => {
      const xml = new DOMParser().parseFromString(source, "application/xml");
      const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      for (const paragraph of Array.from(xml.getElementsByTagNameNS(word, "p")))
        if (["First", "Sibling"].includes(paragraph.textContent ?? "")) paragraph.remove();
      return new XMLSerializer().serializeToString(xml);
    });
    expect(json, block.type).toEqual(
      normaliseImport({ type: "doc", content: [block, p("Edited")] }).json,
    );
  }
});
