// @vitest-environment jsdom
// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { Editor, generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { normaliseImport } from "../src/apps/docs/lib/convert/schema";

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
  ["Straße", "STRASSE"],
  ["STRAẞE", "strasse"],
  ["Σίσυφος", "ΣΊΣΥΦΟΣ"],
  ["ﬃ", "FFI"],
  ["İ", "i\u0307"],
  ["Ꭰ", "ꭰ"],
  ["A\tStraße", "a STRASSE"],
])("round40 Unicode folding resolves every reference form: %s / %s", (label, definition) => {
  for (const [left, right] of [
    [label, definition],
    [definition, label],
  ]) {
    for (const image of [false, true]) {
      for (const suffix of ["", "[]", `[${left}]`]) {
        const source = `${image ? "!" : ""}[${left}]${suffix}\n\n[${right}]: https://example.org/map`;
        const result = importMarkdown(source, "fold.md");
        expect(result.skipped).toEqual([]);
        if (image)
          expect(result.json.content?.[0]).toMatchObject({
            type: "image",
            attrs: { src: "https://example.org/map", alt: left },
          });
        else
          expect(result.json.content?.[0]?.content?.[0]).toMatchObject({
            type: "text",
            text: left,
            marks: [{ type: "link", attrs: { href: "https://example.org/map" } }],
          });
        roundTrip(result.json);
      }
    }
  }
});

it.each([
  ["ı", "I"],
  ["é", "e\u0301"],
  ["&szlig;", "SS"],
  ["\\*", "*"],
])("round40 reference folding keeps distinct labels distinct: %s / %s", (label, definition) => {
  const result = importMarkdown(
    `[${label}]\n\n[${definition}]: https://example.org/map`,
    "distinct.md",
  );
  schema.nodeFromJSON(result.json).descendants((node) => expect(node.marks).toEqual([]));
});

it.each([
  "STRASSE",
  "strasse",
  "Straße",
])("round40 reference folding shares first-definition precedence and emphasis masking: %s", (definition) => {
  for (const delimiter of ["*", "_", "~~"]) {
    const result = importMarkdown(
      `${delimiter}[label${delimiter}][${definition}]\n\n[Straße]: https://example.org/first\n[STRASSE]: https://example.org/second`,
      "precedence.md",
    );
    expect(result.json.content?.[0]?.content).toMatchObject([
      { type: "text", text: delimiter },
      {
        type: "text",
        text: `label${delimiter}`,
        marks: [{ type: "link", attrs: { href: "https://example.org/first" } }],
      },
    ]);
    roundTrip(result.json);
  }
});

it.each([
  "*",
  "_",
  "~~",
])("round40 shortcut and collapsed references mask their Unicode labels from %s", (delimiter) => {
  for (const suffix of ["", "[]"]) {
    const result = importMarkdown(
      `${delimiter}[Straße${delimiter}]${suffix}\n\n[STRASSE${delimiter}]: https://example.org/map`,
      "mask.md",
    );
    expect(result.json.content?.[0]?.content).toMatchObject([
      { type: "text", text: delimiter },
      {
        type: "text",
        text: `Straße${delimiter}`,
        marks: [{ type: "link", attrs: { href: "https://example.org/map" } }],
      },
    ]);
    roundTrip(result.json);
  }
});

it.each([
  "*emphasis*",
  "**bold**",
  "~~strike~~",
  "`code`",
  "<em>HTML</em>",
])("round40 lazy indentation preserves inline syntax: %s", (inline) => {
  const result = importMarkdown(`> - Plan\n    ${inline}\nContinued`, "inline.md");
  const expected = importMarkdown(`> - Plan\n>   ${inline}\n>   Continued`, "explicit.md");
  expect(result.json).toEqual(expected.json);
  roundTrip(result.json);
});

