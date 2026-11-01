// @vitest-environment jsdom
// AUTHORED-BY Codex

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { TooltipProvider } from "@jeswr/suite-ui";
import { Editor } from "@tiptap/react";
import { createRef, createElement as h, type ReactElement, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EditorMenubar,
  type EditorMenubarProps,
  openMenuAfter,
} from "../src/apps/docs/components/editor-menubar";
import { CountPopover } from "../src/apps/docs/components/editor-popovers";
import { EditorToolbar } from "../src/apps/docs/components/editor-toolbar";
import {
  ColourGrid,
  ColourPopover,
  FontSelect,
  FontSizeControl,
} from "../src/apps/docs/components/formatting-controls";
import { InlineTitle } from "../src/apps/docs/components/inline-title";
import { PageCanvas } from "../src/apps/docs/components/page-canvas";
import { editorActions } from "../src/apps/docs/editor/actions";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

// Reuse the suite's installed RTL instead of adding application dependencies.
const requireUi = createRequire(resolve(process.cwd(), "../../packages/suite-ui/package.json"));
const { render, cleanup, fireEvent, screen, act } = requireUi("@testing-library/react") as {
  render: (element: ReactElement) => {
    rerender: (element: ReactElement) => void;
    unmount: () => void;
    container: HTMLElement;
  };
  cleanup: () => void;
  fireEvent: {
    keyDown: (element: Element, options: object) => void;
    mouseDown: (element: Element) => boolean;
    focus: (element: Element) => void;
    blur: (element: Element) => void;
    change: (element: Element, options: object) => void;
    click: (element: Element) => void;
    pointerEnter: (element: Element) => void;
    pointerDown: (element: Element, options?: object) => void;
  };
  screen: {
    getByRole: (role: string, options?: { name?: string | RegExp; exact?: boolean }) => HTMLElement;
    getAllByRole: (role: string, options?: { name?: string | RegExp }) => HTMLElement[];
    queryByRole: (role: string, options?: { name?: string | RegExp }) => HTMLElement | null;
    getByLabelText: (label: string) => HTMLElement;
    getByText: (text: string) => HTMLElement;
  };
  act: (work: () => void | Promise<void>) => Promise<void>;
};
const editors: Editor[] = [];
let sizes: ResizeObserverCallback[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sizes = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        sizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(callback, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ClipboardEvent", window.Event);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window.Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(async () => {
  cleanup();
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  for (const editor of editors.splice(0)) editor.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function create() {
  const editor = new Editor({
    extensions: baseExtensions(vi.fn()),
    content: "<p>One two three</p>",
  });
  editors.push(editor);
  return editor;
}
const key = (element: Element, value: string, extra = {}) =>
  fireEvent.keyDown(element, { key: value, ...extra });
const button = (name: string) => screen.getByRole("button", { name, exact: true });
const menuitem = (name: string) => screen.getByRole("menuitem", { name, exact: true });
async function openMenu(name: string) {
  const trigger = menuitem(name);
  await act(() => trigger.focus());
  key(trigger, "ArrowDown");
  await vi.waitFor(() => expect(screen.queryByRole("menu")).not.toBeNull());
}
async function selectItem(name: string) {
  const item = menuitem(name);
  await act(() => item.focus());
  key(item, "Enter");
  await vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function openSub(name: string) {
  const item = menuitem(name);
  await act(() => item.focus());
  key(item, "ArrowRight");
  await vi.waitFor(() => expect(screen.getAllByRole("menu").length).toBe(2));
}
function props(editor: Editor, overrides: Partial<EditorMenubarProps> = {}): EditorMenubarProps {
  return {
    editor,
    actions: editorActions(editor, {
      link: vi.fn(),
      image: vi.fn(),
      find: vi.fn(),
      count: vi.fn(),
    }),
    mac: false,
    online: true,
    readOnly: false,
    draft: false,
    outline: true,
    setOutline: vi.fn(),
    zoom: 100,
    setZoom: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
    importFile: vi.fn(),
    print: vi.fn(),
    download: vi.fn(),
    help: vi.fn(),
    ...overrides,
  };
}

it("stages typing, commits on Enter/blur and restores the focused title with Escape", () => {
  const stage = vi.fn();
  const commit = vi.fn();
  const done = vi.fn();
  const cancel = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  // The parent owns the title: staging updates it, and runtime renames arrive as props.
  function Harness({ remote, readOnly = false }: { remote: string; readOnly?: boolean }) {
    const [title, setTitle] = useState(remote);
    useEffect(() => setTitle(remote), [remote]);
    return h(InlineTitle, {
      title,
      readOnly,
      inputRef,
      stage: (value: string) => {
        stage(value);
        setTitle(value);
      },
      commit,
      done,
      cancel,
    });
  }
  const view = render(h(Harness, { remote: "Original" }));
  const input = screen.getByRole("textbox", { name: "Document title" }) as HTMLInputElement;
  fireEvent.blur(input);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "  Renamed  " } });
  expect(stage).toHaveBeenLastCalledWith("  Renamed  ");
  key(input, "Enter");
  expect(commit).toHaveBeenLastCalledWith("  Renamed  ");
  expect(done).toHaveBeenCalledOnce();
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledTimes(1);
  view.rerender(h(Harness, { remote: "Renamed" }));
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Cancel me" } });
  key(input, "Escape");
  expect(stage).toHaveBeenLastCalledWith("Renamed");
  expect(input.value).toBe("Renamed");
  expect(cancel).toHaveBeenCalledOnce();
  fireEvent.blur(input);
  expect(commit).toHaveBeenLastCalledWith("Renamed");
  // An untouched focused title follows remote renames, and Escape stages nothing.
  fireEvent.focus(input);
  view.rerender(h(Harness, { remote: "Remote" }));
  expect(input.value).toBe("Remote");
  const staged = stage.mock.calls.length;
  key(input, "Escape");
  expect(stage).toHaveBeenCalledTimes(staged);
  fireEvent.blur(input);
  expect(commit).toHaveBeenLastCalledWith("Remote");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Temporary" } });
  fireEvent.change(input, { target: { value: "Remote" } });
  const typed = stage.mock.calls.length;
  key(input, "Escape");
  expect(stage).toHaveBeenCalledTimes(typed);
  fireEvent.blur(input);
  view.rerender(h(Harness, { remote: "Remote", readOnly: true }));
  const commits = commit.mock.calls.length;
  fireEvent.focus(input);
  key(input, "Escape");
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledTimes(commits);
  expect(stage).toHaveBeenCalledTimes(typed);
  view.rerender(h(Harness, { remote: "" }));
  expect(input.title).toBe("Untitled document");
  expect(input.getAttribute("maxlength")).toBe("200");
});

