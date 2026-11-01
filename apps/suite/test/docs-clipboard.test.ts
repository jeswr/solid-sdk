// @vitest-environment jsdom
// AUTHORED-BY Codex
import { toast } from "@jeswr/suite-ui";
import { Editor } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { clipboardAction } from "../src/apps/docs/editor/clipboard";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

const editors: Editor[] = [];
function editor() {
  const e = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p><strong>Copy me</strong></p>",
  });
  editors.push(e);
  e.commands.selectAll();
  return e;
}
function clipboard(value: object) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("copies rich HTML and plain text and cuts only after clipboard success", async () => {
  const e = editor();
  const write = vi.fn<(items: ClipboardItem[]) => Promise<void>>(async () => {});
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(readonly content: Record<string, Blob>) {}
    },
  );
  clipboard({ write });
  await clipboardAction(e, "copy");
  expect(write.mock.calls[0]?.[0]).toBeDefined();
  expect(e.getText()).toBe("Copy me");
  await clipboardAction(e, "cut");
  expect(e.getText()).toBe("");
});

it("falls back to plain text and never deletes a changed selection or document", async () => {
  const e = editor();
  vi.stubGlobal("ClipboardItem", undefined);
  const writeText = vi.fn(async () => {});
  clipboard({ writeText });
  await clipboardAction(e, "copy");
  expect(writeText).toHaveBeenCalledWith("Copy me");
  e.commands.setTextSelection(1);
  await clipboardAction(e, "copy");
  expect(writeText).toHaveBeenCalledTimes(1);
  e.commands.selectAll();
  let complete!: () => void;
  writeText.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = clipboardAction(e, "cut");
  e.commands.setTextSelection(2);
  complete();
  await pending;
  expect(e.getText()).toBe("Copy me");
  e.commands.selectAll();
  const changed = clipboardAction(e, "cut");
  e.commands.setContent("<p>New text</p>");
  e.commands.selectAll();
  complete();
  await changed;
  expect(e.getText()).toBe("New text");
  vi.stubGlobal("ClipboardItem", class {});
  writeText.mockResolvedValue();
  await clipboardAction(e, "copy");
  expect(writeText).toHaveBeenLastCalledWith("New text");
});

it("pastes HTML through the editor's sanitizing paste pipeline, preferring it to plain text", async () => {
  vi.stubGlobal("ClipboardEvent", window.Event);
  const e = editor();
  const getType = vi.fn(async () => ({
    text: async () =>
      '<p><span style="font-family:Georgia;font-size:14pt;position:fixed">Pasted</span></p>',
  }));
  clipboard({ read: async () => [{ types: ["text/plain", "text/html"], getType }] });
  await clipboardAction(e, "paste");
  expect(getType).toHaveBeenCalledWith("text/html");
  expect(e.getHTML()).toContain("Georgia");
  expect(e.getHTML()).not.toContain("position");
});

it("pastes plain clipboard items, text-only browsers and empty item lists", async () => {
  vi.stubGlobal("ClipboardEvent", window.Event);
  const e = editor();
  clipboard({
    read: async () => [
      { types: ["image/png"] },
      { types: ["text/plain"], getType: async () => ({ text: async () => "Plain text" }) },
    ],
  });
  await clipboardAction(e, "paste");
  expect(e.getText()).toBe("Plain text");
  e.commands.selectAll();
  clipboard({ readText: async () => "Fallback text" });
  await clipboardAction(e, "paste");
  expect(e.getText()).toBe("Fallback text");
  clipboard({ read: async () => [] });
  await clipboardAction(e, "paste");
  expect(e.getText()).toBe("Fallback text");
});

it("reports clipboard permission failures while preserving the document", async () => {
  const e = editor();
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  clipboard({
    writeText: async () => {
      throw new Error("denied");
    },
  });
  await clipboardAction(e, "cut");
  expect(e.getText()).toBe("Copy me");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("keyboard shortcut to cut"));
});
