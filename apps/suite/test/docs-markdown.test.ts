// AUTHORED-BY Codex GPT-6.1-Sol
import { Lexer } from "marked";
import { describe, expect, it, vi } from "vitest";
import {
  type DocsMark,
  type DocsNode,
  docsToMarkdown,
  MarkdownError,
  markdownToDocs,
} from "../src/apps/docs/lib/markdown";

const t = (value: string, marks: DocsMark[] = []): DocsNode => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks } : {}),
});
const b = (type: string, content: DocsNode[] = [], attrs?: Record<string, unknown>): DocsNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const p = (...content: DocsNode[]) => b("paragraph", content);
const doc = (...content: DocsNode[]) => b("doc", content);
const m = (type: string): DocsMark => ({ type });
function errorCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MarkdownError);
    expect(error).toMatchObject({ name: "MarkdownError", code });
    return;
  }
  throw new Error(`Expected ${code}`);
}
function roundTrip(source: string): DocsNode {
  const parsed = markdownToDocs(source);
  expect(markdownToDocs(docsToMarkdown(parsed))).toEqual(parsed);
  return parsed;
}

describe("DOC-L4 Markdown and Docs JSON", () => {
  it("maps headings, paragraphs, marks, quotes, rules, and code to TipTap names", () => {
    expect(
      roundTrip(
        "# Plan\n\n## Steps\n\n### Notes\n\nHello **Mira** and _Rowan_, ***friends***.\n\n> A quote\n\n---\n\n`x`\n\n```ts\nlet x = 1;\n```",
      ),
    ).toEqual(
      doc(
        b("heading", [t("Plan")], { level: 1 }),
        b("heading", [t("Steps")], { level: 2 }),
        b("heading", [t("Notes")], { level: 3 }),
        p(
          t("Hello "),
          t("Mira", [m("bold")]),
          t(" and "),
          t("Rowan", [m("italic")]),
          t(", "),
          t("friends", [m("bold"), m("italic")]),
          t("."),
        ),
        b("blockquote", [p(t("A quote"))]),
        b("horizontalRule"),
        p(t("x", [m("code")])),
        b("codeBlock", [t("let x = 1;")], { language: "ts" }),
      ),
    );
  });
  it.each([
    "Heading\n=======\n\nSubheading\n----------",
    "    indented code\n    second line\n",
    "~~~\nplain code\n~~~",
    "```\n```",
    "```\nline\n\n```",
    "````\n``` inside\n````",
    "before `` a`b `` after",
    "`   `",
    "`` `edge` ``",
    "`` edge ` ``",
    "` edge `",
    "before **bold _and italic_ bold** after",
    "**bold** **also bold**",
    "_italic **bold** italic_",
    "**`code`**",
    "**outer __inner__ end**",
    "*outer _inner_ end*",
    ">",
    "> >",
    "- [X]",
    "- [ ] [x] literal checkbox",
    '[Site](https://example.org/ "Quote \\" and slash \\\\ and &amp;")',
    "\\*literal\\* &amp; &lt; &gt; &quot; &apos; &#65; &#x1F680;",
    "# Escaped \\# and emoji 🌿",
    "#",
    "first\nsecond",
    "first  \nsecond\\\nthird",
    '[Site](https://example.org/a_(b) "A title")',
    "[**Mira** _Rowan_ `code`](https://example.org/)",
    "<https://example.org/> and <mira@example.org>",
    "[Mail](mailto:mira@example.org)",
    "[Secure](HTTPS://example.org/)",
    '[Reference][ref]\n\n[ref]: https://example.org/ "Synthetic"',
    "[Unused]: https://example.org/\n\nText",
    "www.example.org and https://example.org/ and mira@example.org",
    "- one\n- two\n  - nested\n    3. third\n    4. fourth",
    "7) seven\n8) eight",
    "0. zero\n1. one",
    "-\n- item",
    "- first paragraph\n\n  second paragraph\n\n- next",
    "- [x] complete\n- [ ] pending\n  - [X] nested",
    "- [ ] \n- [x] done",
    "> quote\n>\n> another\n>\n> > nested",
    "- > quote\n\n  ```\n  code\n  ```",
  ])("round trips supported syntax: %s", (source) => {
    roundTrip(source);
  });

  it("retains task state independently of checkbox-like item text", () => {
    expect(markdownToDocs("- [ ] [x] literal checkbox")).toEqual(
      doc(b("taskList", [b("taskItem", [p(t("[x] literal checkbox"))], { checked: false })])),
    );
    expect(markdownToDocs("**outer __inner__ end**")).toEqual(
      doc(p(t("outer inner end", [m("bold")]))),
    );
    expect(markdownToDocs("> ")).toEqual(doc(b("blockquote", [p()])));
  });
  it("preserves entity-looking link destinations and titles on export", () => {
    const value = doc(
      p(
        t("site", [
          {
            type: "link",
            attrs: { href: "https://example.org/&copy;", title: 'A "quote", a \\ and &amp;' },
          },
        ]),
      ),
    );
    expect(markdownToDocs(docsToMarkdown(value))).toEqual(value);
  });
  it("normalizes CRLF, lone CR, empty input and Markdown spelling", () => {
    expect(markdownToDocs("\r\n\r")).toEqual(doc(p()));
    expect(roundTrip("A\r\n\r\nB")).toEqual(doc(p(t("A")), p(t("B"))));
    expect(docsToMarkdown(doc())).toBe("");
    expect(docsToMarkdown(doc(p()))).toBe("");
    expect(docsToMarkdown(markdownToDocs("__Mira__"))).toBe("**Mira**");
    expect(docsToMarkdown(markdownToDocs("- [x] done"))).toContain("- [x]");
  });

  it.each([
    "#### Unsupported heading",
    "##### Fifth",
    "###### Sixth",
    "![image](https://example.org/image.png)",
    "<b>HTML</b>",
    "<div>Block HTML</div>",
    "~~strikethrough~~",
    "| A | B |\n|---|---|\n| 1 | 2 |",
    "---\ntitle: Fictional plan\n---\n\n# Plan",
    "---\ntitle: Fictional plan\n...\nBody",
    "A footnote[^1]\n\n[^1]: Details",
    "[^note]: footnote",
    "- [x] task\n- plain",
    "1. [x] ordered task",
    "```ts extra metadata\ncode\n```",
    "```a&amp;b\ncode\n```",
    "&copy;",
    "&constructor;",
    "&toString;",
    "[ref]: https://example.org/?x=\\&amp;\n\n[ref]",
    "Orphan footnote[^1]",
    "&#128;",
    "[x](<https://example.org/?x=\\&amp;>)",
    "&AMP;",
    "&#0;",
    "&#xD800;",
    "&#1114112;",
    "&#127;",
    "[bad](javascript:alert(1))",
    "[bad](data:text/plain,hello)",
    "[bad](https://[)",
    "[bad](https://example.org/&#32;)",
    "[relative](/docs)",
  ])("rejects unsupported input or preserves the entire source literally: %s", (source) => {
    errorCode(() => markdownToDocs(source), "unsupported");
    expect(markdownToDocs(source, { unsupported: "literal" })).toEqual(doc(p(t(source))));
  });

  it("never treats escaped unsupported syntax or code as markup", () => {
    roundTrip("\\!\\[image\\]\\(https://example.org/image.png\\) \\<b\\>");
    roundTrip("`![image](https://example.org/) &copy; [^note]`");
    roundTrip("```html\n<div> &copy;\n```");
    const literal = markdownToDocs("~~literal~~", { unsupported: "literal" });
    expect(markdownToDocs(docsToMarkdown(literal))).toEqual(literal);
  });
  it("validates source, options and resource limits with typed errors", () => {
    errorCode(() => markdownToDocs(1 as never), "invalid-input");
    errorCode(() => markdownToDocs("\0"), "invalid-input");
    errorCode(() => markdownToDocs("x".repeat(1_000_001)), "limit");
    for (const options of [null, 1, [], { unsupported: "drop" }, { other: true }]) {
      errorCode(() => markdownToDocs("text", options as never), "invalid-input");
    }
    errorCode(() => markdownToDocs(`${"> ".repeat(34)}deep`, { unsupported: "literal" }), "limit");
    const spy = vi.spyOn(Lexer, "lex").mockImplementationOnce(() => {
      throw new Error("Synthetic lexer failure");
    });
    errorCode(() => markdownToDocs("text"), "invalid-input");
    spy.mockRestore();
  });

  it("normalizes JSON defaults and adjacent equivalent text without mutation", () => {
    const input = doc(
      p(t("a", [m("italic"), m("bold")]), t("b", [m("bold"), m("italic")])),
      b("orderedList", [b("listItem", [p(t("item"))])]),
      b("codeBlock", [], { language: null }),
      p(t("site", [{ type: "link", attrs: { href: "https://example.org/", title: null } }])),
    );
    const before = JSON.stringify(input);
    const result = markdownToDocs(docsToMarkdown(input));
    expect(result).toEqual(
      doc(
        p(t("ab", [m("bold"), m("italic")])),
        b("orderedList", [b("listItem", [p(t("item"))])], { start: 1 }),
        b("codeBlock"),
        p(t("site", [{ type: "link", attrs: { href: "https://example.org/" } }])),
      ),
    );
    expect(JSON.stringify(input)).toBe(before);
  });
  it("escapes text that would otherwise introduce blocks, links, entities or marks", () => {
    for (const value of [
      "# heading",
      "---",
      "- item",
      "1. item",
      "[x](https://example.org)",
      "<script>",
      "&copy;",
      "&constructor;",
      "&toString;",
      "Orphan footnote[^1]",
      "&#128;",
      "[x](<https://example.org/?x=\\&amp;>)",
      "**bold**",
      "a\\b",
      "![]()",
      "|table|",
      "_word_",
      "~strike~",
    ]) {
      const input = doc(p(t(value)));
      expect(markdownToDocs(docsToMarkdown(input))).toEqual(input);
    }
    const input = doc(p(t("A ` B ` C", [m("code")]), t("!")));
    expect(markdownToDocs(docsToMarkdown(input))).toEqual(input);
  });

  it.each([
    null,
    [],
    1,
    { type: "doc", extra: true },
    {},
    { type: "doc", attrs: null },
    { type: "doc", content: "text" },
    { type: "doc", marks: [] },
    { type: "doc", text: "text" },
    doc(p({ type: "text", text: 1 } as never)),
    doc(p(t(""))),
    doc(p({ type: "text", text: "text", content: [] })),
    doc(p({ type: "text", text: "text", marks: "bad" } as never)),
    doc(p(t("x", [null as never]))),
    doc(p(t("x", [{ type: "bold", other: 1 } as never]))),
    doc(p(t("x", [{ type: "bold", attrs: { other: 1 } }]))),
    doc(p(t("x", [m("underline")]))),
    doc(p(t("x", [m("bold"), m("bold")]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "https://example.org", target: "_blank" } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: 1 } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "https://[" } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "https://example.org", title: 1 } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "https://example.org/\u0001" } }]))),
    doc(p(t("x", [{ type: "link", attrs: { href: "https://example.org/\\x" } }]))),
    doc(p(t("\r"))),
    doc(p(t("\0"))),
    doc(p(t("x".repeat(1_000_001)))),
    doc(b("image", [], { src: "https://example.org/a.png" })),
    doc(b("unknown")),
    doc(b("constructor")),
    doc(b("__proto__")),
    doc(b("heading", [], { level: 4 })),
    doc(b("heading")),
    doc(p(b("paragraph"))),
    doc(t("x")),
    doc(b("doc")),
    doc(b("blockquote")),
    doc(b("listItem", [b("heading", [], { level: 1 })])),
    doc(b("bulletList")),
    doc(b("bulletList", [p(t("x"))])),
    doc(b("taskList", [b("listItem", [p()])])),
    doc(b("taskList", [b("taskItem", [p()])])),
    doc(b("taskList", [b("taskItem", [p()], { checked: "true" })])),
    doc(b("orderedList", [b("listItem", [p()])], { start: -1 })),
    doc(b("orderedList", [b("listItem", [p()])], { start: 1.5 })),
    doc(b("orderedList", [b("listItem", [p()])], { start: 1_000_000_000 })),
    doc(b("orderedList", [b("listItem", [p()])], { start: "1" })),
    doc(b("codeBlock", [b("hardBreak")])),
    doc(b("codeBlock", [t("x", [m("bold")])])),
    doc(b("codeBlock", [], { language: 1 })),
    doc(b("codeBlock", [], { language: "bad info" })),
    doc(b("horizontalRule", [p()])),
    doc(p(b("hardBreak", [p()]))),
    doc(p(t("x")), b("paragraph", [], { textAlign: "center" })),
    p(t("not a document root")),
  ])("rejects malformed or unsupported JSON %#", (value) => {
    expect(() => docsToMarkdown(value)).toThrow(MarkdownError);
  });
  it("rejects cycles and excessive JSON depth", () => {
    const cycle = doc();
    cycle.content = [cycle];
    errorCode(() => docsToMarkdown(cycle), "limit");
  });
  it.each([
    doc(p(), p(t("text"))),
    doc(
      b("taskList", [b("taskItem", [p(t("a"))], { checked: true })]),
      b("bulletList", [b("listItem", [p(t("b"))])]),
    ),
    doc(p(t(" ", [m("bold")]))),
    doc(p(t("a\n\nb"))),
    doc(p(t("a\nb", [m("code")]))),
    doc(p(t("a ", [m("bold")]), t("b"))),
    doc(
      b("orderedList", [b("listItem", [p(t("a"))]), b("listItem", [p(t("b"))])], {
        start: 999_999_999,
      }),
    ),
  ])("fails closed when Markdown cannot preserve the JSON %#", (value) => {
    errorCode(() => docsToMarkdown(value), "unrepresentable");
  });
});
