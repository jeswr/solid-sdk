// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import {
  deriveTitle,
  editorShortcut,
  filterSlash,
  keyboardLabel,
  relativeTime,
  saveStatus,
  shortcuts,
  slashItems,
  slashQuery,
  validateImage,
  validLink,
  wordCount,
} from "../src/apps/docs/lib/editor/logic";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
describe("Docs editor decisions", () => {
  it("selects the exact save copy and relative times", () => {
    expect(saveStatus("saved", true, 0, 0, true)).toBe("View only");
    expect(saveStatus("saving", false, 0, 0)).toBe("Offline — saved on this device");
    expect(saveStatus("saving", true, 0, 0)).toBe("Saving…");
    expect(saveStatus("retrying", true, 0, 0)).toBe("Couldn't save — retrying");
    expect(saveStatus("failed", true, 0, 0)).toBe("Couldn't save");
    expect(saveStatus("saved", true, 0, 0)).toBe("Saved to your pod · just now");
    expect(saveStatus("saved", true, 0, 180000)).toBe("Saved to your pod · 3 min ago");
    expect(relativeTime(0, 3600000)).toBe("1 hr ago");
    expect(relativeTime(0, 86400000)).toBe("1 day ago");
    expect(relativeTime(0, 172800000)).toBe("2 days ago");
    expect(relativeTime(1000, 0)).toBe("just now");
  });
  it("filters slash commands and requires a valid boundary", () => {
    expect(filterSlash(" TAB ")).toEqual(["Table"]);
    expect(filterSlash("")).toEqual(slashItems);
    expect(filterSlash("unknown")).toEqual([]);
    expect(slashQuery("/head")).toEqual({ query: "head", length: 5 });
    expect(slashQuery("hello /tab")).toEqual({ query: "tab", length: 4 });
    expect(slashQuery("x/tab")).toBeNull();
    expect(slashQuery("/a\nb")).toBeNull();
  });
  it("validates links without accepting executable schemes or credentials", () => {
    for (const url of ["https://example.org/", "http://example.org/", "mailto:a@example.org"])
      expect(validLink(url)).toBe(url);
    for (const url of [
      "",
      "nonsense",
      "javascript:alert(1)",
      "https://user:pass@example.org",
      "mailto:bad",
      "https://example.org/a b",
    ])
      expect(validLink(url)).toBeNull();
    expect(validLink(" https://example.org ")).toBe("https://example.org/");
  });
  it("derives a bounded title from headings, text or an empty document", () => {
    expect(deriveTitle({ type: "doc", content: [paragraph(" hello   world ")] })).toBe(
      "hello world",
    );
    expect(deriveTitle({ type: "doc", content: [paragraph("x".repeat(80))] })).toHaveLength(60);
    expect(
      deriveTitle({
        type: "doc",
        content: [
          paragraph("body"),
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        ],
      }),
    ).toBe("Title");
    expect(deriveTitle({ type: "doc" })).toBe("Untitled document");
    expect(
      deriveTitle({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 1 } }, paragraph("Body")],
      }),
    ).toBe("Body");
    expect(
      deriveTitle({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "Nested heading" }],
              },
            ],
          },
        ],
      }),
    ).toBe("Nested heading");
  });
  it("counts Unicode words and characters", () => {
    expect(wordCount({ type: "doc", content: [paragraph("Hello world")] })).toEqual({
      words: 2,
      characters: 11,
      charactersWithoutSpaces: 10,
      readingTimeMinutes: 2 / 230,
    });
  });
  it("leaves mark shortcuts to TipTap while intercepting app commands", () => {
    expect(editorShortcut("S", true, false, false)).toBe("save");
    expect(editorShortcut("f", true, false, false)).toBe("find");
    expect(editorShortcut("h", true, false, false)).toBe("find");
    expect(editorShortcut("k", true, false, false)).toBe("link");
    expect(editorShortcut("/", true, false, false)).toBe("help");
    expect(editorShortcut("c", true, true, false)).toBe("count");
    expect(editorShortcut("h", true, true, false)).toBeNull();
    expect(editorShortcut("e", true, false, false)).toBeNull();
    expect(editorShortcut("s", false, false, false)).toBeNull();
    expect(editorShortcut("c", true, false, true)).toBeNull();
  });
  it("formats shortcuts and bounds image uploads", () => {
    expect(keyboardLabel("Mod+Alt+1", true)).toBe("⌘+⌥+1");
    expect(keyboardLabel("Mod+Alt+1", false)).toBe("Ctrl+Alt+1");
    expect(shortcuts.length).toBeGreaterThan(15);
    expect(validateImage({ type: "image/png", size: 20 * 1024 * 1024 })).toBeNull();
    expect(validateImage({ type: "image/jpeg", size: 20 * 1024 * 1024 + 1 })).toBe(
      "Images must be under 20 MB",
    );
    expect(validateImage({ type: "text/html", size: 1 })).toContain("Choose a PNG");
  });
});