it("gives the menubar one Tab stop, arrow/Home/End traversal and typeahead", async () => {
  const editor = create();
  render(h(EditorMenubar, props(editor)));
  const triggers = screen.getByRole("menubar").querySelectorAll<HTMLElement>("button");
  expect([...triggers].filter((trigger) => trigger.tabIndex === 0)).toHaveLength(1);
  await act(() => menuitem("File").focus());
  key(menuitem("File"), "ArrowRight");
  expect(document.activeElement).toBe(menuitem("Edit"));
  key(menuitem("Edit"), "End");
  expect(document.activeElement).toBe(menuitem("Help"));
  key(menuitem("Help"), "ArrowRight");
  expect(document.activeElement).toBe(menuitem("File"));
  key(menuitem("File"), "ArrowLeft");
  expect(document.activeElement).toBe(menuitem("Help"));
  key(menuitem("Help"), "Home");
  key(menuitem("File"), "t");
  expect(document.activeElement).toBe(menuitem("Tools"));
  key(menuitem("Tools"), "z");
  expect(document.activeElement).toBe(menuitem("Tools"));
  key(menuitem("Tools"), "f", { ctrlKey: true });
  expect(document.activeElement).toBe(menuitem("Tools"));
  key(menuitem("Tools"), "Enter");
  await vi.waitFor(() => expect(screen.queryByRole("menu")).not.toBeNull());
  key(document.activeElement as Element, "Escape");
  await vi.waitFor(() => expect(document.activeElement).toBe(menuitem("Tools")));
});

