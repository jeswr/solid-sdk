// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn(() => new Promise<Response>(() => {})));
const schema = getSchema(extensions);

it.each([
  "a|b",
  "a\\|b",
  "a\\\\|b",
  "a\\\\\\|b",
  "a\\\\\\\\|b",
  "`a\\|b`",
  " | ",
])("round43 table code preserves pipes and adjacent cells: %j", (text) => {
  const code = document.createElement("code");
  code.textContent = text;
  for (const header of [false, true]) {
    for (const quote of [false, true]) {
      const first = `<tr><th>${header ? code.outerHTML : "Code"}</th><th>literal pipe</th></tr>`;
      const second = `<tr><td>${header ? "Body" : code.outerHTML}</td><td>literal pipe</td></tr>`;
      const table = `<table>${first}${second}</table>`;
      const original = importHtml(quote ? `<blockquote>${table}</blockquote>` : table).json;
      const result = importMarkdown(exportMarkdown(original), "pipes.md");
      expect(result.skipped).toEqual([]);
      expect(result.json).toEqual(original);
    }
  }
});

it("round43 footnote fallback leaves ordinary references and literal code intact", () => {
  const result = importMarkdown(
    "[policy][p]\n\n[p]: https://example.org/policy\n\n`[^1]: Confidential.`\n\n```md\n[^2]: Secret.\n```\n\n    [^3]: Private.\n\n\\[^4]: Escaped.",
    "literal.md",
  );
  expect(result.skipped).toEqual([]);
  expect(result.json.content?.[0]?.content?.[0]?.marks).toMatchObject([
    { type: "link", attrs: { href: "https://example.org/policy" } },
  ]);
  const text = schema.nodeFromJSON(result.json).textContent;
  for (const literal of [
    "[^1]: Confidential.",
    "[^2]: Secret.",
    "[^3]: Private.",
    "[^4]: Escaped.",
  ])
    expect(text).toContain(literal);
});

it.each([
  ["1", "Confidential."],
  ["note", "Confidential policy with **important** details."],
  ["Policy", "https://example.org/policy"],
  ["long", "Confidential.\n    Continued policy."],
])("round43 footnote %s definitions and references remain visible", (label, body) => {
  for (const prefix of ["", "> ", "- "]) {
    const continuation = prefix === "- " ? "  " : prefix;
    const source = `${prefix}Read the policy[^${label}].\n${continuation}\n${continuation}[^${label}]: ${body.replaceAll("\n", `\n${continuation}`)}`;
    const result = importMarkdown(source, "policy.md");
    const text = schema.nodeFromJSON(result.json).textContent;
    expect(text).toContain(`Read the policy[^${label}].`);
    expect(text).toContain(`[^${label}]:`);
    expect(text).toContain(body.split("\n")[0]?.replaceAll("**", ""));
    if (label === "long") expect(text).toContain("Continued policy.");
    expect(result.skipped).toEqual([{ label: "Footnotes preserved as text", count: 1 }]);
    expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
  }
});

it.each([
  false,
  true,
])("round43 keyboard checkbox activation retains focus before Shift-Tab (nested %s)", async (nested) => {
  const update = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const second = '<li data-type="taskItem" data-checked="false"><p>Second</p></li>';
  const editor = new Editor({
    element: host,
    extensions,
    editorProps: { handleScrollToSelection: () => true },
    content: `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>First</p>${nested ? `<ul data-type="taskList">${second}</ul></li>` : `</li>${second}`}</ul>`,
    onUpdate: update,
  });
  try {
    editor.commands.setTextSelection(3);
    const inputs = [
      ...editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    const checkbox = inputs[1] as HTMLInputElement;
    checkbox.focus();
    update.mockClear();
    for (const type of ["keydown", "keyup"])
      checkbox.dispatchEvent(new KeyboardEvent(type, { key: " ", bubbles: true }));
    // jsdom does not perform Space's native checkbox activation.
    checkbox.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(checkbox);
    expect(inputs.map((input) => input.checked)).toEqual([true, true]);
    expect(update).toHaveBeenCalledTimes(1);
    const checked = editor.getJSON();
    const back = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(false);
    expect(editor.getJSON()).toEqual(checked);
    expect(update).toHaveBeenCalledTimes(1);
    checkbox.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(checkbox);
    expect(inputs.map((input) => input.checked)).toEqual([true, false]);
    expect(update).toHaveBeenCalledTimes(2);
  } finally {
    editor.destroy();
    host.remove();
  }
});
