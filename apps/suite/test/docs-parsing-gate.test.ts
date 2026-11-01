// @vitest-environment jsdom
// AUTHORED-BY Codex
import { getSchema } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";
import { parseDocumentHtml, parseHtmlDocument } from "../src/apps/docs/lib/editor/parse-html";

const html =
  "<blockquote><ul><li><p><em>First</em> <strong>Second</strong></p><table><tr><td><p>Cell</p></td></tr></table></li></ul></blockquote>";

it.each([
  ["Markdown HTML fragments", (source: string) => importMarkdown(source, "gate.md").json],
  ["HTML imports", (source: string) => importHtml(source).json],
  ["HTML snapshots", (source: string) => parseDocumentHtml(source, baseExtensions(vi.fn()))],
])("repeated %s bound selector state to one inert document", (_name, parse) => {
  // Each new owner document creates another selector engine in jsdom and adds
  // window listeners. Count documents instead of relying on machine speed.
  const expected = parse(html);
  const owners = new Set<Document>();
  const matches = window.Element.prototype.matches;
  const matching = vi.spyOn(window.Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    owners.add(this.ownerDocument);
    return matches.call(this, selector);
  });
  try {
    for (let run = 0; run < 20; run++) expect(parse(html)).toEqual(expected);
    expect(owners.size).toBe(1);
    for (const owner of owners) expect(owner.defaultView).toBeNull();
  } finally {
    matching.mockRestore();
  }
});

it.each([
  "",
  "Text",
  "<td>Cell</td><p>Paragraph</p>",
  "<noscript><p>Fallback</p></noscript><p>Visible</p>",
  "<!doctype html><html><head><title>Title</title></head><body><p>Body</p></body></html>",
])("keeps DOMParser's inert document parsing for %j", (source) => {
  const expected = new window.DOMParser().parseFromString(source, "text/html");
  const actual = parseHtmlDocument(source);
  expect(actual.head.innerHTML).toBe(expected.head.innerHTML);
  expect(actual.body.innerHTML).toBe(expected.body.innerHTML);
});

it("fragment parsing keeps full-document head content inert and preserves inline separators", () => {
  const schema = getSchema(baseExtensions(vi.fn()));
  const source =
    "<!doctype html><html><head><script>globalThis.docsParsingProbe = true</script></head><body><p><em>First</em>\n<strong>Second</strong></p></body></html>";
  const markdown = importMarkdown(source, "head.md");
  expect(markdown.skipped).toContainEqual({ label: "Unsupported HTML", count: 1 });
  expect(schema.nodeFromJSON(markdown.json).textContent).toBe("First\nSecond");
  expect(schema.nodeFromJSON(importHtml(source).json).textContent).toBe("First Second");
  expect(schema.nodeFromJSON(parseDocumentHtml(source, baseExtensions(vi.fn()))).textContent).toBe(
    "First Second",
  );
  expect(Object.hasOwn(globalThis, "docsParsingProbe")).toBe(false);
});
