// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { readNumbering } from "../src/apps/docs/lib/convert/docx-numbering";
import { embeddedDocument } from "../src/apps/docs/lib/convert/docx-payload";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { normaliseImport } from "../src/apps/docs/lib/convert/schema";
import type { PodSession } from "../src/lib/session/pod-session";
import { legacyDocx } from "./helpers/docs-legacy-docx";

const session = { fetch: vi.fn() } as unknown as PodSession;
const warning = { label: "Some formatting may differ from the original", count: 1 };
const linkedCode = normaliseImport({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "printf 'a  b'",
          marks: [{ type: "code" }, { type: "link", attrs: { href: "https://example.org/" } }],
        },
      ],
    },
  ],
}).json;
const checklist = importMarkdown(
  "- [ ] Parent\n\n  Continuation inside Parent\n\n  - [x] Child\n- [ ] Sibling",
  "checklist.md",
).json;
const numbered = importMarkdown("7. Seven\n8. Eight\n\nSee step 8 above.", "steps.md").json;

async function exported(json: JSONContent, embedded = true) {
  const data = await Packer.toArrayBuffer(await (embedded ? legacyDocx : toDocx)(json, vi.fn()));
  const zip = await openArrayBuffer(data);
  if (!embedded)
    zip.write(
      "docProps/custom.xml",
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>',
    );
  return zip;
}
async function convert(data: ArrayBuffer) {
  return convertImport(
    new NodeFile([data], "round23.docx") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
}

it.each([
  true,
  false,
])("round23 linked inline code retains its code mark, link and double space (embedded: %s)", async (embedded) => {
  const zip = await exported(linkedCode, embedded);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(linkedCode);
  expect(result.skipped).toEqual(embedded ? [] : [warning]);
});

it.each([
  true,
  false,
])("round23 checklist continuation stays inside Parent and retains Child ancestry (embedded: %s)", async (embedded) => {
  expect(checklist.content?.[0]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "paragraph",
    "taskList",
  ]);
  const zip = await exported(checklist, embedded);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(checklist);
  expect(result.skipped).toEqual(embedded ? [] : [warning]);
});

it.each([
  true,
  false,
])("round23 numbered steps retain start 7 and the reference to step 8 (embedded: %s)", async (embedded) => {
  expect(numbered.content?.[0]?.attrs?.start).toBe(7);
  const zip = await exported(numbered, embedded);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(numbered);
  expect(result.skipped).toEqual(embedded ? [] : [warning]);
});

async function rewritePayload(
  zip: Awaited<ReturnType<typeof exported>>,
  change: (payload: Record<string, unknown>) => void,
) {
  const xml = new DOMParser().parseFromString(
    await zip.read("docProps/custom.xml", "utf-8"),
    "application/xml",
  );
  const value = xml.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
    "lpwstr",
  )[0] as Element;
  const payload = JSON.parse(value.textContent as string) as Record<string, unknown>;
  change(payload);
  value.textContent = JSON.stringify(payload);
  zip.write("docProps/custom.xml", new XMLSerializer().serializeToString(xml));
}

it.each([
  [
    "future version",
    (payload: Record<string, unknown>) => {
      payload.version = 2;
    },
  ],
  [
    "wrong text digest",
    (payload: Record<string, unknown>) => {
      payload.textDigest = "wrong";
    },
  ],
  [
    "wrong body digest",
    (payload: Record<string, unknown>) => {
      payload.bodyDigest = "wrong";
    },
  ],
  [
    "unknown node",
    (payload: Record<string, unknown>) => {
      payload.json = { type: "doc", content: [{ type: "futureNode" }] };
    },
  ],
  [
    "invalid structure",
    (payload: Record<string, unknown>) => {
      payload.json = { type: "doc", content: [{ type: "text", text: "bad" }] };
    },
  ],
  [
    "invalid root",
    (payload: Record<string, unknown>) => {
      payload.json = { type: "paragraph", content: [{ type: "text", text: "bad" }] };
    },
  ],
  [
    "invalid heading",
    (payload: Record<string, unknown>) => {
      payload.json = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "bad" }] },
        ],
      };
    },
  ],
  [
    "unknown attribute",
    (payload: Record<string, unknown>) => {
      payload.json = { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "bad" } }] };
    },
  ],
  [
    "unsafe image",
    (payload: Record<string, unknown>) => {
      payload.json = {
        type: "doc",
        content: [{ type: "image", attrs: { src: "javascript:bad" } }],
      };
    },
  ],
  [
    "non-HTTP image",
    (payload: Record<string, unknown>) => {
      payload.json = {
        type: "doc",
        content: [{ type: "image", attrs: { src: "mailto:bad@example.org" } }],
      };
    },
  ],
] as const)("rejects embedded %s and imports visible content with a warning", async (_name, change) => {
  const zip = await exported(linkedCode);
  await rewritePayload(zip, change);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(linkedCode);
  expect(result.skipped).toEqual([warning]);
});

