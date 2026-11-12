// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { newDeck, newSlide, normaliseLineEndings } from "../src/deck.js";
import {
  deckFromMarkdown,
  deckToMarkdown,
  decodeDeck,
  renderSlideMarkdown,
} from "../src/markdown.js";

describe("Markdown interchange", () => {
  it("supports a front-matter-free title and both notes conventions", () => {
    const result = deckFromMarkdown(
      "# Hello\r\nSubtitle\r\n???\r\nWelcome\r\n---\r\n# Next\r\nBody\r\nNote: Remember\r\nMore",
      new Date(0),
    );
    expect(result.name).toBe("Hello");
    expect(result.created).toEqual(new Date(0));
    expect(result.slides).toMatchObject([
      { title: "Hello", body: "Subtitle", notes: "Welcome", layout: "title" },
      { title: "Next", body: "Body", notes: "Remember\nMore", position: 1 },
    ]);
  });
  it("splits only exact separator lines and uses the first top heading", () => {
    expect(deckFromMarkdown("Text\n --- \n# Title\n# Second\n----").slides).toMatchObject([
      { title: "Title", body: "Text\n --- \n# Second\n----", notes: "" },
    ]);
    expect(deckFromMarkdown("").slides).toHaveLength(1);
    expect(deckFromMarkdown("No title").name).toBe("Untitled presentation");
    expect(deckFromMarkdown("---").slides).toHaveLength(2);
    expect(deckFromMarkdown("# A\nNote:").slides[0]?.notes).toBe("");
  });
  it("round-trips themes, images, layouts, notes, IDs, dates and literal convention lines", () => {
    const deck = {
      ...newDeck("An edited name", new Date(0)),
      description: "Description",
      theme: "warm" as const,
      aspectRatio: "4:3" as const,
      slides: [
        {
          ...newSlide("abc"),
          title: "Title",
          body: "\nFirst\n---\n???\nNote: literal\n# Heading\n\\backslash\n",
          notes: "\nNotes\n---\n???\n",
          secondBody: "Two",
          layout: "two-column" as const,
          image: "https://pod.example/image.png",
          imageAlt: "Alt",
          hidden: true,
        },
        { ...newSlide("def"), position: 1, title: "Next", body: "" },
      ],
    };
    expect(deckFromMarkdown(deckToMarkdown(deck))).toEqual(deck);
    expect(decodeDeck(JSON.stringify(deck))).toEqual(deck);
  });
  it("round-trips multi-line titles and normalises CRLF and CR line endings", () => {
    const deck = {
      ...newDeck("Two\r\nlines", new Date(0)),
      description: "Old\rMac",
      slides: [
        {
          ...newSlide("a"),
          title: "Line one\nLine two",
          body: "Windows\r\nbody\rend",
          secondBody: "x\r\ny",
          notes: "n\r\n",
          imageAlt: "a\rb",
        },
        { ...newSlide("b"), position: 1, title: "Plain\r\ntitle" },
      ],
    };
    const markdown = deckToMarkdown(deck);
    expect(markdown).not.toContain("\r");
    expect(markdown).toContain("# Line one Line two\n");
    const imported = deckFromMarkdown(markdown);
    expect(imported).toEqual(normaliseLineEndings(deck));
    expect(imported.slides[0]).toMatchObject({
      title: "Line one\nLine two",
      body: "Windows\nbody\nend",
    });
    // Hand-written Markdown with a title in the metadata keeps its heading otherwise.
    expect(deckFromMarkdown("# Only heading").slides[0]?.title).toBe("Only heading");
  });
  it("handles malformed comments as body text and rejects corrupt metadata", () => {
    expect(deckFromMarkdown("<!-- solid-slides %not-json -->\n# A").slides[0]?.body).toContain(
      "%not-json",
    );
    expect(deckFromMarkdown("<!-- solid-slides null -->\n# A").slides[0]?.body).toContain("null");
    expect(deckFromMarkdown("<!-- solid-slides %7B%7D -->\n# A").slides[0]?.body).toContain(
      "%7B%7D",
    );
    const exported = deckToMarkdown(newDeck());
    expect(() => deckFromMarkdown(exported.replace("light", "neon"))).toThrow();
    expect(() => decodeDeck('{"slides":[]}')).toThrow();
    expect(() => decodeDeck("bad")).toThrow();
    expect(() => deckToMarkdown({ ...newDeck(), slides: [] })).toThrow();
  });
  it("sanitises executable markup and URLs while preserving useful Markdown", () => {
    const html = renderSlideMarkdown(
      '**Hello** [safe](https://example.org) <script>alert(1)</script> <img src=x onerror=alert(2)> [bad](javascript:alert) <a href="//evil.example">relative</a><iframe src="https://evil.example"></iframe>',
    );
    expect(html).toContain("<strong>Hello</strong>");
    expect(html).toContain('href="https://example.org"');
    expect(html).not.toMatch(/script|onerror|javascript:|iframe|<img|href="\/\//);
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
