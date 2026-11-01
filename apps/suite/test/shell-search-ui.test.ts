// AUTHORED-BY Codex GPT-6.1-Sol
// Reuse suite-ui's installed DOM tools, as the existing Drive UI tests do.
import { createRequire } from "node:module";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const axe = requireUi(
  "axe-core",
) as typeof import("../../../packages/suite-ui/node_modules/axe-core");
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import type { SearchResponse, SearchResult, SearchSource } from "../src/shell/lib/search-results";
import { CommandPalette } from "../src/shell/search/command-palette";
import { GlobalSearch } from "../src/shell/search/global-search";
import { SearchResultsView } from "../src/shell/search/results-view";
import { ShortcutHelpSheet } from "../src/shell/shortcuts/help-sheet";
import { ShortcutsProvider, useShortcut } from "../src/shell/shortcuts/provider";

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

const items: SearchResult[] = [
  ...Array.from(
    { length: 8 },
    (_, index): SearchResult => ({
      id: `file-${index}`,
      title: `Project file ${index}`,
      type: "file",
      app: "drive",
      href: `/drive/${index}`,
    }),
  ),
  { id: "document", title: "Project plan", type: "document", app: "docs", href: "/docs" },
  { id: "task", title: "Project checklist", type: "task", app: "tasks", href: "/tasks" },
  { id: "person", title: "Project person", type: "person", app: "contacts", href: "/contacts" },
  { id: "data", title: "Project data", type: "data", app: "home", href: "/home" },
];
const source: SearchSource = {
  async search(query, { scope }) {
    return {
      results: items.filter(
        (item) => (!scope || item.app === scope) && item.title.toLowerCase().includes(query),
      ),
      source: "local",
      serverSearch: false,
    };
  },
};
async function accessible() {
  // Pixel contrast and viewport layout are checked by the six Playwright projects.
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}
function key(value: string, modifiers: KeyboardEventInit = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: value, ...modifiers });
}

