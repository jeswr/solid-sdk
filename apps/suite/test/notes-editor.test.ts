// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { Editor, type JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import "./drive-ui-dom";
import { notesExtensions } from "../src/apps/notes/editor/extensions";
import { NoteColour } from "../src/apps/notes/lib/model/prefs";
import { taskListHtml } from "../src/apps/notes/lib/ui/capture";
import { toggleChecklistItem } from "../src/apps/notes/lib/ui/checklist";

it("loads capture HTML and card checkbox edits into the Notes editor profile", () => {
  const html = taskListHtml([
    { text: "Milk", checked: false },
    { text: "Bread & eggs", checked: true },
    { text: "Flowers", checked: false },
  ]);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: notesExtensions(),
    content: toggleChecklistItem(html, 0),
  });
  try {
    const list = (editor.getJSON() as JSONContent).content?.[0];
    expect(list?.type).toBe("taskList");
    expect(list?.content?.map((item) => item.attrs?.checked)).toEqual([true, true, false]);
    expect(list?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe("Bread & eggs");
    for (const node of ["image", "table", "codeBlock", "blockquote"])
      expect(editor.schema.nodes[node]).toBeUndefined();
    editor.commands.setContent("<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>");
    expect(editor.getHTML()).toContain("<h3>Three</h3>");
    expect(editor.getHTML()).not.toContain("<h4>");
  } finally {
    editor.destroy();
  }
});
it("rejects unsafe links and always serializes protective rel attributes", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: notesExtensions(),
    content:
      '<p><a href="javascript:alert(1)">Unsafe</a> <a href="https://example.com" rel="opener">Safe</a></p>',
  });
  try {
    const html = editor.getHTML();
    expect(html).not.toContain("javascript:");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('rel="opener"');
    editor.commands.selectAll();
    expect(editor.commands.setLink({ href: "data:text/html,bad" })).toBe(false);
  } finally {
    editor.destroy();
  }
});

describe("note palette", () => {
  it("defines all eleven light/dark backgrounds with AA text contrast", () => {
    const css = readFileSync(
      new URL("../src/apps/notes/components/notes.css", import.meta.url),
      "utf8",
    );
    const themes = {
      light: new Map<string, { bg: string; fg?: string }>(),
      dark: new Map<string, { bg: string; fg?: string }>(),
    };
    for (const match of css.matchAll(
      /^(\.dark )?\[data-note-colour(?:="([a-z]+)")?\]\s*\{([^}]+)\}/gm,
    )) {
      const body = match[3] as string;
      const bg = /--note-bg:\s*(#[a-f0-9]+)/i.exec(body)?.[1] as string;
      const fg = /--note-fg:\s*(#[a-f0-9]+)/i.exec(body)?.[1];
      themes[match[1] ? "dark" : "light"].set(match[2] ?? "default", { bg, ...(fg ? { fg } : {}) });
    }
    function luminance(hex: string) {
      const expanded =
        hex.length === 4
          ? `#${hex
              .slice(1)
              .split("")
              .map((char) => char + char)
              .join("")}`
          : hex;
      const rgb = [1, 3, 5].map((offset) => {
        const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        (rgb[0] as number) * 0.2126 + (rgb[1] as number) * 0.7152 + (rgb[2] as number) * 0.0722
      );
    }
    for (const palette of Object.values(themes)) {
      expect([...palette.keys()].sort()).toEqual([...NoteColour.options].sort());
      const fg = luminance(palette.get("default")?.fg as string);
      for (const { bg } of palette.values()) {
        const background = luminance(bg);
        expect(
          (Math.max(fg, background) + 0.05) / (Math.min(fg, background) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
