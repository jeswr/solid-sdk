// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  HTML_TEXT_TRUNCATION_NOTICE,
  htmlToText,
  htmlToTextResult,
  MAX_HTML_CHARS,
  MAX_HTML_INPUT_CHARS,
  mailBodyText,
} from "./html-text.js";

describe("htmlToText", () => {
  it("drops tags, comments and script/style bodies, and decodes entities", () => {
    expect(
      htmlToText(
        "<head><title>x</title></head><p>Hi &amp; bye&#33;</p><!-- c --><script>a<b</script><div>Two&nbsp;&#x1F600;</div>&bogus; &amp",
      ),
    ).toBe("Hi & bye!\n\nTwo \u{1F600}\n&bogus; &amp");
  });

  it("stops at an unterminated tag and caps visible text", () => {
    expect(htmlToText("ok <a href='x")).toBe("ok");
    expect(htmlToText("a".repeat(MAX_HTML_CHARS + 10))).toHaveLength(MAX_HTML_CHARS);
  });

  it("stays linear on hostile markup", () => {
    const started = performance.now();
    for (const hostile of [
      "&".repeat(MAX_HTML_CHARS),
      "<!--".repeat(250_000),
      "<script>".repeat(130_000),
      "<p>".repeat(300_000),
    ])
      htmlToText(hostile);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

it.each([
  "script",
  "style",
  "head",
])("preserves Unicode offsets around skipped %s blocks", (tag) => {
  const unicode = "İẞe\u0301😀";
  const html = `<P>${unicode}</P><${tag.toUpperCase()}>${unicode.repeat(256)} hidden</${tag.toUpperCase()}><P>Next ${unicode}</P>`;
  expect(htmlToTextResult(html)).toEqual({
    text: `${unicode}\n\nNext ${unicode}`,
    truncated: false,
  });
  expect(htmlToText("<p>İstanbul</p><p>Next</p>")).toBe("İstanbul\n\nNext");
});

it("caps normalized visible text independently of markup and entity length", () => {
  expect(htmlToTextResult("a".repeat(MAX_HTML_CHARS))).toEqual({
    text: "a".repeat(MAX_HTML_CHARS),
    truncated: false,
  });
  expect(htmlToTextResult("&amp;".repeat(MAX_HTML_CHARS + 1))).toEqual({
    text: "&".repeat(MAX_HTML_CHARS),
    truncated: true,
  });
  expect(htmlToTextResult(`${" \t\r\n".repeat(MAX_HTML_CHARS / 4)}<p>Readable</p>`)).toEqual({
    text: "Readable",
    truncated: false,
  });
  expect(htmlToTextResult(`${"a".repeat(MAX_HTML_CHARS - 1)}😀tail`)).toEqual({
    text: "a".repeat(MAX_HTML_CHARS - 1),
    truncated: true,
  });
});

it.each([
  ["<!--", "-->"],
  ["<SCRIPT>", "</SCRIPT>"],
])("scans past a long leading %s before counting visible text", (open, close) => {
  expect(
    htmlToTextResult(`${open}${"İ".repeat(MAX_HTML_CHARS + 1)}${close}<p>Readable</p>`),
  ).toEqual({
    text: "Readable",
    truncated: false,
  });
});

it("bounds raw input even when no visible text is emitted", () => {
  expect(htmlToTextResult(`<!--${"x".repeat(MAX_HTML_INPUT_CHARS)}--><p>Beyond</p>`)).toEqual({
    text: "",
    truncated: true,
  });
  expect(htmlToTextResult(`<!--${"x".repeat(MAX_HTML_INPUT_CHARS - 7)}-->`)).toEqual({
    text: "",
    truncated: false,
  });
});

// Measure native search work as well as wall time: an accidental suffix rescan grows
// quadratically even on fast machines. Each fixed-token search inspects at most the
// distance to its match (or the remaining suffix), plus the short search token.
it("bounds search work by input length on hostile and truncated markup", () => {
  const original = String.prototype.indexOf;
  for (const input of [
    "&".repeat(MAX_HTML_CHARS),
    "<".repeat(MAX_HTML_CHARS),
    "<!--".repeat(MAX_HTML_CHARS / 4),
    "<script>".repeat(MAX_HTML_CHARS / 8),
    "<style>hidden</style>".repeat(40_000),
    "<p>&#x1F600;</p>".repeat(60_000),
    " ".repeat(MAX_HTML_CHARS),
  ]) {
    let searched = 0;
    String.prototype.indexOf = function (this: string, token: string, position = 0) {
      const found = original.call(this, token, position);
      searched += (found === -1 ? this.length : found) - position + token.length;
      return found;
    };
    try {
      htmlToText(input);
    } finally {
      String.prototype.indexOf = original;
    }
    // Entity look-ahead examines at most 12 characters for each bare ampersand.
    expect(searched).toBeLessThanOrEqual(16 * input.length);
  }
});

it("keeps the bounded scanner's explicit entity and malformed-markup contract", () => {
  expect(htmlToText("A &AMP; B &#xD800; &bogus;")).toBe("A & B � &bogus;");
  expect(htmlToText("A<!-- unfinished")).toBe("A");
  expect(htmlToText("A<script>unfinished")).toBe("A");
  expect(htmlToText("A<tag unfinished")).toBe("A");
  expect(htmlToText(`${"A".repeat(MAX_HTML_CHARS)}TAIL`)).not.toContain("TAIL");
});

describe("mailBodyText", () => {
  it("prefers the text part and leaves bodiless mail without a body", () => {
    expect(mailBodyText("plain", "<p>html</p>")).toEqual({ body: "plain", truncated: false });
    expect(mailBodyText(undefined, undefined)).toEqual({ body: undefined, truncated: false });
  });

  it("falls back to HTML and appends the notice only when a bound was hit", () => {
    expect(mailBodyText(undefined, "<p>Hi</p>")).toEqual({ body: "Hi", truncated: false });
    expect(mailBodyText(undefined, `<p>${"a".repeat(MAX_HTML_CHARS + 1)}</p>`)).toEqual({
      body: `${"a".repeat(MAX_HTML_CHARS)}\n\n${HTML_TEXT_TRUNCATION_NOTICE}`,
      truncated: true,
    });
    expect(
      mailBodyText(undefined, `<!--${"x".repeat(MAX_HTML_INPUT_CHARS)}--><p>Late</p>`),
    ).toEqual({ body: HTML_TEXT_TRUNCATION_NOTICE, truncated: true });
  });
});