it.each([
  "malformed XML",
  "malformed JSON",
  "duplicate payload",
])("falls back on %s", async (kind) => {
  const zip = await exported(linkedCode);
  const source = await zip.read("docProps/custom.xml", "utf-8");
  zip.write(
    "docProps/custom.xml",
    kind === "malformed XML"
      ? "not XML"
      : kind === "malformed JSON"
        ? source.replace(/<vt:lpwstr>.*?<\/vt:lpwstr>/, "<vt:lpwstr>{</vt:lpwstr>")
        : source.replace(
            "</Properties>",
            `${source.match(/<property .*?<\/property>/)?.[0]}</Properties>`,
          ),
  );
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(linkedCode);
  expect(result.skipped).toEqual([warning]);
});

it.each([
  "text",
  "formatting",
  "link",
  "numbering",
])("uses visible DOCX after an external %s edit", async (kind) => {
  const zip = await exported(kind === "numbering" ? numbered : linkedCode);
  const part =
    kind === "link"
      ? "word/_rels/document.xml.rels"
      : kind === "numbering"
        ? "word/numbering.xml"
        : "word/document.xml";
  let source = await zip.read(part, "utf-8");
  if (kind === "text") source = source.replace("a  b", "a  c");
  if (kind === "formatting")
    source = source.replace(
      '<w:rStyle w:val="InlineCode"/>',
      '<w:b/><w:rStyle w:val="InlineCode"/>',
    );
  if (kind === "link") source = source.replace("https://example.org/", "https://example.net/");
  if (kind === "numbering") source = source.replaceAll('w:val="7"', 'w:val="9"');
  zip.write(part, source);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).not.toEqual(kind === "numbering" ? numbered : linkedCode);
  expect(result.skipped).toEqual([warning]);
  if (kind === "text") expect(JSON.stringify(result.json)).toContain("a  c");
  if (kind === "formatting")
    expect(result.json.content?.[0]?.content?.[0]?.marks).toContainEqual({ type: "bold" });
  if (kind === "link") expect(JSON.stringify(result.json)).toContain("https://example.net/");
  if (kind === "numbering") expect(result.json.content?.[0]?.attrs?.start).toBe(9);
});

it.each([
  false,
  true,
])("guards embedded image data against external edits (edited: %s)", async (edited) => {
  const original = normaliseImport({
    type: "doc",
    content: [{ type: "image", attrs: { src: "https://pod.test/image.png", alt: "Original" } }],
  }).json;
  const data = await Packer.toArrayBuffer(
    await legacyDocx(original, async () => ({
      data: new Uint8Array([1, 2, 3]),
      type: "png",
      width: 1,
      height: 1,
    })),
  );
  const zip = await openArrayBuffer(data);
  if (edited) {
    const rels = await zip.read("word/_rels/document.xml.rels", "utf-8");
    const media = /Target="(media\/[^"]+)"/.exec(rels)?.[1] as string;
    zip.write(`word/${media}`, new Uint8Array([4, 5, 6]));
  }
  const upload = vi.fn(async (_data: ArrayBuffer, _type: string) => "https://pod.test/changed.png");
  const result = await convertImport(
    new NodeFile([await zip.toArrayBuffer()], "image.docx") as unknown as File,
    session,
    upload,
    vi.fn(),
  );
  expect(result.skipped).toEqual(edited ? [warning] : []);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(new Uint8Array(upload.mock.calls[0]?.[0] as ArrayBuffer)).toEqual(
    new Uint8Array(edited ? [4, 5, 6] : [1, 2, 3]),
  );
  expect(result.json.content?.[0]?.attrs?.src).toBe("https://pod.test/changed.png");
});

const zipLibrary = createRequire(import.meta.resolve("mammoth"))("jszip") as {
  loadAsync: (data: ArrayBuffer) => Promise<{
    remove: (name: string) => void;
    generateAsync: (options: { type: "arraybuffer" }) => Promise<ArrayBuffer>;
  }>;
};

