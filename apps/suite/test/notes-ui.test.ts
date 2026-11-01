// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  captureTitle,
  captureToNote,
  escapeHtml,
  taskListHtml,
} from "../src/apps/notes/lib/ui/capture";
import { checklistItems, toggleChecklistItem } from "../src/apps/notes/lib/ui/checklist";

describe("quick capture HTML", () => {
  it("caps derived titles at a grapheme and nearby word boundary, keeping the full line in the body", () => {
    expect(captureTitle("a".repeat(200))).toBe("a".repeat(200));
    expect(captureTitle("a".repeat(201))).toBe(`${"a".repeat(199)}…`);
    expect(captureTitle(`${"a".repeat(180)} longword${"b".repeat(30)}`)).toBe(
      `${"a".repeat(180)}…`,
    );
    expect(captureTitle(`a ${"b".repeat(200)}`)).toBe(`a ${"b".repeat(197)}…`);
    expect(captureTitle(` ${"b".repeat(200)}`)).toBe(` ${"b".repeat(198)}…`);
    for (const cluster of ["🌱", "e\u0301", "👨‍👩‍👧‍👦"]) {
      const title = captureTitle(cluster.repeat(201));
      expect(title.length).toBeLessThanOrEqual(200);
      expect(title.slice(0, -1).length % cluster.length).toBe(0);
    }
    const line = "a".repeat(201);
    expect(captureToNote("", `${line}\nRest`)).toEqual({
      title: `${"a".repeat(199)}…`,
      body: `<p>${line}</p><p>Rest</p>`,
    });
  });
  it("escapes markup and preserves Unicode", () => {
    expect(escapeHtml(`&<>"'🌱`)).toBe("&amp;&lt;&gt;&quot;&#39;🌱");
    expect(captureToNote("A title", "Hello <world>\nNext & last")).toEqual({
      title: "A title",
      body: "<p>Hello &lt;world&gt;</p><p>Next &amp; last</p>",
    });
    expect(captureToNote("", "First line\nBody\n\nLast")).toEqual({
      title: "First line",
      body: "<p>First line</p><p>Body</p><p>Last</p>",
    });
    expect(captureToNote("Title only", "")).toEqual({ title: "Title only", body: "" });
  });
  it("ignores empty captures and empty list rows", () => {
    expect(captureToNote("", "")).toBeUndefined();
    expect(captureToNote(" ", "", [])).toBeUndefined();
    expect(captureToNote("", "", [{ text: "  ", checked: false }])).toBeUndefined();
    expect(captureToNote("List", "", [])).toEqual({ title: "List", body: "" });
    expect(
      captureToNote("", "", [
        { text: " ", checked: false },
        { text: "Milk", checked: true },
      ]),
    ).toEqual({ title: "", body: taskListHtml([{ text: "Milk", checked: true }]) });
    expect(taskListHtml([])).toBe("");
  });
  it("matches TipTap task HTML and parses quick-capture checklist syntax", () => {
    const rows = [
      { text: "<one>", checked: false },
      { text: "two & three", checked: true },
    ];
    const html = taskListHtml(rows);
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="false">');
    expect(html).toContain('checked="checked"');
    expect(checklistItems(html)).toEqual(rows);
    expect(captureToNote("", "[ ] Milk\n[x] Bread")).toEqual({
      title: "",
      body: taskListHtml([
        { text: "Milk", checked: false },
        { text: "Bread", checked: true },
      ]),
    });
    expect(() => captureToNote("", "[X] Unsupported")).toThrow("Unsupported checklist syntax");
  });
});
describe("checklist projection and conditional edits", () => {
  it("extracts nested tasks in order, without merging descendant text", () => {
    expect(
      checklistItems(
        `<p>Not a task</p><ul><li>Ordinary</li><li data-type="taskItem" data-checked="true"><p>Parent &amp; literal &amp;lt;</p><ul><li data-type="taskItem"><p>Child</p><script>bad()</script></li></ul></li></ul>`,
      ),
    ).toEqual([
      { text: "Parent & literal &lt;", checked: true },
      { text: "Child", checked: false },
    ]);
    expect(checklistItems("")).toEqual([]);
    expect(checklistItems('<li data-type="taskItem"><p></p></li>')).toEqual([
      { text: "", checked: false },
    ]);
  });
  it("changes only a task opening tag and accepts both quote styles", () => {
    const html = `<p>Keep <b>everything</b></p><ul><li>Ordinary</li><li data-type='taskItem' data-checked='false'><p>One</p></li><li data-type="taskItem" data-checked="true"><p>Two</p></li><li data-type="taskItem"><p>Three</p></li></ul>`;
    expect(toggleChecklistItem(html, 0)).toBe(
      html.replace("data-checked='false'", 'data-checked="true"'),
    );
    expect(toggleChecklistItem(html, 1)).toBe(
      html.replace('data-checked="true"', 'data-checked="false"'),
    );
    expect(toggleChecklistItem(html, 2)).toBe(
      html.replace('<li data-type="taskItem">', '<li data-type="taskItem" data-checked="true">'),
    );
    expect(checklistItems(toggleChecklistItem(html, 0))[0]?.checked).toBe(true);
  });
  it("rejects invalid or stale item indices", () => {
    for (const index of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => toggleChecklistItem("", index)).toThrow(RangeError);
    expect(() => toggleChecklistItem("<p>No tasks</p>", 0)).toThrow("Task no longer exists");
    expect(() => toggleChecklistItem(taskListHtml([{ text: "One", checked: false }]), 1)).toThrow(
      "Task no longer exists",
    );
  });
});
