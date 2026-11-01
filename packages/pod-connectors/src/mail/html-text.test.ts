// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { htmlToText, MAX_HTML_CHARS } from "./html-text.js";

describe("htmlToText", () => {
  it("drops tags, comments and script/style bodies, and decodes entities", () => {
    expect(
      htmlToText(
        "<head><title>x</title></head><p>Hi &amp; bye&#33;</p><!-- c --><script>a<b</script><div>Two&nbsp;&#x1F600;</div>&bogus; &amp",
      ),
    ).toBe("Hi & bye!\n\nTwo \u{1F600}\n&bogus; &amp");
  });

  it("stops at an unterminated tag and caps the input", () => {
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
