// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Document, ExternalHyperlink, Packer, Paragraph, TextRun } from "docx";
import fc from "fast-check";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";
import { normaliseDestination } from "../src/apps/docs/lib/editor/destination";
import { validLink } from "../src/apps/docs/lib/editor/logic";
import type { PodSession } from "../src/lib/session/pod-session";

const raw = "https://files.example.org/terms/signed contract.pdf";
const encoded = "https://files.example.org/terms/signed%20contract.pdf";
const session = { fetch: vi.fn() } as unknown as PodSession;
const schema = getSchema(baseExtensions(session.fetch));
const linked = (href: string): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "signed contract", marks: [{ type: "link", attrs: { href } }] },
      ],
    },
  ],
});

it("round29 normalizes the signed contract link before storing, rendering and two reopens", async () => {
  const imported = await convertImport(
    new NodeFile([`[signed contract](<${raw}>)`], "contract.md") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(encoded);
  expect(imported.html).toContain(`href="${encoded}"`);
  let update: Uint8Array | undefined;
  for (let reopen = 0; reopen < 3; reopen++) {
    const doc = new Doc();
    if (update) applyUpdate(doc, update);
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(doc, session.fetch),
    });
    try {
      if (!update) editor.commands.setContent(imported.json);
      const stored = yDocToProsemirrorJSON(doc) as JSONContent;
      const href = stored.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href as string;
      expect(href).toBe(encoded);
      expect(validLink(href)).toBe(encoded);
      expect(editor.view.dom.querySelector("a")?.getAttribute("href")).toBe(encoded);
      expect(editor.getHTML()).toContain(`href="${encoded}"`);
      update = encodeStateAsUpdate(doc);
    } finally {
      editor.destroy();
      doc.destroy();
    }
  }
});

it.each(["HTML import", "document payload"])("round29 normalizes URLs in %s", (path) => {
  const result =
    path === "HTML import"
      ? importHtml(`<p><a href="${raw}">signed contract</a></p>`)
      : normaliseImport(linked(raw));
  expect(result.skipped).toEqual([]);
  expect(result.json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(encoded);
});

it("round29 retains unsafe link text and reports the dropped mark", () => {
  const imported = importMarkdown("[signed contract](<javascript:alert(1)>)", "unsafe.md");
  expect(imported.json.content?.[0]?.content).toEqual([{ type: "text", text: "signed contract" }]);
  expect(imported.skipped.length).toBeGreaterThan(0);
});

it.each([
  [
    "https://example.org/合同 signed%20copy%2f.pdf",
    "https://example.org/%E5%90%88%E5%90%8C%20signed%20copy%2f.pdf",
  ],
  ["https://example.org/%invalid%2", "https://example.org/%25invalid%252"],
  [
    'https://example.org/a\t<>"\\|{}[]^`',
    "https://example.org/a%09%3C%3E%22%5C%7C%7B%7D%5B%5D%5E%60",
  ],
  ["mailto:é@example.org", "mailto:%C3%A9@example.org"],
  [
    "https://[2001:db8::1]:8443/signed contract.pdf",
    "https://[2001:db8::1]:8443/signed%20contract.pdf",
  ],
  ["https://%5B::1%5D/path", null],
  ["javascript:alert(1)", null],
  ["data:text/html,hello world", null],
  ["https://user:pass@example.org/path", null],
  ["https://[invalid/path", null],
  ["https://example.org/\ud800", null],
])("round29 encodes and validates a destination without double encoding: %j", (input, expected) => {
  expect(normaliseDestination(input as string)).toBe(expected);
  if (expected) expect(normaliseDestination(expected)).toBe(expected);
});

it("round29 HTML paste normalizes links and images and retains invalid link text", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(vi.fn(async () => new Response(null, { status: 404 }))),
  });
  try {
    editor.view.pasteHTML(
      `<p><a href="${raw}">signed contract</a> <a href="javascript:alert(1)"><strong>unsafe</strong></a></p><img src="https://pod.test/合同 image%20copy.png"><img src="mailto:no@example.org">`,
      new Event("paste") as ClipboardEvent,
    );
    expect(editor.getHTML()).toContain(`href="${encoded}"`);
    expect(editor.getHTML()).toContain("https://pod.test/%E5%90%88%E5%90%8C%20image%20copy.png");
    expect(editor.getHTML()).toContain("<strong>unsafe</strong>");
    expect(editor.getHTML()).not.toContain("javascript:");
    expect(editor.getHTML()).not.toContain("mailto:");
    expect(editor.getHTML()).not.toContain('href=""');
  } finally {
    editor.destroy();
  }
});

it.each(["Markdown", "HTML", "payload"])("round29 normalizes image destinations in %s", (path) => {
  const src = "https://pod.test/合同 image%20copy.png";
  const imported =
    path === "Markdown"
      ? importMarkdown(`![image](<${src}>)`, "image.md")
      : path === "HTML"
        ? importHtml(`<img src="${src}">`)
        : normaliseImport({ type: "doc", content: [{ type: "image", attrs: { src } }] });
  expect(imported.skipped).toEqual([]);
  expect(imported.json.content?.[0]?.attrs?.src).toBe(
    "https://pod.test/%E5%90%88%E5%90%8C%20image%20copy.png",
  );
});

