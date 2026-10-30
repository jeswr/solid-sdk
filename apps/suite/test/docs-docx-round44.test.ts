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

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
function checklist(checked: boolean) {
  const item = (label: string | JSONContent, ...rest: JSONContent[]): JSONContent => ({
    type: "taskItem",
    attrs: { checked },
    content: [typeof label === "string" ? paragraph(label) : label, ...rest],
  });
  return normaliseImport({
    type: "doc",
    content: [
      {
        type: "taskList",
        content: [
          item(
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Parent ☑ literal ☐" },
                { type: "hardBreak" },
                { type: "text", text: "Second line" },
              ],
            },
            paragraph("Continuation ☑ literal ☐"),
            { type: "taskList", content: [item("Nested task")] },
          ),
          item("Sibling task"),
        ],
      },
      paragraph("Outside ☑ literal ☐"),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "taskList", content: [item("Table task")] }],
              },
            ],
          },
        ],
      },
    ],
  }).json;
}
async function exported(checked: boolean) {
  return openArrayBuffer(await Packer.toArrayBuffer(await toDocx(checklist(checked), vi.fn())));
}
async function imported(archive: Awaited<ReturnType<typeof exported>>) {
  const result = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(result.skipped).toEqual([
    { label: "Some formatting may differ from the original", count: 1 },
  ]);
  return importHtml(result.html).json;
}

it.each([
  true,
  false,
])("round44 imports edited task markers in every container (original checked: %s)", async (checked) => {
  for (const runs of ["styled", "unstyled", "split", "merged"]) {
    const archive = await exported(checked);
    const xml = new DOMParser().parseFromString(
      await archive.read("word/document.xml", "utf-8"),
      "application/xml",
    );
    const markers = Array.from(xml.getElementsByTagNameNS(WORD, "rStyle")).filter(
      (style) => style.getAttributeNS(WORD, "val") === "TaskMarker",
    );
    expect(markers).toHaveLength(4);
    for (const style of markers) {
      const run = style.parentElement?.parentElement as Element;
      const text = run.getElementsByTagNameNS(WORD, "t")[0] as Element;
      text.textContent = checked ? "☐ " : "☑ ";
      if (runs === "unstyled") style.remove();
      if (runs === "split") {
        const separator = run.cloneNode(true) as Element;
        (separator.getElementsByTagNameNS(WORD, "t")[0] as Element).textContent = " ";
        text.textContent = checked ? "☐" : "☑";
        run.after(separator);
      }
      if (runs === "merged") {
        const label = run.nextElementSibling as Element;
        text.textContent += label.textContent;
        label.remove();
      }
    }
    // The old paragraph styles and embedded snapshot deliberately remain unchanged.
    expect(
      Array.from(xml.getElementsByTagNameNS(WORD, "pStyle"))
        .map((style) => style.getAttributeNS(WORD, "val"))
        .filter((style) => style === (checked ? "TaskChecked" : "TaskUnchecked")),
    ).toHaveLength(4);
    archive.write("word/document.xml", new XMLSerializer().serializeToString(xml));
    expect(await embeddedDocument(archive)).toBeUndefined();
    expect(await imported(archive), runs).toEqual(checklist(!checked));
  }
});

it.each([
  true,
  false,
])("round44 retains style-only task states when visible markers are absent (checked: %s)", async (checked) => {
  const archive = await exported(checked);
  const xml = new DOMParser().parseFromString(
    await archive.read("word/document.xml", "utf-8"),
    "application/xml",
  );
  for (const style of Array.from(xml.getElementsByTagNameNS(WORD, "rStyle"))) {
    if (style.getAttributeNS(WORD, "val") === "TaskMarker")
      style.parentElement?.parentElement?.remove();
  }
  archive.write("word/document.xml", new XMLSerializer().serializeToString(xml));
  expect(await imported(archive)).toEqual(checklist(checked));
});