it.each([
  "# literal label",
  "> literal quote",
  "- literal item",
  "1. literal item",
  "```literal",
  "~~~literal",
  "---",
  "***",
  "___",
  "* * *",
  "_ _ _",
  "- - -",
])("round40 indented lazy block markers stay in the quoted list paragraph: %s", (literal) => {
  for (const prefix of ["> - ", "> 4. ", "> - [ ] ", "> > - ", "- > - "]) {
    const outer = prefix === "- > - " ? "  " : "";
    const result = importMarkdown(
      `${prefix}Plan\n${outer}    ${literal}\n${outer}Continued`,
      "lazy.md",
    );
    expect(result.skipped).toEqual([]);
    expect(result.json.content).toHaveLength(1);
    const paragraphs: string[] = [];
    schema.nodeFromJSON(result.json).descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent) paragraphs.push(node.textContent);
      expect(["heading", "codeBlock", "horizontalRule"]).not.toContain(node.type.name);
    });
    expect(paragraphs).toEqual([`Plan\n${literal}\nContinued`]);
    roundTrip(result.json);
  }
});

it.each([
  "> - ",
  "> 4. ",
  "> - [ ] ",
  "> - - ",
  "> > - ",
  "- > - ",
])("round40 quoted lazy underlines keep the following continuation inside %s", (prefix) => {
  const continuation = prefix === "- > - " ? "  > " : prefix === "> > - " ? "> > " : "> ";
  const result = importMarkdown(`${prefix}Plan\n${continuation}===\nContinued`, "underline.md");
  expect(result.skipped).toEqual([]);
  expect(result.json.content).toHaveLength(1);
  const paragraphs: string[] = [];
  schema.nodeFromJSON(result.json).descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent) paragraphs.push(node.textContent);
  });
  expect(paragraphs).toEqual(["Plan\n===\nContinued"]);
  roundTrip(result.json);
});

it.each([
  "HTML",
  "paste",
  "legacy snapshot",
])("round40 text links enforce protective rel tokens through %s and reopening", (path) => {
  const html =
    '<p><a href="https://attacker.test/" target="_blank" rel="opener nofollow">Reference</a></p>';
  const legacy: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Reference",
            marks: [
              {
                type: "link",
                attrs: { href: "https://attacker.test/", target: "_blank", rel: "opener nofollow" },
              },
            ],
          },
        ],
      },
    ],
  };
  const editor = new Editor({
    extensions,
    content: path === "HTML" ? html : path === "legacy snapshot" ? legacy : "",
    editable: path !== "legacy snapshot",
  });
  try {
    if (path === "paste") editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
    const dom = new DOMParser().parseFromString(editor.getHTML(), "text/html");
    const rel = dom.querySelector("a")?.relList;
    expect(rel?.contains("noopener")).toBe(true);
    expect(rel?.contains("noreferrer")).toBe(true);
    expect(rel?.contains("nofollow")).toBe(true);
    expect(rel?.contains("opener")).toBe(false);
    const reopened = generateJSON(editor.getHTML(), extensions);
    expect(reopened.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.rel).toBe(
      "noopener noreferrer nofollow",
    );
    if (path !== "legacy snapshot") expect(editor.getJSON()).toEqual(reopened);
    expect(editor.view.dom.querySelector("a")?.rel).toBe("noopener noreferrer nofollow");
    const markdown = exportMarkdown(editor.getJSON());
    expect(markdown).toContain('rel="noopener noreferrer nofollow"');
    expect(importMarkdown(markdown, "legacy.md").json).toEqual(reopened);
    expect(normaliseImport(editor.getJSON()).json).toEqual(reopened);
  } finally {
    editor.destroy();
  }
});

it.each([
  "opener",
  "OpEnEr NOFOLLOW noopener",
  "",
  null,
])("round40 rich Markdown metadata and image links enforce rel tokens: %s", (rel) => {
  const attrs = { href: "https://attacker.test/", target: "_blank", rel };
  for (const content of [
    '<a href="https://attacker.test/" target="_blank" rel="opener" data-docs-attrs=\'' +
      JSON.stringify(attrs) +
      "'>Reference</a>",
    '<a href="https://attacker.test/" target="_blank" rel="opener"><img src="https://example.org/logo.png"></a>',
  ]) {
    const result = importMarkdown(content, "metadata.md");
    const rendered = new DOMParser().parseFromString(
      generateHTML(result.json, extensions),
      "text/html",
    );
    expect(rendered.querySelector("a")?.relList.contains("noopener")).toBe(true);
    expect(rendered.querySelector("a")?.relList.contains("noreferrer")).toBe(true);
    expect(rendered.querySelector("a")?.relList.contains("opener")).toBe(false);
    roundTrip(result.json);
  }
});
