// @vitest-environment jsdom
// AUTHORED-BY Codex
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, normaliseImport } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn());
const schema = getSchema(extensions);
const text = (json: JSONContent) => schema.nodeFromJSON(json).textContent;
function roundTrip(json: JSONContent) {
  expect(generateJSON(generateHTML(json, extensions), extensions)).toEqual(json);
  expect(importMarkdown(exportMarkdown(json), "again.md").json).toEqual(json);
}

it.each([
  "[report",
  "![chart",
  "[report](unfinished",
])("round33 incomplete link syntax %s leaves HTML wrapper boundaries active", (syntax) => {
  const result = importMarkdown(`<strong>Type ${syntax} to continue.</strong>`, "literal.md");
  expect(text(result.json)).toBe(`Type ${syntax} to continue.`);
  expect(result.json.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  expect(result.skipped).toEqual([]);
  roundTrip(result.json);
});

it.each([
  "span",
  "strong",
  "em",
  "u",
])("round33 HTML %s boundaries ignore link and image destinations and titles", (tag) => {
  for (const title of [`</${tag}>`, `<${tag}>`, "<unknown>"]) {
    const result = importMarkdown(
      `<${tag}>[report](https://example.org "${title}")</${tag}>`,
      "report.md",
    );
    expect(text(result.json)).toBe("report");
    expect(result.json.content?.[0]?.content?.[0]?.marks).toContainEqual(
      expect.objectContaining({ type: "link", attrs: expect.objectContaining({ title }) }),
    );
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
    const image = importMarkdown(
      `<${tag}>![report](https://example.org/chart.png "${title}")</${tag}>`,
      "report.md",
    );
    expect(image.json.content?.[0]).toMatchObject({ type: "image", attrs: { title } });
    expect(image.skipped).toEqual([]);
    roundTrip(image.json);
  }
  const destination = importMarkdown(
    `<${tag}>[report](https://example.org/</${tag}>) after</${tag}>`,
    "report.md",
  );
  expect(text(destination.json)).toBe("report after");
});

it.each([
  "-",
  "+",
  "*",
  "1.",
  "1)",
  "2.",
  "2)",
  "999999999.",
  "- [ ]",
])("round33 an unquoted %s list ends a quote after a lazy paragraph continuation", (marker) => {
  const result = importMarkdown(`> ${marker} Quoted\ncontinued\n${marker} Outside`, "quote.md");
  expect(result.json.content?.map((node) => node.type)).toEqual([
    "blockquote",
    /^\d/.test(marker) ? "orderedList" : marker.includes("[") ? "taskList" : "bulletList",
  ]);
  expect(text(result.json.content?.[0] as JSONContent)).toBe("Quoted\ncontinued");
  expect(text(result.json.content?.[1] as JSONContent)).toBe("Outside");
  expect(result.skipped).toEqual([]);
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
  const snapshot = generateJSON(generateHTML(result.json, extensions), extensions) as JSONContent;
  expect(snapshot.content?.map((node) => node.type)).toEqual(
    result.json.content?.map((node) => node.type),
  );
  expect(text(snapshot.content?.[0] as JSONContent)).toBe("Quoted continued");
});

it.each([
  ["# Outside", "heading"],
  ["---", "horizontalRule"],
  ["~~~\nOutside\n~~~", "codeBlock"],
  ["<p>Outside</p>", "paragraph"],
])("round33 every paragraph-interrupting block stays outside a lazy quote: %s", (outside, type) => {
  const result = importMarkdown(`> - Quoted\ncontinued\n${outside}`, "quote.md");
  expect(result.json.content?.map((node) => node.type)).toEqual(["blockquote", type]);
  expect(text(result.json.content?.[0] as JSONContent)).toBe("Quoted\ncontinued");
  expect(result.skipped).toEqual([]);
});

it.each([
  "quote",
  "list",
  "tabbed list",
])("round33 quote boundaries retain attribution inside a parent %s", (parent) => {
  const source = "> - Quoted\ncontinued\n- Outside";
  const result = importMarkdown(
    parent === "quote"
      ? source
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
      : `-${parent === "list" ? " " : "\t"}Parent\n\n${source
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")}`,
    "nested.md",
  );
  const children =
    parent === "quote"
      ? result.json.content?.[0]?.content
      : result.json.content?.[0]?.content?.[0]?.content?.slice(1);
  expect(children?.map((node) => node.type)).toEqual(["blockquote", "bulletList"]);
  expect(text(children?.[0] as JSONContent)).toBe("Quoted\ncontinued");
  expect(text(children?.[1] as JSONContent)).toBe("Outside");
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it("round33 indented list-like text remains a lazy paragraph continuation", () => {
  const result = importMarkdown("> Paragraph\ncontinued\n    2. still quoted", "quote.md");
  expect(result.json.content).toHaveLength(1);
  expect(text(result.json)).toBe("Paragraph\ncontinued\n2. still quoted");
});

it.each([1, 1000])("round33 valid table spans retain the inclusive boundary %i", (span) => {
  for (const value of [span, String(span)]) {
    const result = normaliseImport({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: value, rowspan: value },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.json.content?.[0]?.content?.[0]?.content?.[0]?.attrs).toMatchObject({
      colspan: span,
      rowspan: span,
    });
    expect(result.skipped).toEqual([]);
  }
});

it.each([
  4, 5, 6,
])("round33 heading normalization preserves quoted h%i attribute prose", (level) => {
  const label = `Example of <h${level}> and </h${level}> element`;
  for (const source of [
    `<img src="https://pod.test/chart.png" alt="${label}" title='${label}'>`,
    `<a href="https://pod.test/report" title="${label}">report</a>`,
    `<h${level} title="${label}">Heading</h${level}>`,
  ]) {
    const result = importMarkdown(source, "attributes.md");
    const node = result.json.content?.[0];
    if (source.startsWith("<img")) expect(node?.attrs).toMatchObject({ alt: label, title: label });
    else if (source.startsWith("<a"))
      expect(node?.content?.[0]?.marks?.[0]?.attrs?.title).toBe(label);
    else expect(node).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(result.skipped).toEqual([]);
    roundTrip(result.json);
  }
});

it.each([
  "td",
  "th",
])("round33 every HTML %s import repairs unbounded table spans before rendering", (tag) => {
  for (const span of ["colspan", "rowspan"]) {
    for (const value of ["Infinity", "-Infinity", "NaN", "0", "-2", "1000000000"]) {
      const html = `<table><tr><${tag} ${span}="${value}">Total</${tag}></tr></table>`;
      for (const result of [importMarkdown(html, "table.md"), importHtml(html)]) {
        expect(result.json.content?.[0]?.content?.[0]?.content?.[0]?.attrs?.[span]).toBe(1);
        expect(result.skipped).toContainEqual({ label: "Invalid table spans", count: 1 });
        expect(text(result.json)).toBe("Total");
        roundTrip(result.json);
      }
    }
  }
});

it.each([
  "tableCell",
  "tableHeader",
])("round33 mapped %s spans obey the same bounded integer invariant", (type) => {
  for (const value of [Infinity, -Infinity, NaN, 0, -1, 1.5, "bad", null, true, [], {}, 1001]) {
    const result = normaliseImport({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type,
                  attrs: { colspan: value, rowspan: value },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Total" }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.json.content?.[0]?.content?.[0]?.content?.[0]?.attrs).toMatchObject({
      colspan: 1,
      rowspan: 1,
    });
    expect(result.skipped).toEqual([{ label: "Invalid table spans", count: 2 }]);
    roundTrip(result.json);
  }
});