it("groups and caps local suggestions, changes scope while editing, and saves and clears recents", async () => {
  const onOpen = vi.fn();
  render(
    h(ShortcutsProvider, {
      platform: "Linux",
      children: h(GlobalSearch, {
        source,
        scope: { app: "drive", label: "Drive" },
        onOpen,
        onSeeAll: vi.fn(),
      }),
    }),
  );
  const input = screen.getByRole("combobox");
  await act(() => input.focus());
  fireEvent.change(input, { target: { value: "project" } });
  await waitFor(() => expect(screen.getByRole("group", { name: "Files" })).toBeTruthy());
  expect(within(screen.getByRole("group", { name: "Files" })).getAllByRole("option")).toHaveLength(
    5,
  );
  expect(screen.queryByRole("group", { name: "Documents" })).toBeNull();
  key("F", { ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(screen.getByRole("group", { name: "Documents" })).toBeTruthy());
  expect(screen.getByText("Searching your saved copies")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss search hint" }));
  expect(localStorage.getItem("suite.searchHint.v1")).toBe("dismissed");
  await accessible();
  key("ArrowDown");
  key("Enter");
  expect(onOpen).toHaveBeenCalledWith(items[0]);
  expect(JSON.parse(localStorage.getItem("suite.recentSearches.v1") as string)).toEqual([
    "project",
  ]);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.focus(input);
  expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear recent searches" }));
  expect(localStorage.getItem("suite.recentSearches.v1")).toBeNull();
});

it("aborts stale queries and ignores late completions even when a source ignores its signal", async () => {
  const pending: { signal: AbortSignal; resolve: (response: SearchResponse) => void }[] = [];
  const slow: SearchSource = {
    search(_query, { signal }) {
      return new Promise((resolve) => pending.push({ signal, resolve }));
    },
  };
  render(h(GlobalSearch, { source: slow, onOpen: vi.fn(), onSeeAll: vi.fn() }));
  const input = screen.getByRole("combobox");
  await act(() => input.focus());
  fireEvent.change(input, { target: { value: "older" } });
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(input, { target: { value: "newer" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]?.signal.aborted).toBe(true);
  await act(() =>
    pending[1]?.resolve({
      results: [items[8] as SearchResult],
      source: "local",
      serverSearch: false,
    }),
  );
  expect(screen.getByRole("option", { name: "Project plan" })).toBeTruthy();
  await act(() =>
    pending[0]?.resolve({
      results: [items[0] as SearchResult],
      source: "local",
      serverSearch: false,
    }),
  );
  expect(screen.queryByRole("option", { name: "Project file 0" })).toBeNull();
  await accessible();
});

it("opens the mobile sheet and returns focus to its Search trigger on Escape", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
  );
  render(h(GlobalSearch, { source, onOpen: vi.fn(), onSeeAll: vi.fn() }));
  const trigger = screen.getByRole("button", { name: "Search" });
  await act(() => trigger.focus());
  fireEvent.click(trigger);
  const input = screen.getByRole("combobox");
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.change(input, { target: { value: "project" } });
  await waitFor(() => expect(screen.getByRole("group", { name: "Files" })).toBeTruthy());
  await accessible();
  key("Escape");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("filters palette actions, navigates on Enter and returns focus", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return h(
      "main",
      null,
      h("button", { onClick: () => setOpen(true) }, "Open palette"),
      h(CommandPalette, {
        open,
        onOpenChange: setOpen,
        onSearch: vi.fn(),
        createActions: [{ id: "create", label: "New document", run: vi.fn() }],
        recent: [{ id: "recent", title: "Planning notes", href: "/docs", app: "docs" }],
      }),
    );
  }
  render(h(Harness));
  const trigger = screen.getByRole("button", { name: "Open palette" });
  await act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  await accessible();
  const input = within(dialog).getByRole("combobox");
  fireEvent.change(input, { target: { value: "Drive" } });
  await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(2));
  const link = within(dialog).getByRole("option", { name: /^Drive/ });
  link.setAttribute("href", "#native-navigation");
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  link.setAttribute("href", "/drive");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(push).toHaveBeenCalledWith("/drive");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("resolves scopes, evaluates guards, unregisters, suppresses editable targets and filters help", async () => {
  const global = vi.fn();
  const app = vi.fn();
  const editor = vi.fn();
  function Editor() {
    useShortcut({
      id: "editor",
      keys: "x",
      label: "Editor",
      group: "Drive",
      scope: "editor",
      run: editor,
    });
    return null;
  }
  function Harness() {
    const [enabled, setEnabled] = useState(true);
    const [mounted, setMounted] = useState(true);
    const [help, setHelp] = useState(false);
    useShortcut({ id: "global", keys: "x", label: "Global action", group: "Global", run: global });
    useShortcut({
      id: "app",
      keys: "x",
      label: "App action",
      group: "Drive",
      when: () => enabled,
      run: app,
    });
    return h(
      "main",
      null,
      h("button", { onClick: () => setMounted(false) }, "Remove editor"),
      h("button", { onClick: () => setEnabled(false) }, "Disable app"),
      h("button", { onClick: () => setHelp(true) }, "Help"),
      mounted && h(Editor),
      h("input", { "aria-label": "Input" }),
      h("textarea", { "aria-label": "Text area" }),
      h("select", { "aria-label": "Select" }, h("option", null, "Option")),
      h("div", { contentEditable: true, "aria-label": "Editor" }),
      h("div", { role: "textbox", tabIndex: 0, "aria-label": "Textbox" }),
      h("div", { "data-shortcuts": "off" }, h("button", null, "Off")),
      h(ShortcutHelpSheet, { open: help, onOpenChange: setHelp }),
    );
  }
  render(h(ShortcutsProvider, { children: h(Harness) }));
  key("x");
  expect(editor).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Remove editor"));
  key("x");
  expect(app).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Disable app"));
  key("x");
  expect(global).toHaveBeenCalledTimes(1);
  for (const target of [
    screen.getByLabelText("Input"),
    screen.getByLabelText("Text area"),
    screen.getByLabelText("Select"),
    screen.getByLabelText("Editor"),
    screen.getByLabelText("Textbox"),
    screen.getByRole("button", { name: "Off" }),
  ])
    fireEvent.keyDown(target, { key: "x" });
  expect(global).toHaveBeenCalledTimes(1);
  const trigger = screen.getByRole("button", { name: "Help" });
  await act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  await accessible();
  fireEvent.change(within(dialog).getByLabelText("Find a shortcut"), {
    target: { value: "sidebar" },
  });
  expect(within(dialog).getByText("Toggle sidebar")).toBeTruthy();
  fireEvent.keyDown(within(dialog).getByLabelText("Find a shortcut"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("virtualizes large result sets and filters them without losing relevance order", async () => {
  const many = Array.from(
    { length: 200 },
    (_, index): SearchResult => ({
      id: `item-${index}`,
      title: `Item ${index}`,
      type: index % 2 ? "document" : "file",
      app: index % 2 ? "docs" : "drive",
      href: `/drive/${index}`,
    }),
  );
  render(h(SearchResultsView, { query: "item", results: many }));
  expect(screen.getAllByRole("listitem")).toHaveLength(18);
  const viewport = screen.getByRole("region", { name: "Scrollable search results" });
  fireEvent.scroll(viewport, { target: { scrollTop: 8000 } });
  expect(screen.getAllByRole("listitem")[0]?.getAttribute("aria-posinset")).toBe("98");
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "document" } });
  expect(screen.getByRole("status").textContent).toBe("100 results");
  expect(screen.getAllByRole("link")[0]?.textContent).toContain("Item 1");
  await accessible();
});

it("announces errors and empty results, and lets ArrowUp select See all results", async () => {
  const onSeeAll = vi.fn();
  const failed: SearchSource = {
    async search() {
      throw new Error("Synthetic failure");
    },
  };
  const empty: SearchSource = {
    async search() {
      return { results: [], source: "local", serverSearch: false };
    },
  };
  const view = render(h(GlobalSearch, { source: failed, onOpen: vi.fn(), onSeeAll }));
  const input = screen.getByRole("combobox");
  await act(() => input.focus());
  fireEvent.change(input, { target: { value: "missing" } });
  expect(screen.getByText("Searching…").getAttribute("role")).toBe("status");
  await waitFor(() =>
    expect(screen.getByText("Search couldn't finish. Try another search.")).toBeTruthy(),
  );
  await accessible();
  view.rerender(h(GlobalSearch, { source: empty, onOpen: vi.fn(), onSeeAll }));
  await waitFor(() => expect(screen.getByText("No results for “missing”")).toBeTruthy());
  key("ArrowUp");
  expect(
    screen.getByRole("option", { name: "See all results" }).getAttribute("aria-selected"),
  ).toBe("true");
  key("Enter");
  expect(onSeeAll).toHaveBeenCalledWith("missing", undefined);
  expect(screen.queryByRole("listbox")).toBeNull();
});
