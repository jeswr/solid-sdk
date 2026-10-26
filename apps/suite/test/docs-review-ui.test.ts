// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { Bold, Italic, Undo } from "lucide-react";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "../src/apps/docs/components/editor-toolbar";
import { ImportDialog } from "../src/apps/docs/components/import-dialog";

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
