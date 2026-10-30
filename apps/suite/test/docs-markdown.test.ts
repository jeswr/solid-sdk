// AUTHORED-BY Codex GPT-6
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
const numericReference = (value: number) => `&${"#"}${value};`;
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
    "[A \\&amp;](https://example.org/)",
    "[A \\&amp;][ref]\n\n[ref]: https://example.org/",
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

  it.each([1, 2])("exports multiline level-%i headings with setext syntax", (level) => {
    const underline = level === 1 ? "===" : "---";
    const source = `First\nSecond\n${underline}`;
    const expected = doc(b("heading", [t("First\nSecond")], { level }));
    expect(roundTrip(source)).toEqual(expected);
    expect(docsToMarkdown(expected)).toBe(source);
  });
  it.each([
    "Foo *bar\nbaz*\n====",
    "**First**\n_Second_\n---",
    "First\\\nSecond\n===",
    "before\n\nFirst\nSecond\n===\n\nafter",
    "> First\n> Second\n> ---",
    "- First\n  Second\n  ===",
    "- [x] item\n\n  First\n  Second\n  ---",
  ])("round trips multiline headings with inline marks and surrounding blocks: %s", (source) => {
    roundTrip(source);
  });
  it("rejects multiline level-3 headings that CommonMark cannot represent", () => {
    errorCode(
      () => docsToMarkdown(doc(b("heading", [t("First\nSecond")], { level: 3 }))),
      "unrepresentable",
    );
  });

  it.each([
    "\t",
    " \t",
    "  \t",
    "   \t",
    "    ",
  ])("removes four columns of structural code indentation: %j", (indent) => {
    expect(roundTrip(`${indent}foo\tbar\t\tbaz`)).toEqual(
      doc(b("codeBlock", [t("foo\tbar\t\tbaz")])),
    );
  });
  it("preserves code indentation after the first four columns on every line", () => {
    expect(roundTrip("  \tfoo\n \t \tbar\n   \t\tbaz\n    \tend")).toEqual(
      doc(b("codeBlock", [t("foo\n \tbar\n\tbaz\n\tend")])),
    );
  });
  it.each(["```", "  ```", "~~~"])("preserves content tabs in fenced code: %s", (fence) => {
    const indent = fence.startsWith("  ") ? "  " : "";
    expect(roundTrip(`${fence}\n${indent}\tfoo\tbar\n${fence}`)).toEqual(
      doc(b("codeBlock", [t("\tfoo\tbar")])),
    );
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
  it.each(["x", "X", " "])("imports wrapped task descriptions with marker [%s]", (marker) => {
    expect(roundTrip(`- [${marker}]\n  completed`)).toEqual(
      doc(b("taskList", [b("taskItem", [p(t("completed"))], { checked: marker !== " " })])),
    );
  });
  it("keeps wrapped and same-line tasks in one checklist", () => {
    expect(roundTrip("- [x]\n  completed\n- [ ] pending")).toEqual(
      doc(
        b("taskList", [
          b("taskItem", [p(t("completed"))], { checked: true }),
          b("taskItem", [p(t("pending"))], { checked: false }),
        ]),
      ),
    );
  });
  it("preserves formatting, reference links, and later blocks after wrapped task markers", () => {
    expect(
      roundTrip(
        "- [x]\n  **completed** [site][ref]\n\n  second paragraph\n\n  - nested\n\n[ref]: https://example.org/\n[x]: https://example.org/marker",
      ),
    ).toEqual(
      doc(
        b("taskList", [
          b(
            "taskItem",
            [
              p(
                t("completed", [m("bold")]),
                t(" "),
                t("site", [{ type: "link", attrs: { href: "https://example.org/" } }]),
              ),
              p(t("second paragraph")),
              b("bulletList", [b("listItem", [p(t("nested"))])]),
            ],
            { checked: true },
          ),
        ]),
      ),
    );
  });
  it.each([
    "- [x]  \n  completed",
    "- [x]\t\n  completed",
  ])("consumes task-marker whitespace without adding a hard break: %s", (source) => {
    expect(roundTrip(source)).toEqual(
      doc(b("taskList", [b("taskItem", [p(t("completed"))], { checked: true })])),
    );
  });
  it("preserves blocks after an empty task paragraph", () => {
    expect(roundTrip("- [x]\n\n  completed")).toEqual(
      doc(b("taskList", [b("taskItem", [p(), p(t("completed"))], { checked: true })])),
    );
  });
  it.each([
    "- [x]tail",
    "- \\[x] completed",
    "- `[x]` completed",
    "- [y] completed",
  ])("keeps non-task markers in bullet items: %s", (source) => {
    expect(roundTrip(source).content?.[0]?.type).toBe("bulletList");
  });
  it.each([
    "- [x]\n  completed\n- ordinary",
    "1. [x]\n   completed",
  ])("rejects mixed or ordered lists with wrapped tasks: %s", (source) => {
    errorCode(() => markdownToDocs(source), "unsupported");
    expect(markdownToDocs(source, { unsupported: "literal" })).toEqual(doc(p(t(source))));
  });
  it.each([
    "***first* middle *last***",
    "___first_ middle _last___",
    "before ***first* middle *last*** after",
    "[***first* middle *last***](https://example.org/)",
  ])("rejects nested emphasis that Marked mis-tokenizes: %s", (source) => {
    errorCode(() => markdownToDocs(source), "unsupported");
    expect(markdownToDocs(source, { unsupported: "literal" })).toEqual(doc(p(t(source))));
  });
  it("imports equivalent nested emphasis with the exact text and marks", () => {
    expect(roundTrip("**_first_ middle _last_**")).toEqual(
      doc(
        p(
          t("first", [m("bold"), m("italic")]),
          t(" middle ", [m("bold")]),
          t("last", [m("bold"), m("italic")]),
        ),
      ),
    );
    expect(roundTrip("***first** middle **last***")).toEqual(
      doc(
        p(
          t("first", [m("bold"), m("italic")]),
          t(" middle ", [m("italic")]),
          t("last", [m("bold"), m("italic")]),
        ),
      ),
    );
    expect(roundTrip("***first \\* middle `*last*`***")).toEqual(
      doc(
        p(
          t("first * middle ", [m("bold"), m("italic")]),
          t("*last*", [m("bold"), m("italic"), m("code")]),
        ),
      ),
    );
  });
  it.each([
    ["  Plan  ", p(t("Plan"))],
    ["   Plan\t ", p(t("Plan"))],
    ["  Plan \n  next\t ", p(t("Plan\nnext"))],
    ["Plan\t\n\tnext", p(t("Plan\nnext"))],
    ["Plan  \n   next  ", p(t("Plan"), b("hardBreak"), t("next"))],
    ["Plan\\\n   **next**  ", p(t("Plan"), b("hardBreak"), t("next", [m("bold")]))],
    ["**Plan \n next**", p(t("Plan\nnext", [m("bold")]))],
    ["  **Plan**  ", p(t("Plan", [m("bold")]))],
    ["  ` Plan `  ", p(t("Plan", [m("code")]))],
    ["\u00a0Plan\u00a0", p(t("\u00a0Plan\u00a0"))],
    [`${numericReference(32)}Plan${numericReference(32)}`, p(t(" Plan "))],
    [
      "[  Plan  ](https://example.org/)",
      p(t("  Plan  ", [{ type: "link", attrs: { href: "https://example.org/" } }])),
    ],
  ])("applies paragraph whitespace rules before decoding text: %s", (source, paragraph) => {
    expect(markdownToDocs(source as string)).toEqual(doc(paragraph as DocsNode));
  });
  it("normalizes paragraph whitespace in lists and quotes without changing code", () => {
    expect(roundTrip(">   Plan  ")).toEqual(doc(b("blockquote", [p(t("Plan"))])));
    expect(roundTrip("- Plan\n\n    Next  ")).toEqual(
      doc(b("bulletList", [b("listItem", [p(t("Plan")), p(t("Next"))])])),
    );
    expect(roundTrip("```\n  Plan  \n``` ")).toEqual(doc(b("codeBlock", [t("  Plan  ")])));
  });
  it.each([
    "  Plan  ",
    " Plan",
    "Plan ",
    "Plan\t",
    "Plan \nnext",
    "Plan\n next",
  ])("rejects export when paragraph whitespace would be lost: %s", (value) => {
    errorCode(() => docsToMarkdown(doc(p(t(value)))), "unrepresentable");
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
  it("keeps character references literal inside angle autolinks", () => {
    const href = "https://example.org/&amp;&#65;&copy;";
    expect(roundTrip(`<${href}>`)).toEqual(doc(p(t(href, [{ type: "link", attrs: { href } }]))));
  });
  it.each([
    ["https://example.org/?a=1&amp;b=2", "https://example.org/?a=1&b=2"],
    ["https://example.org/a_b_c", "https://example.org/a_b_c"],
    ["https://example.org/a*b", "https://example.org/a*b"],
    ["www.example.org", "http://www.example.org"],
    ["mira@example.org", "mailto:mira@example.org"],
  ])("imports bare autolinks with decoded text and destination: %s", (source, href) => {
    const label = source.startsWith("https:") ? href : source;
    expect(roundTrip(source)).toEqual(doc(p(t(label, [{ type: "link", attrs: { href } }]))));
    expect(roundTrip(`**before** ${source} _after_`)).toEqual(
      doc(
        p(
          t("before", [m("bold")]),
          t(" "),
          t(label, [{ type: "link", attrs: { href } }]),
          t(" "),
          t("after", [m("italic")]),
        ),
      ),
    );
  });
  it.each([
    "https://example.org/*foo*",
    "https://example.org/**foo**",
    "https://example.org/_foo_",
    "https://example.org/*foo*/tail",
    "https://example.org/first https://example.org/*foo*",
  ])("rejects bare URLs that hide CommonMark emphasis: %s", (source) => {
    errorCode(() => markdownToDocs(source), "unrepresentable");
    errorCode(() => markdownToDocs(source, { unsupported: "literal" }), "unrepresentable");
  });
  it.each([
    ["a*b*c", "a*b*c"],
    ["a*b*", "a*b*"],
    ["*b*c", "*b*c"],
    ["*word*", "_word_"],
    ["(*word*)", "\\(_word_\\)"],
    ["*!*", "_\\!_"],
    ["*🌿*", "_🌿_"],
    ["*“word”*", "_“word”_"],
    ["foo-_(bar)_", "foo\\-_\\(bar\\)_"],
    ["é*b*文", "é*b*文"],
    ["*a `b` c*", "_a `b` c_"],
    ["pre***fix***", "pre***fix***"],
    ["***pre***fix", "***pre***fix"],
    ["pre***fix***post", "pre***fix***post"],
    ["é***fix***文", "é***fix***文"],
  ])("chooses emphasis delimiters that preserve flanking: %s", (source, output) => {
    expect(docsToMarkdown(roundTrip(source))).toBe(output);
  });
  it.each([
    ["65", "A"],
    ["0000065", "A"],
    ["x41", "A"],
    ["X000041", "A"],
    ["00000065", null],
    ["x0000041", null],
    ["12345678", null],
    ["x1234567", null],
    ["", null],
    ["x", null],
    ["-65", null],
  ])("decodes only numeric references matching CommonMark digit limits: %s", (reference, decoded) => {
    const source = `&${"#"}${reference};`;
    const value = decoded ?? source;
    expect(roundTrip(source)).toEqual(doc(p(t(value))));
    const href = `https://example.org/?value=${value}`;
    expect(roundTrip(`[site](https://example.org/?value=${source})`)).toEqual(
      doc(p(t("site", [{ type: "link", attrs: { href } }]))),
    );
    expect(roundTrip(`https://example.org/?value=${source}&end=1`)).toEqual(
      doc(p(t(`${href}&end=1`, [{ type: "link", attrs: { href: `${href}&end=1` } }]))),
    );
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
    numericReference(128),
    "[x](<https://example.org/?x=\\&amp;>)",
    "&AMP;",
    "&#0;",
    "&#xD800;",
    "&#1114112;",
    numericReference(127),
    "[bad](javascript:alert(1))",
    "[bad](data:text/plain,hello)",
    "[bad](https://[)",
    "[bad](https://example.org/&#32;)",
    "[relative](/docs)",
    "[outer [inner](https://example.org/a)](https://example.org/b)",
    "[outer **[inner](https://example.org/a)**](https://example.org/b)",
    "[outer <https://example.org/a>](https://example.org/b)",
    "[outer [inner][a]][b]\n\n[a]: https://example.org/a\n[b]: https://example.org/b",
  ])("rejects unsupported input or preserves the entire source literally: %s", (source) => {
    errorCode(() => markdownToDocs(source), "unsupported");
    expect(markdownToDocs(source, { unsupported: "literal" })).toEqual(doc(p(t(source))));
  });

  it("never treats escaped unsupported syntax or code as markup", () => {
    roundTrip("\\!\\[image\\]\\(example.org/image.png\\) \\<b\\>");
    errorCode(
      () => markdownToDocs("\\!\\[image\\]\\(https://example.org/image.png\\)"),
      "unsupported",
    );
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
      numericReference(128),
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
    doc(p(t(" ", [m("italic")]))),
    doc(p(t("a ", [m("italic")]), t("b"))),
    doc(
      b("orderedList", [b("listItem", [p(t("a"))]), b("listItem", [p(t("b"))])], {
        start: 999_999_999,
      }),
    ),
  ])("fails closed when Markdown cannot preserve the JSON %#", (value) => {
    errorCode(() => docsToMarkdown(value), "unrepresentable");
  });
});