it("warns for a foreign DOCX without custom properties or a numbering part", async () => {
  const zip = await zipLibrary.loadAsync(await (await exported(linkedCode)).toArrayBuffer());
  zip.remove("docProps/custom.xml");
  zip.remove("word/numbering.xml");
  const result = await convert(await zip.generateAsync({ type: "arraybuffer" }));
  expect(result.json).toEqual(linkedCode);
  expect(result.skipped).toEqual([warning]);
});

it("rejects an embedded payload when optional visible parts have been removed", async () => {
  const zip = await zipLibrary.loadAsync(await (await exported(linkedCode)).toArrayBuffer());
  for (const part of ["word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"])
    zip.remove(part);
  expect(
    await embeddedDocument(await openArrayBuffer(await zip.generateAsync({ type: "arraybuffer" }))),
  ).toBeUndefined();
});

it("reads Word numbering overrides and defaults from incomplete or malformed definitions", () => {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const numbering = `<w:numbering ${ns}>
    <w:abstractNum w:abstractNumId="1"><w:lvl><w:start w:val="7"/></w:lvl><w:lvl w:ilvl="1"/><w:lvl w:ilvl="2"><w:start w:val="bad"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="11"/></w:lvlOverride></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride><w:lvl><w:start w:val="8"/></w:lvl></w:lvlOverride></w:num>
    <w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="4"/></w:lvlOverride></w:num>
    <w:num w:numId="4"><w:abstractNumId w:val="404"/></w:num>
    <w:num/>
  </w:numbering>`;
  const paragraph = (id: string, level = "0") =>
    `<w:p><w:pPr><w:numPr><w:numId w:val="${id}"/><w:ilvl w:val="${level}"/></w:numPr></w:pPr></w:p>`;
  const result = readNumbering(
    `<w:document ${ns}><w:body>${paragraph("1")}${paragraph("2")}${paragraph("3")}${paragraph("3", "1")}${paragraph("3", "2")}${paragraph("4")}<w:p/><w:p><w:pPr><w:numPr/></w:pPr></w:p></w:body></w:document>`,
    numbering,
  );
  expect(result.map((item) => item.start)).toEqual([11, 8, 7, 4, 1, 1, 1, 1]);
});

it("retains visible content if the DOCX reader supplies a paragraph without raw numbering metadata", async () => {
  const { default: mammoth } = await import("mammoth/mammoth.browser");
  const realConvert = mammoth.convertToHtml;
  const spy = vi.spyOn(mammoth, "convertToHtml").mockImplementation((input, options) =>
    realConvert(input, {
      ...options,
      transformDocument: (document) => {
        // Exercise the dependency boundary: a reader can synthesize paragraphs.
        document.children.push({
          type: "paragraph",
          children: [{ type: "run", children: [{ type: "text", value: "Recovered item" }] }],
          numbering: { level: "0", isOrdered: true },
        });
        return options?.transformDocument?.(document);
      },
    }),
  );
  try {
    const zip = await exported(linkedCode, false);
    const result = await convert(await zip.toArrayBuffer());
    expect(result.json.content?.[1]?.attrs?.start).toBe(1);
    expect(result.json.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe(
      "Recovered item",
    );
    expect(result.skipped).toEqual([warning]);
  } finally {
    spy.mockRestore();
  }
});

it("restores the payload when unrelated custom properties are present", async () => {
  const zip = await exported(linkedCode);
  const source = await zip.read("docProps/custom.xml", "utf-8");
  zip.write(
    "docProps/custom.xml",
    source.replace(
      "</Properties>",
      '<property name="Unrelated" pid="99" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"><vt:lpwstr>Other metadata</vt:lpwstr></property></Properties>',
    ),
  );
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(linkedCode);
  expect(result.skipped).toEqual([]);
});

it.each([
  "taskList",
  "bulletList",
  "orderedList",
])("keeps %s continuations before and after a nested list in their parent", async (type) => {
  const p = (value: string): JSONContent => ({
    type: "paragraph",
    content: [{ type: "text", text: value }],
  });
  const item = (content: JSONContent[]): JSONContent => ({
    type: type === "taskList" ? "taskItem" : "listItem",
    content,
  });
  const original = normaliseImport({
    type: "doc",
    content: [
      {
        type,
        ...(type === "orderedList" ? { attrs: { start: 7 } } : {}),
        content: [
          item([
            p("Parent"),
            p("Before Child"),
            { type, content: [item([p("Child")])] },
            p("After Child"),
          ]),
          item([p("Sibling")]),
        ],
      },
    ],
  }).json;
  const zip = await exported(original, false);
  const result = await convert(await zip.toArrayBuffer());
  expect(result.json).toEqual(original);
  expect(result.skipped).toEqual([warning]);
});