it.each([
  "",
  "javascript:alert(1)",
  "https://user:pass@example.org/",
  "https://[broken",
  undefined,
])("round29 payload drops invalid link marks while retaining other formatting: %j", (href) => {
  const json = linked(raw);
  const node = json.content?.[0]?.content?.[0] as JSONContent;
  node.marks = [
    { type: "bold" },
    { type: "link", ...(href === undefined ? {} : { attrs: { href } }) },
  ];
  const imported = normaliseImport(json);
  expect(imported.json.content?.[0]?.content).toEqual([
    { type: "text", text: "signed contract", marks: [{ type: "bold" }] },
  ]);
  expect(imported.skipped).toEqual([{ label: "Unsafe URLs", count: 1 }]);
});

it.each([
  undefined,
  "mailto:hello@example.org",
])("round29 payload reports invalid images: %j", (src) => {
  const imported = normaliseImport({
    type: "doc",
    content: [{ type: "image", ...(src === undefined ? {} : { attrs: { src } }) }],
  });
  expect(imported.json.content?.[0]?.type).toBe("paragraph");
  expect(imported.skipped).toEqual([{ label: "Unsafe URLs", count: 1 }]);
});

it.each([
  true,
  false,
])("round29 DOCX normalizes links and uploaded images (embedded: %s)", async (embedded) => {
  const json = linked(embedded ? raw : encoded);
  json.content?.push({ type: "image", attrs: { src: "https://pod.test/original.png" } });
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(
      await toDocx(json, async () => ({
        data: new Uint8Array([1]),
        type: "png",
        width: 1,
        height: 1,
      })),
    ),
  );
  if (!embedded) {
    archive.write("docProps/custom.xml", "<Properties/>");
    // The mapped path reads the visible DOCX relationship, independently of the payload.
    const part = "word/_rels/document.xml.rels";
    const xml = await archive.read(part, "utf-8");
    archive.write(part, xml.replace(encoded, raw));
  }
  const src = "https://pod.test/合同 uploaded%20copy.png?x=1&y=2";
  const result = await importDocx(await archive.toArrayBuffer(), {
    uploadImage: async () => src,
    progress: vi.fn(),
  });
  const imported = result.json ? result : importHtml(result.html, result.skipped);
  expect(imported.json?.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(encoded);
  expect(imported.json?.content?.find((node) => node.type === "image")?.attrs?.src).toBe(
    "https://pod.test/%E5%90%88%E5%90%8C%20uploaded%20copy.png?x=1&y=2",
  );
  expect(result.html).toContain(`href="${encoded}"`);
  expect(result.html).toContain("uploaded%20copy.png?x=1&amp;y=2");
  expect(result.skipped).toEqual(
    embedded ? [] : [{ label: "Some formatting may differ from the original", count: 1 }],
  );
});

it("round29 embedded DOCX drops invalid links with a warning and keeps the text", async () => {
  const data = await Packer.toArrayBuffer(await toDocx(linked("javascript:alert(1)"), vi.fn()));
  const result = await importDocx(data, { uploadImage: vi.fn(), progress: vi.fn() });
  expect(result.json?.content?.[0]?.content).toEqual([{ type: "text", text: "signed contract" }]);
  expect(result.skipped).toEqual([{ label: "Unsafe URLs", count: 1 }]);
  expect(result.html).toBe("<p>signed contract</p>");
});

it.each([
  "",
  "mailto:hello@example.org",
])("round29 rejects invalid uploaded image destinations: %j", async (src) => {
  const json: JSONContent = { type: "doc", content: [{ type: "image", attrs: { src: raw } }] };
  const data = await Packer.toArrayBuffer(
    await toDocx(json, async () => ({
      data: new Uint8Array([1]),
      type: "png",
      width: 1,
      height: 1,
    })),
  );
  await expect(
    importDocx(data, { uploadImage: async () => src, progress: vi.fn() }),
  ).rejects.toThrow("Invalid uploaded image URL");
});

function assertDestinations(json: JSONContent) {
  schema.nodeFromJSON(json).descendants((node) => {
    for (const mark of node.marks)
      if (mark.type.name === "link") expect(validLink(mark.attrs.href)).not.toBeNull();
    if (node.type.name === "image") expect(validLink(node.attrs.src)).not.toBeNull();
  });
}

it("round29 every stored href from Markdown, HTML, payload and both DOCX paths passes the editor validator", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(
        "https://example.org/",
        "mailto:",
        "javascript:",
        "data:",
        "https://user:pass@example.org/",
        "https://[invalid/",
      ),
      fc.array(
        fc.constantFrom("contract", " ", "é", "合同", "😀", "%20", "%2f", "%", "@example.org"),
        { minLength: 1, maxLength: 6 },
      ),
      async (prefix, parts) => {
        const href = prefix + parts.join("");
        const escaped = href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        const visible = new Document({
          sections: [
            {
              children: [
                new Paragraph({
                  children: [
                    new ExternalHyperlink({
                      link: href,
                      children: [new TextRun("signed contract")],
                    }),
                  ],
                }),
              ],
            },
          ],
        });
        const mapped = await importDocx(await Packer.toArrayBuffer(visible), {
          uploadImage: vi.fn(),
          progress: vi.fn(),
        });
        const embedded = await importDocx(
          await Packer.toArrayBuffer(await toDocx(linked(href), vi.fn())),
          { uploadImage: vi.fn(), progress: vi.fn() },
        );
        const results = [
          importMarkdown(`[signed contract](<${href}>)`, "property.md"),
          importHtml(`<p><a href="${escaped}">signed contract</a></p>`),
          normaliseImport(linked(href)),
          importHtml(mapped.html, mapped.skipped),
          embedded.json ? embedded : importHtml(embedded.html, embedded.skipped),
        ];
        for (const result of results) assertDestinations(result.json as JSONContent);
      },
    ),
    { seed: 2907, numRuns: 30 },
  );
});
