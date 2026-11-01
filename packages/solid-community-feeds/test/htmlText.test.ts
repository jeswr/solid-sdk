// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/htmlText.js";

describe("htmlToText", () => {
  it("returns empty for empty", () => {
    expect(htmlToText("")).toBe("");
  });

  it("strips tags and keeps text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("turns block boundaries into paragraph breaks", () => {
    // </p><p> yields two boundaries → a blank-line paragraph break.
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("decodes named entities", () => {
    expect(htmlToText("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe("a & b <c> \"d\" 'e'");
  });

  it("decodes numeric + hex entities", () => {
    expect(htmlToText("&#65;&#x42;")).toBe("AB");
  });

  it("drops invalid numeric entities safely", () => {
    expect(htmlToText("x&#1114112;y")).toBe("xy"); // > 0x10FFFF
  });

  it("removes script/style content", () => {
    expect(htmlToText("<style>p{}</style>hi<script>alert(1)</script>")).toBe("hi");
  });

  it("collapses excess blank lines and whitespace", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("handles <br> as a line break", () => {
    expect(htmlToText("line1<br>line2")).toBe("line1\nline2");
  });
});

describe("htmlToText on hostile input (linear time)", () => {
  // Each of these took seconds with the previous backtracking regexes.
  for (const [name, input] of [
    ["unclosed < run", "<".repeat(64 * 1024)],
    ["unclosed <p run", "<p".repeat(32 * 1024)],
    ["unclosed <script run", "<script>".repeat(8 * 1024)],
    ["bare & run", "&".repeat(64 * 1024)],
  ] as const) {
    it(`${name} completes quickly`, () => {
      const start = performance.now();
      htmlToText(input);
      expect(performance.now() - start).toBeLessThan(500);
    });
  }

  it("keeps a < with no closing > as text", () => {
    expect(htmlToText("a < b")).toBe("a < b");
  });

  it("drops the rest after an unclosed script", () => {
    expect(htmlToText("hi<script>alert(1)")).toBe("hi");
  });

  it("treats tag names case-insensitively", () => {
    expect(htmlToText("<P>one</P><SCRIPT>x</SCRIPT>two")).toBe("one\ntwo");
  });

  it("leaves unknown or prototype-named entities alone", () => {
    expect(htmlToText("&constructor; &bogus;")).toBe("&constructor; &bogus;");
  });

  it("caps the scanned input", () => {
    expect(htmlToText("a".repeat(2 * 1024 * 1024)).length).toBe(1024 * 1024);
  });
});