it("switches open menus with arrows and pointers, handles typeahead and nested-menu Escape", async () => {
  const editor = create();
  const options = props(editor);
  render(h(EditorMenubar, options));
  await openMenu("File");
  const content = screen.getByRole("menu");
  key(content, "ArrowRight");
  await vi.waitFor(() => expect(screen.queryByRole("menuitem", { name: /^Undo/ })).not.toBeNull());
  key(screen.getByRole("menu"), "ArrowLeft");
  await vi.waitFor(() => expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeNull());
  key(screen.getByRole("menu"), "r");
  await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe("Rename"));
  key(document.activeElement as Element, "Escape");
  // Radix restores focus after the closing menu unmounts; the trigger gets it back.
  await vi.waitFor(() => expect(document.activeElement).toBe(menuitem("File")));
  await openMenu("File");
  await openSub("Download");
  key(document.activeElement as Element, "ArrowLeft");
  await vi.waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(1));
  key(document.activeElement as Element, "Escape");
  await vi.waitFor(() => expect(document.activeElement).toBe(menuitem("File")));
  await openMenu("File");
  fireEvent.pointerEnter(menuitem("Help"));
  await vi.waitFor(() =>
    expect(screen.queryByRole("menuitem", { name: /^Keyboard shortcuts/ })).not.toBeNull(),
  );
  await selectItem("Keyboard shortcuts Ctrl+/");
  expect(options.help).toHaveBeenCalledOnce();
});

it("opens the last item with ArrowUp and keeps submenu and pointer switches inside the menu bar", async () => {
  const editor = create();
  render(h(EditorMenubar, props(editor)));
  const file = menuitem("File");
  // Pointer movement between triggers only switches menus while one is open.
  fireEvent.pointerEnter(menuitem("Edit"));
  expect(screen.queryByRole("menu")).toBeNull();
  await act(() => file.focus());
  key(file, "ArrowUp");
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Print Ctrl+P"));
  // Keys inside a submenu belong to the submenu, not to menu bar traversal.
  await openSub("Download");
  const word = menuitem("Microsoft Word (.docx)");
  await act(() => word.focus());
  key(word, "ArrowRight");
  expect(screen.getAllByRole("menu")).toHaveLength(2);
  expect(menuitem("File").getAttribute("aria-expanded")).toBe("true");
  // A sub-trigger opens its submenu with ArrowRight instead of moving to the next menu.
  key(word, "ArrowLeft");
  await vi.waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(1));
  const download = menuitem("Download");
  await act(() => download.focus());
  key(download, "ArrowRight");
  await vi.waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
  expect(menuitem("File").getAttribute("aria-expanded")).toBe("true");
  key(document.activeElement as Element, "Escape");
  await vi.waitFor(() => expect(document.activeElement).toBe(menuitem("File")));
  // Pressing another trigger opens it; the open menu's outside dismissal cannot close it.
  await openMenu("File");
  fireEvent.pointerDown(menuitem("Edit"), { button: 0, ctrlKey: false });
  await vi.waitFor(() => expect(menuitem("Edit").getAttribute("aria-expanded")).toBe("true"));
  expect(menuitem("File").getAttribute("aria-expanded")).toBe("false");
  expect(screen.getAllByRole("menu")).toHaveLength(1);
});

it("leaves focus where the person clicked after dismissing a menu outside", async () => {
  const editor = create();
  render(h(EditorMenubar, props(editor)));
  const outside = document.createElement("textarea");
  document.body.append(outside);
  await openMenu("Format");
  // Clicking into the document dismisses the menu; Radix's delayed unmount autofocus
  // must not pull keystrokes back to the Format trigger's typeahead.
  fireEvent.pointerDown(outside, { button: 0, ctrlKey: false });
  await act(() => outside.focus());
  await vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(document.activeElement).toBe(outside);
  // A keyboard dismissal still returns to the trigger.
  await openMenu("Format");
  key(document.activeElement as Element, "Escape");
  await vi.waitFor(() => expect(document.activeElement).toBe(menuitem("Format")));
  outside.remove();
});

