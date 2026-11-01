// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { Bold, Italic, Undo } from "lucide-react";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "../src/apps/docs/components/editor-toolbar";
import { FileMenu } from "../src/apps/docs/components/file-menu";
import { ImportDialog } from "../src/apps/docs/components/import-dialog";
import { DOCX_FORMATTING_WARNING } from "../src/apps/docs/lib/convert/skipped";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("Docs keyboard review regressions", () => {
  it("focuses the title after keyboard Rename closes the File menu", async () => {
    const input = document.createElement("input");
    host.append(input);
    const title = document.createElement("input");
    document.body.append(title);
    try {
      await act(async () =>
        root.render(
          createElement(
            TooltipProvider,
            null,
            createElement(FileMenu, {
              copy: vi.fn(),
              rename: () => {
                title.focus();
                title.select();
              },
              remove: vi.fn(),
              shortcuts: vi.fn(),
              draft: false,
              readOnly: false,
              download: vi.fn(),
              print: vi.fn(),
              importFile: vi.fn(),
            }),
          ),
        ),
      );
      const trigger = host.querySelector('[aria-label="File menu"]') as HTMLElement;
      await act(async () => {
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const rename = await vi.waitFor(() => {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent === "Rename",
        );
        expect(item).toBeDefined();
        return item as HTMLElement;
      });
      await act(async () => {
        rename.focus();
        rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
      await vi.waitFor(() => expect(document.activeElement).toBe(title));
    } finally {
      title.remove();
    }
  });
  it("gives the toolbar one Tab stop and roves with arrows, Home and End", async () => {
    const editor = { isActive: () => false } as unknown as Editor;
    const actions = [
      { label: "Undo", icon: Undo, keys: "", run: vi.fn() },
      { label: "Redo", icon: Undo, keys: "", run: vi.fn() },
      { label: "Bold", icon: Bold, keys: "", run: vi.fn(), active: false },
      { label: "Italic", icon: Italic, keys: "", run: vi.fn(), active: false },
      { label: "Insert image", icon: Bold, keys: "", run: vi.fn() },
    ];
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(EditorToolbar, { editor, actions, mac: false, online: false }),
        ),
      ),
    );
    const toolbar = host.querySelector('[role="toolbar"]') as HTMLElement;
    const controls = Array.from(toolbar.querySelectorAll<HTMLElement>("button, select"));
    expect(controls.filter((control) => control.tabIndex === 0)).toHaveLength(1);
    const key = async (value: string) =>
      act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
        );
      });
    await act(async () => controls[0]?.focus());
    await key("ArrowRight");
    expect(document.activeElement).toBe(controls[1]);
    await key("End");
    expect(document.activeElement).toBe(controls.at(-1));
    await key("ArrowRight");
    expect(document.activeElement).toBe(controls[0]);
    await key("ArrowLeft");
    expect(document.activeElement).toBe(controls.at(-1));
    await key("Home");
    expect(document.activeElement).toBe(controls[0]);
    const image = controls.find((control) => control.getAttribute("aria-label") === "Insert image");
    expect(image?.hasAttribute("disabled")).toBe(true);
    await act(async () =>
      controls.find((control) => control.getAttribute("aria-label") === "Italic")?.focus(),
    );
    await key("ArrowRight");
    expect(document.activeElement).toBe(controls.at(-1));
    expect(controls.filter((control) => control.tabIndex === 0)).toEqual([controls.at(-1)]);
  });
  it.each([
    false,
    true,
  ])("returns focus to the document after a More formatting command (opens a dialog: %s)", async (dialog) => {
    const focus = vi.fn();
    const editor = { isActive: () => false, commands: { focus } } as unknown as Editor;
    const run = vi.fn(() => {
      if (!dialog) return;
      const opened = document.createElement("div");
      opened.setAttribute("role", "dialog");
      document.body.append(opened);
    });
    const actions = [
      "Undo",
      "Redo",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Checklist",
    ].map((label) => ({
      label,
      icon: Bold,
      keys: "",
      run: label === "Checklist" ? run : vi.fn(),
    }));
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(EditorToolbar, { editor, actions, mac: false, online: true }),
        ),
      ),
    );
    const more = host.querySelector('[aria-label="More formatting"]') as HTMLButtonElement;
    await act(async () => {
      more.focus();
      more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const item = await vi.waitFor(() => {
      const found = Array.from(document.querySelectorAll('[role="menuitem"]')).find((menuitem) =>
        menuitem.textContent?.includes("Checklist"),
      );
      if (!found) throw new Error("Checklist is not in the More menu");
      return found as HTMLElement;
    });
    await act(async () => item.click());
    expect(run).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    if (dialog) {
      expect(focus).not.toHaveBeenCalled();
      document.querySelector('[role="dialog"]')?.remove();
    } else {
      expect(focus).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(more);
    }
  });
  it.each([
    "Cancel",
    "Escape",
  ])("restores keyboard-opened Upload focus after %s", async (method) => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => setOpen(true) }, "Upload"),
        open && createElement(ImportDialog, { close: () => setOpen(false), run: vi.fn() }),
      );
    }
    await act(async () => root.render(createElement(Harness)));
    const upload = host.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      upload.focus();
      upload.click();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    if (method === "Cancel") {
      await act(async () =>
        Array.from(document.querySelectorAll("button"))
          .find((button) => button.textContent === "Cancel")
          ?.click(),
      );
    } else {
      await act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
    }
    await vi.waitFor(() => expect(document.activeElement).toBe(upload));
  });
});

it.each([
  false,
  true,
])("shows the DOCX formatting warning separately from skipped content (skipped: %s)", async (skipped) => {
  const done = vi.fn();
  const close = vi.fn(() => root.render(null));
  await act(async () =>
    root.render(
      createElement(ImportDialog, {
        close,
        replace: true,
        run: async () => ({
          skipped: [
            { label: DOCX_FORMATTING_WARNING, count: 1 },
            ...(skipped ? [{ label: "Footnotes", count: 2 }] : []),
          ],
          done,
        }),
      }),
    ),
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "external.docx")],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Replace contents")
      ?.click(),
  );
  expect(document.querySelector('[role="status"]')?.textContent).toBe(DOCX_FORMATTING_WARNING);
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  if (skipped) expect(dialog.textContent).toContain("Footnotes (2) weren't imported");
  else expect(dialog.textContent).not.toContain("weren't imported");
  expect(done).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Open document")
      ?.click(),
  );
  expect(close).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
});
