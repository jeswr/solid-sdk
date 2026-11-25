// @vitest-environment jsdom
// AUTHORED-BY Claude Sonnet 5.5
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { exportMarkdown } from "../src/apps/docs/lib/convert/markdown";

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

async function documentXml(json: JSONContent): Promise<string> {
  const archive = await openArrayBuffer(await Packer.toArrayBuffer(await toDocx(json, vi.fn())));
  return String(await archive.read("word/document.xml", "utf8"));
}

it("DOCX drops a chip with neither a label nor a safe IRI, and labels an IRI-only chip with the IRI", async () => {
  const xml = await documentXml(
    doc(
      paragraph(
        { type: "text", text: "A" },
        { type: "chip" },
        { type: "chip", attrs: { iri: "javascript:alert(1)" } },
        { type: "chip", attrs: { iri: "https://pod.example/docs/plan.ttl" } },
        { type: "text", text: "B" },
      ),
    ),
  );
  expect(xml).toContain("https://pod.example/docs/plan.ttl");
  expect(xml).not.toContain("javascript:");
});

it("Markdown exports a chip that lacks attributes as empty text in an HTML-rendered paragraph", () => {
  const centred = (...content: JSONContent[]): JSONContent => ({
    type: "paragraph",
    attrs: { textAlign: "center" },
    content,
  });
  const markdown = exportMarkdown(
    doc(
      centred({ type: "chip" }, { type: "chip", attrs: { iri: "javascript:alert(1)" } }),
      centred({ type: "chip", attrs: { iri: "https://pod.example/docs/plan.ttl" } }),
    ),
  );
  expect(markdown).toContain('<a href="https://pod.example/docs/plan.ttl"');
  expect(markdown).not.toContain("javascript:");
});

it("Markdown treats a labelless chip inside a code block as empty text when choosing the fence", () => {
  expect(
    exportMarkdown(
      doc({ type: "codeBlock", content: [{ type: "chip" }, { type: "text", text: "x" }] }),
    ),
  ).toContain("x");
});
