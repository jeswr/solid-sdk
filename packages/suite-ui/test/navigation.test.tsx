// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppLauncher,
  AppRail,
  BottomTabBar,
  defaultRailPins,
  type NavigationError,
  type RailPreferences,
  type RailPreferencesBinding,
  RailPreferencesProvider,
  suiteApps,
} from "../src/index.js";
import { navigationErrorCopy } from "../src/navigation/states.js";

const create = vi.fn();
const update = vi.fn();
const retry = vi.fn();
function Harness({
  children,
  initial = defaultRailPins,
  status = "ready",
  error,
}: {
  children?: React.ReactNode;
  initial?: RailPreferences["pinned"];
  status?: RailPreferencesBinding["status"];
  error?: NavigationError;
}) {
  const [value, setValue] = useState<RailPreferences>({ pinned: initial });
  return (
    <RailPreferencesProvider
      value={{
        value,
        update: (next) => {
          update(next);
          setValue(next);
        },
        retry,
        status,
        ...(error ? { error } : {}),
      }}
    >
      {children ?? (
        <AppLauncher
          currentApp="drive"
          apps={suiteApps.map((app) =>
            app.slug === "docs"
              ? { ...app, create: [{ id: "document", label: "New document", onSelect: create }] }
              : app,
          )}
        />
      )}
    </RailPreferencesProvider>
  );
}
async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Apps" }));
  return user;
}
async function accessible() {
  // jsdom has no layout engine; contrast/reflow are covered in the browser matrix.
  const results = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("AppLauncher", () => {
  it("tabs into the grid, moves by column/row, keeps one tab stop, and returns focus on Escape", async () => {
    render(<Harness />);
    const user = await open();
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Filter apps" }));
    await user.tab();
    const grid = screen.getByRole("grid", { name: "Available apps" });
    expect(document.activeElement).toBe(within(grid).getByRole("link", { name: "Home" }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(grid).getByRole("link", { name: "Drive" }));
    expect(document.activeElement?.getAttribute("aria-current")).toBe("page");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(within(grid).getByRole("link", { name: "Drive" }));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(within(grid).getByRole("link", { name: "Permissions" }));
    await user.keyboard("{ArrowUp}{ArrowLeft}");
    expect(document.activeElement).toBe(within(grid).getByRole("link", { name: "Home" }));
    expect(grid.querySelectorAll('a[tabindex="0"]')).toHaveLength(1);
    await accessible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apps" }));
  });
  it("filters while typing from the grid, handles no results, and clears the filter", async () => {
    render(<Harness />);
    const user = await open();
    await user.keyboard("{ArrowDown}doc");
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    expect(screen.getByRole("searchbox").getAttribute("value")).toBe("doc");
    expect(screen.getAllByRole("gridcell")).toHaveLength(1);
    await user.type(screen.getByRole("searchbox"), "missing");
    expect(screen.getByText("No results for 'docmissing'")).toBeTruthy();
    await accessible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("gridcell")).toHaveLength(5);
  });
  it("uses native links for Enter navigation, closes and invokes registered Create actions", async () => {
    render(<Harness />);
    const user = await open();
    const docs = screen.getByRole("link", { name: "Docs" });
    expect(docs.getAttribute("href")).toBe("/docs");
    const navigate = vi.fn((event: Event) => event.preventDefault());
    docs.addEventListener("click", navigate);
    docs.focus();
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apps" }));
    await user.click(screen.getByRole("button", { name: "New document" }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("hides backlog apps by default and shows a collapsed Coming soon group only for flag 1", async () => {
    render(<Harness />);
    let user = await open();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.queryByRole("link", { name: "Calendar" })).toBeNull();
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "1");
    render(<Harness />);
    user = await open();
    const summary = screen.getByText("Coming soon");
    expect(summary.closest("details")?.open).toBe(false);
    await user.click(summary);
    expect(screen.getByRole("link", { name: "Calendar" }).getAttribute("href")).toBe("/calendar");
    await accessible();
  });
  it("offers a first-use pin action while retaining app navigation", async () => {
    render(<Harness initial={[]} />);
    const user = await open();
    expect(screen.getByText("No apps pinned yet")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Choose apps" }));
    await user.click(screen.getByRole("checkbox", { name: "Docs" }));
    expect(update).toHaveBeenLastCalledWith({ pinned: ["docs"] });
    await accessible();
  });
  it("supports checkboxes, keyboard reorder, drag pin/reorder and enforces the six-app limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "1");
    render(<Harness />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Customise rail" }));
    await user.click(screen.getByRole("checkbox", { name: "Calendar" }));
    expect(update).toHaveBeenLastCalledWith({ pinned: [...defaultRailPins, "calendar"] });
    expect((screen.getByRole("checkbox", { name: "Contacts" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Move Calendar up" }));
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["home", "drive", "docs", "tasks", "calendar", "permissions"],
    });
    await user.click(screen.getByRole("checkbox", { name: "Home" }));
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["drive", "docs", "tasks", "calendar", "permissions"],
    });
    const docs = screen.getByRole("checkbox", { name: "Docs" }).closest("li");
    fireEvent.drop(docs as HTMLElement, { dataTransfer: { getData: () => "docs" } });
    expect(update).toHaveBeenCalledTimes(3);
    fireEvent.drop(docs as HTMLElement, { dataTransfer: { getData: () => "contacts" } });
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["drive", "contacts", "docs", "tasks", "calendar", "permissions"],
    });
    fireEvent.drop(docs as HTMLElement, { dataTransfer: { getData: () => "money" } });
    expect(update).toHaveBeenCalledTimes(4);
    fireEvent.drop(docs as HTMLElement, { dataTransfer: { getData: () => "permissions" } });
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["drive", "contacts", "permissions", "docs", "tasks", "calendar"],
    });
    await accessible();
  });
  it("preserves hidden saved pins through checkbox, keyboard and drag edits", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "0");
    const { rerender } = render(<Harness initial={["home", "calendar", "drive", "docs"]} />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Customise rail" }));
    expect(screen.queryByRole("checkbox", { name: "Calendar" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Docs" }));
    expect(update).toHaveBeenLastCalledWith({ pinned: ["home", "calendar", "drive"] });
    await user.click(screen.getByRole("checkbox", { name: "Tasks" }));
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["home", "calendar", "drive", "tasks"],
    });
    await user.click(screen.getByRole("button", { name: "Move Home down" }));
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["calendar", "drive", "home", "tasks"],
    });
    await user.click(screen.getByRole("button", { name: "Move Home up" }));
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["calendar", "home", "drive", "tasks"],
    });
    const home = screen.getByRole("checkbox", { name: "Home" }).closest("li");
    fireEvent.drop(home as HTMLElement, { dataTransfer: { getData: () => "tasks" } });
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["calendar", "tasks", "home", "drive"],
    });
    fireEvent.drop(home as HTMLElement, { dataTransfer: { getData: () => "docs" } });
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["calendar", "tasks", "docs", "home", "drive"],
    });
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "1");
    rerender(<Harness />);
    expect((screen.getByRole("checkbox", { name: "Calendar" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it("counts hidden pins toward the checkbox and drag pin limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "0");
    render(<Harness initial={["home", "calendar", "drive", "docs", "tasks", "contacts"]} />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Customise rail" }));
    expect(screen.getByText("6 of 6 apps pinned")).toBeTruthy();
    const permissions = screen.getByRole("checkbox", { name: "Permissions" }) as HTMLInputElement;
    expect(permissions.disabled).toBe(true);
    await user.click(permissions);
    const home = screen.getByRole("checkbox", { name: "Home" }).closest("li");
    fireEvent.drop(home as HTMLElement, { dataTransfer: { getData: () => "permissions" } });
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "Docs" }));
    expect(permissions.disabled).toBe(false);
    fireEvent.drop(home as HTMLElement, { dataTransfer: { getData: () => "permissions" } });
    expect(update).toHaveBeenLastCalledWith({
      pinned: ["permissions", "home", "calendar", "drive", "tasks", "contacts"],
    });
    expect(permissions.disabled).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Docs" }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });
  // AUTHORED-BY Claude Opus 5.5
  it.each([
    ["loading", undefined],
    ["ready", "unreachable"],
  ] as const)("makes an open customise panel read-only while preferences are %s %s", async (status, error) => {
    const { rerender } = render(<Harness />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Customise rail" }));
    expect(screen.getByRole("checkbox", { name: "Docs" })).toBeTruthy();
    rerender(<Harness status={status} {...(error ? { error } : {})} />);
    const panel = screen.getByRole("region", { name: "Customise rail" });
    expect(panel.getAttribute("aria-disabled")).toBe("true");
    expect(within(panel).getByRole("group").hasAttribute("disabled")).toBe(true);
    expect(
      within(panel).getByText("Rail settings are unavailable until your app preferences load"),
    ).toBeTruthy();
    const docs = within(panel).getByRole("checkbox", { name: "Docs" });
    await user.click(docs);
    fireEvent.click(docs);
    fireEvent.click(within(panel).getByRole("button", { name: "Move Docs up" }));
    fireEvent.drop(docs.closest("li") as HTMLElement, {
      dataTransfer: { getData: () => "permissions" },
    });
    expect(update).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Customise rail" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it.each([
    "loading",
    "refreshing",
    "saving",
  ] as const)("renders accessible %s state", async (status) => {
    render(<Harness status={status} />);
    await open();
    if (status === "loading")
      expect(screen.getByRole("status", { name: "Loading apps" })).toBeTruthy();
    else expect(screen.getByRole("grid")).toBeTruthy();
    await accessible();
  });
  it.each(
    Object.keys(navigationErrorCopy) as NavigationError[],
  )("renders classified %s error with retry", async (error) => {
    render(<Harness error={error} />);
    const user = await open();
    expect(screen.getByRole("alert").textContent).toContain(navigationErrorCopy[error]);
    expect(screen.queryByRole("grid")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    await accessible();
  });
});

describe("AppRail and BottomTabBar", () => {
  it("renders six unique visible pins maximum, hides backlog pins, and has labelled bottom slots", async () => {
    render(
      <Harness initial={["drive", "drive", "calendar", "home", "docs", "tasks", "permissions"]}>
        <AppRail
          currentApp="drive"
          notifications={<button type="button">Notifications</button>}
          offline={<button type="button">Offline</button>}
          account={<button type="button">Account menu</button>}
        />
      </Harness>,
    );
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Drive" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "More apps" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    await accessible();
  });
  it("caps flagged pins at six and opens the launcher from More", async () => {
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", "1");
    render(
      <Harness initial={[...defaultRailPins, "calendar", "contacts"]}>
        <AppRail currentApp="drive" />
      </Harness>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(6);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More apps" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More apps" }));
  });
  it("keeps the four specified mobile apps even when desktop pins change", async () => {
    render(
      <Harness initial={["permissions"]}>
        <BottomTabBar currentApp="tasks" />
      </Harness>,
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Drive",
      "Docs",
      "Tasks",
    ]);
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More apps" }));
    await accessible();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More apps" }));
  });
  it.each([
    undefined,
    "0",
    "true",
    "1",
  ])("filters backlog mobile links with flag %s while preserving fixed app slots", async (flag) => {
    vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", flag);
    render(
      <Harness>
        <BottomTabBar
          currentApp="docs"
          apps={suiteApps
            .filter((app) => app.slug !== "tasks")
            .map((app) => (app.slug === "docs" ? { ...app, status: "backlog" } : app))}
        />
      </Harness>,
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      flag === "1" ? ["Home", "Drive", "Docs"] : ["Home", "Drive"],
    );
    if (flag === "1") {
      const docs = screen.getByRole("link", { name: "Docs" });
      expect(docs.getAttribute("href")).toBe("/docs");
      expect(docs.getAttribute("aria-current")).toBe("page");
    }
    expect(screen.getByRole("button", { name: "More apps" })).toBeTruthy();
    await accessible();
  });
});
