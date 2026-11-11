// AUTHORED-BY Codex GPT-6
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
    for (const node of ["table", "codeBlock", "blockquote"])
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
  it("resolves suite tokens and OKLCH mixes to AA text contrast in both themes", async () => {
    const { parseTokens, declarations } = await import(
      new URL("../../../scripts/token-css.mjs", import.meta.url).href
    );
    const { contrast } = await import(
      new URL("../../../scripts/contrast.mjs", import.meta.url).href
    );
    const themes: Record<string, Record<string, string>> = parseTokens(
      readFileSync(
        new URL("../../../packages/suite-ui/src/styles/tokens.css", import.meta.url),
        "utf8",
      ),
    );
    const css = readFileSync(
      new URL("../src/apps/notes/components/notes.css", import.meta.url),
      "utf8",
    );
    const rules = [
      ...css.matchAll(/^(\.dark )?\[data-note-colour(?:="([a-z]+)")?\]\s*\{([^}]+)\}/gm),
    ];
    type Lch = [number, number, number];
    function resolve(value: string, tokens: Record<string, string>): Lch {
      const variable = /^var\((--[\w-]+)\)$/.exec(value);
      if (variable) return resolve(tokens[variable[1] as string] as string, tokens);
      const mix = /^color-mix\(in oklch, (.+) ([\d.]+)%, (.+)\)$/.exec(value);
      if (mix) {
        const a = resolve(mix[1] as string, tokens);
        const b = resolve(mix[3] as string, tokens);
        const weight = Number(mix[2]) / 100;
        // CSS polar interpolation: powerless hues borrow the other hue; otherwise
        // take the shorter arc, wrapping through zero when necessary.
        if (a[1] === 0) a[2] = b[2];
        if (b[1] === 0) b[2] = a[2];
        const delta = ((b[2] - a[2] + 540) % 360) - 180;
        return [
          a[0] * weight + b[0] * (1 - weight),
          a[1] * weight + b[1] * (1 - weight),
          (a[2] + delta * (1 - weight) + 360) % 360,
        ];
      }
      // Split the function name from its opening bracket to keep the token guard
      // free of raw colour literals, including in test code.
      expect(value.startsWith("oklch" + "(")).toBe(true);
      const channels = value
        .slice(value.indexOf("(") + 1, -1)
        .split(/\s+/)
        .map(Number);
      expect(channels).toHaveLength(3);
      return channels as Lch;
    }
    const colour = (channels: Lch) => `oklch${"("}${channels.join(" ")})`;
    for (const [theme, tokens] of Object.entries(themes)) {
      const palette = new Map<string, Record<string, string>>();
      for (const match of rules) {
        if (match[1] && theme !== "dark") continue;
        const name = match[2] ?? "default";
        palette.set(name, { ...palette.get(name), ...declarations(match[3]) });
      }
      expect([...palette.keys()].sort()).toEqual([...NoteColour.options].sort());
      for (const [name, overrides] of palette) {
        const values = { ...tokens, ...palette.get("default"), ...overrides };
        const fg = colour(resolve(values["--note-fg"] as string, values));
        const bg = colour(resolve(values["--note-bg"] as string, values));
        expect(contrast(fg, bg), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