it("ignores a stale close from a menu the bar already switched away from", () => {
  expect(openMenuAfter(null, "File", true)).toBe("File");
  expect(openMenuAfter("File", "Edit", true)).toBe("Edit");
  expect(openMenuAfter("File", "File", false)).toBeNull();
  expect(openMenuAfter("Edit", "File", false)).toBe("Edit");
});

it("runs clipboard, full screen and offline-aware Insert commands", async () => {
  const editor = create();
  const clipboard = {
    writeText: vi.fn(async (_text: string) => {}),
    readText: vi.fn(async () => "Pasted"),
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  let fullscreen: Element | null = null;
  const requestFullscreen = vi.fn(async () => {
    fullscreen = document.documentElement;
  });
  const exitFullscreen = vi.fn(async () => {
    fullscreen = null;
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  try {
    const view = render(h(EditorMenubar, props(editor)));
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await openMenu("Edit");
    await selectItem("Copy Ctrl+C");
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenLastCalledWith("One"));
    await openMenu("Edit");
    await selectItem("Cut Ctrl+X");
    await vi.waitFor(() => expect(editor.getText()).toBe(" two three"));
    await openMenu("Edit");
    await selectItem("Paste Ctrl+V");
    await vi.waitFor(() => expect(editor.getText()).toBe("Pasted two three"));
    for (const expected of [requestFullscreen, exitFullscreen]) {
      await openMenu("View");
      await selectItem("Full screen");
      await vi.waitFor(() => expect(expected).toHaveBeenCalledOnce());
    }
    view.rerender(h(EditorMenubar, props(editor, { online: false })));
    await openMenu("Insert");
    expect(menuitem("Insert image").getAttribute("data-disabled")).toBe("");
    expect(menuitem("Insert table").hasAttribute("data-disabled")).toBe(false);
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  }
});

it("runs file actions after menus close and preserves keyboard focus for Rename", async () => {
  const editor = create();
  const input = document.createElement("input");
  document.body.append(input);
  const options = props(editor, { rename: () => input.focus() });
  render(h(EditorMenubar, options));
  await openMenu("File");
  expect(screen.getByRole("menuitem", { name: "New" }).getAttribute("href")).toBe("/docs/new");
  expect(menuitem("Open").getAttribute("href")).toBe("/docs");
  await selectItem("Rename");
  expect(document.activeElement).toBe(input);
  for (const [label, callback] of [
    ["Make a copy", options.copy],
    ["Move to trash", options.remove],
    ["Import to replace…", options.importFile],
    ["Print Ctrl+P", options.print],
  ] as const) {
    await openMenu("File");
    await selectItem(label);
    expect(callback).toHaveBeenCalledOnce();
  }
  for (const [label, format] of [
    ["Microsoft Word (.docx)", "docx"],
    ["Markdown (.md)", "md"],
    ["Web page (.html)", "html"],
  ]) {
    await openMenu("File");
    await openSub("Download");
    await selectItem(label as string);
    expect(options.download).toHaveBeenLastCalledWith(format);
  }
  input.remove();
});

it("runs View, Insert, Format, Edit, Tools and Help commands with right-aligned shortcuts", async () => {
  const editor = create();
  editor.commands.selectAll();
  const options = props(editor);
  render(h(EditorMenubar, options));
  await openMenu("View");
  const show = screen.getByRole("menuitemcheckbox", { name: "Show outline" });
  fireEvent.click(show);
  expect(options.setOutline).toHaveBeenCalledWith(false);
  await openMenu("View");
  await openSub("Zoom");
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "150%" }));
  await vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await vi.waitFor(() => expect(options.setZoom).toHaveBeenCalledWith(150));
  await openMenu("Insert");
  await selectItem("Link Ctrl+K");
  expect(options.actions.find((action) => action.label === "Link")?.opensControl).toBe(true);
  await openMenu("Format");
  await openSub("Text");
  await selectItem("Bold Ctrl+B");
  expect(editor.isActive("bold")).toBe(true);
  await openMenu("Format");
  await openSub("Paragraph styles");
  await selectItem("Heading 1 Ctrl+Alt+1");
  expect(editor.getJSON().content?.[0]?.type).toBe("heading");
  await openMenu("Format");
  await openSub("Align and indent");
  await selectItem("Increase indent");
  expect(editor.getAttributes("heading").indent).toBe(1);
  await openMenu("Format");
  await openSub("Align and indent");
  await selectItem("Decrease indent");
  expect(editor.getAttributes("heading").indent).toBeNull();
  await openMenu("Format");
  await openSub("Line and paragraph spacing");
  await selectItem("1.5");
  expect(editor.getAttributes("heading").lineHeight).toBe("1.5");
  for (const label of [
    "Add space before paragraph",
    "Add space after paragraph",
    "Remove paragraph spacing",
    "Single",
    "1.15",
    "Double",
  ]) {
    await openMenu("Format");
    await openSub("Line and paragraph spacing");
    await selectItem(label);
  }
  await openMenu("Format");
  await selectItem("Clear formatting Ctrl+\\");
  expect(editor.isActive("bold")).toBe(false);
  await openMenu("Edit");
  await selectItem("Select all Ctrl+A");
  expect(editor.state.selection.empty).toBe(false);
  await openMenu("Edit");
  await selectItem("Find and replace Ctrl+F");
  await openMenu("Tools");
  await selectItem("Word count Ctrl+Shift+C");
  const view = screen.getByRole("menubar");
  expect(view.querySelector("[accesskey]")).toBeNull();
});

