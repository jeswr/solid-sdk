// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { Editor } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FindBar } from "../src/apps/docs/components/find-bar";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

it("keeps Find available but hides replacement controls in a view-only document", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const editor = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p>cat cat</p>",
    editable: false,
  });
  try {
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(FindBar, { editor, revision: 0, close: vi.fn() }),
        ),
      ),
    );
    expect(host.querySelectorAll("input:not([type=checkbox])")).toHaveLength(1);
    expect(
      [...host.querySelectorAll("button")].some((button) =>
        button.textContent?.startsWith("Replace"),
      ),
    ).toBe(false);
    expect(editor.getHTML()).toBe("<p>cat cat</p>");
  } finally {
    await act(async () => root.unmount());
    editor.destroy();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  "Replace",
  "Replace all",
])("guards the %s dispatch when edit permission changes while Find is open", async (label) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const editor = new Editor({ extensions: baseExtensions(vi.fn()), content: "<p>cat cat</p>" });
  try {
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(FindBar, { editor, revision: 0, close: vi.fn() }),
        ),
      ),
    );
    const inputs = host.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(inputs[0], "cat");
      inputs[0]?.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(inputs[1], "dog");
      inputs[1]?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 2");
    editor.setEditable(false, false);
    const button = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    );
    await act(async () => button?.click());
    expect(editor.getHTML()).toBe("<p>cat cat</p>");
  } finally {
    await act(async () => root.unmount());
    editor.destroy();
    host.remove();
    vi.unstubAllGlobals();
  }
});
