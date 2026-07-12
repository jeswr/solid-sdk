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