it("disables mutation commands for view-only documents and handles absent optional actions", async () => {
  const editor = create();
  const options = props(editor, { readOnly: true, draft: true, online: false, actions: [] });
  render(h(EditorMenubar, options));
  await openMenu("File");
  expect(menuitem("Rename").hasAttribute("data-disabled")).toBe(true);
  expect(menuitem("Make a copy").hasAttribute("data-disabled")).toBe(true);
  key(screen.getByRole("menu"), "Escape");
  await openMenu("Edit");
  expect(menuitem("Paste Ctrl+V").hasAttribute("data-disabled")).toBe(true);
  await selectItem("Find and replace Ctrl+F");
  await openMenu("Tools");
  await selectItem("Word count Ctrl+Shift+C");
});

it("edits font family and point size with typing, bounds, steppers and reset", async () => {
  const editor = create();
  editor.commands.selectAll();
  const view = render(h("div", null, h(FontSelect, { editor }), h(FontSizeControl, { editor })));
  fireEvent.change(screen.getByRole("combobox", { name: "Font family" }), {
    target: { value: "Georgia, serif" },
  });
  expect(editor.getAttributes("textStyle").fontFamily).toBe("Georgia, serif");
  const size = screen.getByRole("spinbutton", { name: "Font size in points" }) as HTMLInputElement;
  fireEvent.change(size, { target: { value: "14" } });
  key(size, "Enter");
  expect(editor.getAttributes("textStyle").fontSize).toBe("14pt");
  view.rerender(h("div", null, h(FontSelect, { editor }), h(FontSizeControl, { editor })));
  // Pressing a size button keeps the text selection: the button never takes focus.
  for (const name of ["Increase font size", "Decrease font size"])
    expect(fireEvent.mouseDown(button(name))).toBe(false);
  fireEvent.click(button("Increase font size"));
  expect(editor.getAttributes("textStyle").fontSize).toBe("15pt");
  view.rerender(h("div", null, h(FontSelect, { editor }), h(FontSizeControl, { editor })));
  fireEvent.click(button("Decrease font size"));
  expect(editor.getAttributes("textStyle").fontSize).toBe("14pt");
  view.rerender(h("div", null, h(FontSelect, { editor }), h(FontSizeControl, { editor })));
  fireEvent.change(size, { target: { value: "120" } });
  fireEvent.blur(size);
  expect(size.value).toBe("14");
  fireEvent.change(size, { target: { value: "24" } });
  key(size, "Escape");
  expect(size.value).toBe("14");
  key(size, "a");
  fireEvent.blur(size);
  for (const value of ["6pt", "96pt"]) {
    editor.commands.setFontSize(value);
    view.rerender(h("div", null, h(FontSelect, { editor }), h(FontSizeControl, { editor })));
    expect(
      (value === "6pt" ? button("Decrease font size") : button("Increase font size")).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  }
});

it("offers a labelled colour grid with arrows, Home/End, selection and Reset", async () => {
  const choose = vi.fn();
  const view = render(
    h(ColourGrid, { value: `rgb${"("}192, 0, 0)`, label: "Text colour", choose }),
  );
  expect(screen.getAllByRole("gridcell")).toHaveLength(12);
  const red = screen.getByRole("gridcell", { name: "Red" });
  expect(red.getAttribute("aria-selected")).toBe("true");
  await act(() => red.focus());
  key(red, "ArrowRight");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Orange");
  key(document.activeElement as Element, "ArrowDown");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Blue");
  key(document.activeElement as Element, "ArrowUp");
  key(document.activeElement as Element, "ArrowLeft");
  expect(document.activeElement).toBe(red);
  key(red, "Home");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Black");
  key(document.activeElement as Element, "End");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Light blue");
  key(document.activeElement as Element, "q");
  fireEvent.click(red);
  expect(choose).toHaveBeenLastCalledWith(`rgb${"("}192, 0, 0)`);
  fireEvent.click(button("Reset"));
  expect(choose).toHaveBeenLastCalledWith(null);
  key(screen.getByRole("grid"), "ArrowDown");
  view.rerender(h(ColourGrid, { value: null, label: "Highlight colour", choose }));
});

it.each([
  "color",
  "backgroundColor",
] as const)("applies and resets %s from the palette", async (kind) => {
  const editor = create();
  editor.commands.selectAll();
  const close = vi.fn();
  const view = render(h(ColourPopover, { editor, kind, close }));
  fireEvent.click(screen.getByRole("gridcell", { name: "Red" }));
  expect(editor.getAttributes("textStyle")[kind]).toBe(`rgb${"("}192, 0, 0)`);
  expect(close).toHaveBeenCalled();
  fireEvent.click(button("Reset"));
  expect(editor.getAttributes("textStyle")[kind] ?? null).toBeNull();
  key(document.activeElement as Element, "Escape");
  expect(close).toHaveBeenCalled();
  view.unmount();
});

it("counts the selection or document in a dialog and retains the typing-count preference", async () => {
  const editor = create();
  editor.commands.setTextSelection({ from: 1, to: 8 });
  const setPinned = vi.fn();
  const view = render(h(CountPopover, { editor, close: vi.fn(), pinned: false, setPinned }));
  expect(screen.getByRole("dialog", { name: "Word count" })).toBeDefined();
  expect(screen.getByRole("combobox", { name: "Count scope" }).getAttribute("value")).toBeNull();
  expect(document.querySelector("dd")?.textContent).toBe("2");
  fireEvent.change(screen.getByRole("combobox", { name: "Count scope" }), {
    target: { value: "document" },
  });
  expect(document.querySelector("dd")?.textContent).toBe("3");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show while typing" }));
  expect(setPinned).toHaveBeenCalledWith(true);
  view.unmount();
});

it("scales and reserves page geometry as content grows and bounds zoom to 50–200%", async () => {
  const view = render(h(PageCanvas, { zoom: 150, title: "A page" }, h("p", null, "Text")));
  const scale = view.container.querySelector(".docs-page-scale") as HTMLElement;
  expect(scale.style.getPropertyValue("--docs-zoom")).toBe("1.5");
  await act(() => {
    sizes[0]?.(
      [{ borderBoxSize: [{ blockSize: 1600 }] }] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
  });
  expect(scale.style.getPropertyValue("--docs-page-height")).toBe("1600px");
  await act(() => {
    sizes[0]?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    sizes[0]?.(
      [{ borderBoxSize: [], contentRect: { height: 1000 } }] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
  });
  expect(scale.style.getPropertyValue("--docs-page-height")).toBe("1194px");
  view.rerender(h(PageCanvas, { zoom: 500, title: "" }, null));
  expect(scale.style.getPropertyValue("--docs-zoom")).toBe("2");
  view.rerender(h(PageCanvas, { zoom: 0, title: "" }, null));
  expect(scale.style.getPropertyValue("--docs-zoom")).toBe("0.5");
});

it("keeps the default page height where ResizeObserver is unavailable", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const view = render(h(PageCanvas, { zoom: 100, title: "" }, h("p", null, "Text")));
  const scale = view.container.querySelector(".docs-page-scale") as HTMLElement;
  expect(scale.style.getPropertyValue("--docs-page-height")).toBe("1056px");
  expect(view.container.querySelector("h1")?.textContent).toBe("Untitled document");
  view.unmount();
});

it("keeps checklist checkboxes on the same flex row as their text, including node views without data-type", () => {
  const css = readFileSync(resolve(process.cwd(), "src/apps/docs/components/docs.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const editor = create();
  const page = document.createElement("div");
  page.className = "docs-page";
  document.body.append(page);
  page.append(editor.view.dom);
  editor.commands.setContent(
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Inline task</p></li></ul>',
  );
  const item = page.querySelector("li") as HTMLElement;
  item.removeAttribute("data-type");
  expect(getComputedStyle(item).display).toBe("flex");
  expect(item.querySelector(":scope > label input[type=checkbox]")).not.toBeNull();
  expect(item.querySelector(":scope > div > p")?.textContent).toBe("Inline task");
  style.remove();
  page.remove();
});

it("keeps toolbar controls in order and moves them into More at narrow widths", async () => {
  const editor = create();
  editor.commands.selectAll();
  const options = props(editor);
  const setZoom = vi.fn();
  const print = vi.fn();
  const toggleOutline = vi.fn();
  const view = render(
    h(
      TooltipProvider,
      null,
      h(EditorToolbar, {
        editor,
        actions: options.actions,
        mac: false,
        online: true,
        zoom: 100,
        setZoom,
        print,
        toggleOutline,
      }),
    ),
  );
  await act(() => {
    sizes[0]?.([{ contentRect: { width: 1800 } }] as ResizeObserverEntry[], {} as ResizeObserver);
  });
  const toolbar = screen.getByRole("toolbar");
  const labels = [...toolbar.querySelectorAll("button,select,input")].map((control) =>
    control.getAttribute("aria-label"),
  );
  expect(labels.slice(0, 7)).toEqual([
    "Hide outline",
    "Undo",
    "Redo",
    "Print",
    "Zoom",
    "Block type",
    "Font family",
  ]);
  fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), { target: { value: "150" } });
  expect(setZoom).toHaveBeenCalledWith(150);
  fireEvent.click(button("Print"));
  expect(print).toHaveBeenCalled();
  fireEvent.click(button("Hide outline"));
  expect(toggleOutline).toHaveBeenCalled();
  fireEvent.click(button("Bold"));
  expect(editor.isActive("bold")).toBe(true);
  fireEvent.click(button("Increase indent"));
  fireEvent.click(button("Decrease indent"));
  fireEvent.click(button("Text colour"));
  fireEvent.click(screen.getByRole("gridcell", { name: "Red" }));
  expect(editor.getAttributes("textStyle").color).toBe(`rgb${"("}192, 0, 0)`);
  await act(() => {
    sizes[0]?.([{ contentRect: { width: 260 } }] as ResizeObserverEntry[], {} as ResizeObserver);
  });
  expect(screen.queryByRole("combobox", { name: "Font family" })).toBeNull();
  const more = button("More formatting");
  await act(() => more.focus());
  key(more, "Enter");
  await vi.waitFor(() =>
    expect(screen.queryByRole("menuitem", { name: "Font family" })).not.toBeNull(),
  );
  await openSub("Font family");
  await selectItem("Georgia");
  expect(editor.getAttributes("textStyle").fontFamily).toBe("Georgia, serif");
  view.unmount();
});
