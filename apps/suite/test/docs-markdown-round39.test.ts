// @vitest-environment jsdom
// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
function roundTrip(json: JSONContent) {
  const dom = new DOMParser().parseFromString(generateHTML(json, extensions), "text/html");
  expect(
    SchemaDOMParser.fromSchema(schema).parse(dom.body, { preserveWhitespace: "full" }).toJSON(),
  ).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it.each([
  "HTTPS",
  "HTTP",
  "hTtPs",
])("round39 mixed-case %s image schemes retain the URL and alt through import and export", (scheme) => {
  const src = `${scheme}://example.org/logo.png`;
  for (const source of [
    `![Logo](${src})`,
    `![Logo][logo]\n\n[logo]: ${src}`,
    `<img src="${src}" alt="Logo">`,
  ]) {
    const result = importMarkdown(source, "logo.md");
    expect(result.skipped).toEqual([]);
    expect(result.json.content?.[0]).toMatchObject({
      type: "image",
      attrs: { src: `${scheme.toLowerCase()}://example.org/logo.png`, alt: "Logo" },
    });
    roundTrip(result.json);
    const raw = schema
      .nodeFromJSON({
        type: "doc",
        content: [{ type: "image", attrs: { src, alt: "Logo" } }],
      })
      .toJSON();
    expect(importMarkdown(exportMarkdown(raw), "exported.md").json).toEqual(result.json);
  }
});

it.each([
  "https:example.org/logo.png",
  "https:/example.org/logo.png",
])("round39 image normalization keeps shorthand URL forms out of Markdown: %s", (src) => {
  const result = importMarkdown(`![Logo](${src})`, "logo.md");
  expect(result.skipped).toEqual([{ label: "Unsafe images", count: 1 }]);
  expect(result.json.content?.[0]?.type).toBe("paragraph");
});

it.each([
  "",
  "> ",
  "> > ",
  "- ",
  "4. ",
  "- [ ] ",
  "- > ",
  "> - ",
])("round39 indented paragraph continuations permit setext headings inside %s", (prefix) => {
  const continuation = prefix.replace(/\[[ xX]\] /g, "").replace(/[^ >]/g, " ");
  for (const indent of ["    ", "\t", "       "]) {
    for (const [underline, level] of [
      ["===", 1],
      ["---", 2],
    ] as const) {
      const result = importMarkdown(
        `${prefix}Report\n${continuation}${indent}detail\n${continuation}${underline}\nReply outside`,
        "report.md",
      );
      expect(result.skipped).toEqual([]);
      const node = schema.nodeFromJSON(result.json);
      const headings: { text: string; level: number }[] = [];
      node.descendants((child) => {
        if (child.type.name === "heading")
          headings.push({ text: child.textContent, level: child.attrs.level });
      });
      expect(headings).toEqual([{ text: "Report\ndetail", level }]);
      expect(result.json.content?.at(-1)).toMatchObject({
        type: "paragraph",
        content: [{ type: "text", text: "Reply outside" }],
      });
      roundTrip(result.json);
    }
  }
});

it.each(["    ", "\t"])("round39 initial %s indentation still starts code", (indent) => {
  const result = importMarkdown(`${indent}Report\n${indent}detail\n===`, "code.md");
  expect(result.json.content?.map((node) => node.type)).toEqual(["codeBlock", "paragraph"]);
  expect(schema.nodeFromJSON(result.json).textContent).toBe("Report\ndetail===");
  roundTrip(result.json);
});
