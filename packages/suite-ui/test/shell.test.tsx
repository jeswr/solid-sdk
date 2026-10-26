// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DetailsPane,
  defaultShellPreferences,
  parseShellPreferences,
  ShellFrame,
  type ShellPreferences,
  SidebarNav,
  shellDocumentTitle,
  TopBar,
} from "../src/shell/index.js";
import { isShellShortcut } from "../src/shell/preferences.js";

let desktop = true;
const listeners = new Set<() => void>();
const sections = [
  {
    id: "files",
    label: "Files",
    items: [{ id: "drive", label: "My Drive", href: "/drive/my", count: 0, current: true }],
  },
  {
    id: "folders",
    label: "Folders",
    collapsible: true,
    items: [{ id: "work", label: "Work", href: "#work" }],
  },
];
const update = vi.fn();
function Frame({
  initial = defaultShellPreferences,
  hasDetails = true,
}: {
  initial?: ShellPreferences;
  hasDetails?: boolean;
}) {
  const [preferences, setPreferences] = useState(initial);
  return (
    <ShellFrame
      pageTitle="My Drive"
      topBar={{
        appName: "Drive",
        search: <input aria-label="Search" />,
        actions: <button type="button">Upload</button>,
        account: <button type="button">Account</button>,
      }}
      sidebar={{ label: "Drive sections", header: <h2>Drive</h2>, sections }}
      {...(hasDetails
        ? { details: { title: "Budget", metadata: [{ label: "Owner", value: "You" }] } }
        : {})}
      rail={
        <nav aria-label="Apps">
          <a href="/home">Home</a>
        </nav>
      }
      tabBar={
        <nav aria-label="Mobile apps">
          <a href="/home">Home</a>
        </nav>
      }
      preferences={preferences}
      onPreferencesChange={(value) => {
        update(value);
        setPreferences(value);
      }}
    >
      <p>Files saved to your pod</p>
      <textarea aria-label="Editor" />
    </ShellFrame>
  );
}
beforeEach(() => {
  desktop = true;
  update.mockClear();
  vi.stubGlobal("matchMedia", () => ({
    matches: desktop,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => {
  cleanup();
  listeners.clear();
  vi.unstubAllGlobals();
});
async function accessible() {
  const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

describe("shell layout", () => {
  it("provides landmarks, one content title and the document title", async () => {
    render(<Frame />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Drive sections" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "My Drive" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Budget" })).toBeTruthy();
    expect(document.title).toBe("My Drive · Drive · Solid Suite");
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe(
      "#main-content",
    );
    await accessible();
  });
  it("toggles both regions with brackets, exposes choices to the preference consumer and remounts them", async () => {
    const view = render(<Frame />);
    fireEvent.keyDown(document.body, { key: "[" });
    expect(screen.queryByRole("navigation", { name: "Drive sections" })).toBeNull();
    fireEvent.keyDown(document.body, { key: "]" });
    expect(screen.queryByRole("complementary")).toBeNull();
    const saved = update.mock.lastCall?.[0] as ShellPreferences;
    expect(saved).toEqual({ sidebarOpen: false, detailsOpen: false });
    view.unmount();
    render(<Frame initial={saved} />);
    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("complementary")).toBeNull();
    await accessible();
  });
  it("keeps brackets in input, textarea, contenteditable, modified keys and consumed events", () => {
    render(<Frame />);
    for (const name of ["Search", "Editor"])
      fireEvent.keyDown(screen.getByRole("textbox", { name }), { key: "[" });
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    expect(isShellShortcut(new KeyboardEvent("keydown", { key: "[" }), editor)).toBe(false);
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing"])
      fireEvent.keyDown(document.body, { key: "]", [modifier]: true });
    expect(update).not.toHaveBeenCalled();
    expect(
      isShellShortcut(new KeyboardEvent("keydown", { key: "[" }), document.createElement("select")),
    ).toBe(false);
    const consumed = new KeyboardEvent("keydown", { key: "[", cancelable: true });
    consumed.preventDefault();
    expect(isShellShortcut(consumed, document.body)).toBe(false);
  });
  it("returns focus from collapsed desktop regions to their toggles", () => {
    render(<Frame />);
    const sidebarLink = screen.getByRole("link", { name: "Work" });
    sidebarLink.focus();
    fireEvent.keyDown(sidebarLink, { key: "[" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Toggle sidebar" }));

    const detailsClose = screen.getByRole("button", { name: "Close details" });
    detailsClose.focus();
    fireEvent.keyDown(detailsClose, { key: "]" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Toggle details pane" }),
    );
  });
  it("preserves main content focus when collapsing desktop regions", () => {
    render(<Frame />);
    const main = screen.getByRole("main");
    main.focus();
    fireEvent.keyDown(main, { key: "[" });
    fireEvent.keyDown(main, { key: "]" });
    expect(document.activeElement).toBe(main);
  });
  it("does not take shortcuts from another dialog", () => {
    render(
      <>
        <Frame />
        <div role="dialog" aria-label="Editor dialog">
          <button type="button">Editor action</button>
        </div>
      </>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Editor action" }), { key: "[" });
    expect(update).not.toHaveBeenCalled();
  });
  it("has no details control when details are absent", async () => {
    render(<Frame hasDetails={false} />);
    expect(screen.queryByRole("button", { name: "Toggle details pane" })).toBeNull();
    await accessible();
  });
  it("opens responsive dialogs, closes with Escape, restores focus and does not stack drawers", async () => {
    desktop = false;
    render(<Frame />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    toggle.focus();
    fireEvent.click(toggle);
    const drawer = screen.getByRole("dialog", { name: "Drive sections" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await accessible();
    fireEvent.keyDown(document.activeElement ?? drawer, { key: "]" });
    expect(screen.queryByRole("dialog", { name: "Drive sections" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Details" })).toBeTruthy();
    await accessible();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Details" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Toggle details pane" }),
      ),
    );
  });
  it("closes a drawer after native link activation and follows breakpoints", async () => {
    desktop = false;
    render(<Frame />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Work" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => {
      desktop = true;
      for (const listener of listeners) listener();
    });
    expect(screen.queryByRole("navigation", { name: "Drive sections" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(screen.getByRole("navigation", { name: "Drive sections" })).toBeTruthy();
  });
});

it("renders section counts, current anchors and keyboard collapsible groups", async () => {
  render(
    <>
      <h1>Navigation fixture</h1>
      <SidebarNav label="Drive sections" header={<h2>Drive</h2>} sections={sections} />
    </>,
  );
  expect(screen.getByRole("link", { name: "My Drive 0" }).getAttribute("aria-current")).toBe(
    "page",
  );
  const group = screen.getByRole("button", { name: "Folders" });
  fireEvent.click(group);
  expect(screen.queryByRole("link", { name: "Work" })).toBeNull();
  expect(group.getAttribute("aria-expanded")).toBe("false");
  await accessible();
  fireEvent.click(group);
  expect(screen.getByRole("link", { name: "Work" }).getAttribute("href")).toBe("#work");
  await accessible();
});
it.each([false, true])("supports all TopBar slots and refresh state %s", async (refreshing) => {
  render(
    <>
      <TopBar
        appName="Drive"
        context={
          <nav aria-label="Current folder">
            <a href="/drive/work">Work</a>
          </nav>
        }
        search={<input aria-label="Search Drive" />}
        actions={<button type="button">Upload</button>}
        offlinePill={<span role="status">Offline — showing saved copies</span>}
        bell={<button type="button">Notifications</button>}
        account={<button type="button">Account</button>}
        refreshing={refreshing}
        back={{ href: "/drive/my", label: "Back to My Drive" }}
      />
      <main>
        <h1>My Drive</h1>
      </main>
    </>,
  );
  expect(screen.getByRole("navigation", { name: "Current folder" })).toBeTruthy();
  expect(screen.queryByRole("status", { name: "Refreshing content" }) !== null).toBe(refreshing);
  expect(screen.getByRole("link", { name: "Back to My Drive" }).getAttribute("href")).toBe(
    "/drive/my",
  );
  await accessible();
});
it.each([
  "ready",
  "loading",
  "first-use",
  "filtered",
  "forbidden",
  "unreachable",
])("composes accessible details state: %s", async (state) => {
  render(
    <>
      <main>
        <h1>My Drive</h1>
      </main>
      <DetailsPane
        title="File details"
        {...(state === "ready"
          ? {
              metadata: [{ label: "Owner", value: "You" }],
              access: <p>Only you</p>,
              actions: <button type="button">Share</button>,
            }
          : {})}
      >
        {state !== "ready" && (
          <div role={state === "forbidden" || state === "unreachable" ? "alert" : "status"}>
            {state}
          </div>
        )}
      </DetailsPane>
    </>,
  );
  await accessible();
});
it("validates saved preferences without accepting malformed fields", () => {
  expect(parseShellPreferences(null)).toEqual(defaultShellPreferences);
  expect(parseShellPreferences({ sidebarOpen: "false", detailsOpen: 1 })).toEqual(
    defaultShellPreferences,
  );
  expect(parseShellPreferences({ sidebarOpen: false, detailsOpen: true, ignored: true })).toEqual({
    sidebarOpen: false,
    detailsOpen: true,
  });
  expect(shellDocumentTitle("Budget", "Docs")).toBe("Budget · Docs · Solid Suite");
});
