// @vitest-environment jsdom
// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { getSchema, type JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const schema = getSchema(baseExtensions(vi.fn()));
const zipLibrary = createRequire(import.meta.resolve("mammoth"))("jszip") as {
  loadAsync: (data: ArrayBuffer) => Promise<{
    files: Record<string, { async: (type: "string") => Promise<string> }>;
  }>;
};

it.each([
  "paragraph",
  "heading",
  "codeBlock",
  "taskList",
  "table",
])("round50 deleting a confidential %s in Word leaves no hidden copy in the DOCX", async (type) => {
  const secret = "Confidential acquisition: Project Heron";
  const paragraph: JSONContent = { type: "paragraph", content: [{ type: "text", text: secret }] };
  const block: JSONContent =
    type === "taskList"
      ? { type, content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph] }] }
      : type === "table"
        ? {
            type,
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph] }] }],
          }
        : { ...paragraph, type, ...(type === "heading" ? { attrs: { level: 2 } } : {}) };
  const original = schema
    .nodeFromJSON({
      type: "doc",
      content: [block, { ...paragraph, content: [{ type: "text", text: "Public text" }] }],
    })
    .toJSON();
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(await toDocx(original, vi.fn())),
  );
  const body = new DOMParser().parseFromString(
    await archive.read("word/document.xml", "utf-8"),
    "application/xml",
  );
  expect(body.documentElement.textContent).toContain(secret);
  // Model an external editor deleting paragraphs while preserving every other ZIP part.
  for (const paragraph of Array.from(
    body.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "p",
    ),
  ))
    if (paragraph.textContent?.includes(secret)) paragraph.remove();
  archive.write("word/document.xml", new XMLSerializer().serializeToString(body));
  expect(body.documentElement.textContent).not.toContain(secret);
  const saved = await archive.toArrayBuffer();
  const zip = await zipLibrary.loadAsync(saved);
  for (const [name, entry] of Object.entries(zip.files))
    if (/\.(xml|rels)$/.test(name)) expect(await entry.async("string"), name).not.toContain(secret);
  const imported = await importDocx(saved, { uploadImage: vi.fn(), progress: vi.fn() });
  expect(imported.html).toContain("Public text");
  expect(imported.html).not.toContain(secret);
});

it.each([
  "x",
  "X",
  " ",
])("round50 task marker [%s] accepts newline whitespace in every list container", (marker) => {
  for (const [prefix, continuation] of [
    ["- ", "  "],
    ["7. ", "   "],
    ["> - ", ">   "],
    ["- Parent\n\n  - ", "    "],
    ["- ", "\t"],
  ])
    for (const whitespace of ["\n", "\r\n"]) {
      const result = importMarkdown(
        `${prefix}[${marker}]${whitespace}${continuation}Completed step`,
        "tasks.md",
      );
      const tasks: JSONContent[] = [];
      schema.nodeFromJSON(result.json).descendants((node) => {
        if (node.type.name === "taskItem") tasks.push(node.toJSON());
      });
      expect(tasks, `${prefix}[${marker}]${JSON.stringify(whitespace)}`).toHaveLength(1);
      expect(tasks[0]?.attrs?.checked).toBe(marker !== " ");
      expect(schema.nodeFromJSON(tasks[0] as JSONContent).textContent).toBe(
        continuation === "\t" ? "  Completed step" : "Completed step",
      );
      expect(result.skipped).toEqual(
        whitespace === "\r\n"
          ? [{ label: "Carriage returns converted to line feeds", count: 1 }]
          : [],
      );
      expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
    }
});
