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
      { types: ["text/plain"], getType: async () => ({ text: async () => "Plain text" }) },
      { types: ["text/plain"], getType: async () => ({ text: async () => "Second item" }) },
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

it("hands clipboard images to the editor's paste handling, as a keyboard paste does", async () => {
  vi.stubGlobal("ClipboardEvent", window.Event);
  const handlePaste = vi.fn((_view: unknown, event: ClipboardEvent) =>
    Boolean(event.clipboardData?.files.length),
  );
  const e = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p>Before</p>",
    editorProps: { handlePaste },
  });
  editors.push(e);
  const png = new Blob(["png"], { type: "image/png" });
  clipboard({ read: async () => [{ types: ["image/png"], getType: async () => png }] });
  await clipboardAction(e, "paste");
  const data = handlePaste.mock.calls[0]?.[1].clipboardData;
  expect(data?.files).toHaveLength(1);
  expect(data?.files[0]).toMatchObject({ name: "pasted-image", type: "image/png" });
  expect(data?.types).toEqual([]);
  expect(data?.getData("text/plain")).toBe("");
  expect(data?.getData("text/uri-list")).toBe("");
  expect(e.getText()).toBe("Before");
  // Rich HTML and its plain text travel with the image, for the handler to choose between.
  clipboard({
    read: async () => [
      {
        types: ["text/html", "text/plain", "image/png"],
        getType: async (type: string) =>
          type === "image/png"
            ? png
            : { text: async () => (type === "text/html" ? "<p>Rich</p>" : "Rich") },
      },
      // Later rich parts and unrelated types don't replace the first ones.
      {
        types: ["text/html", "application/x-other"],
        getType: async () => ({ text: async () => "<p>Later</p>" }),
      },
    ],
  });
  await clipboardAction(e, "paste");
  const rich = handlePaste.mock.calls[1]?.[1].clipboardData;
  expect(rich?.types).toEqual(["text/html", "text/plain"]);
  expect(rich?.getData("text/html")).toBe("<p>Rich</p>");
  expect(rich?.getData("text/plain")).toBe("Rich");
  expect(rich?.files).toHaveLength(1);
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
