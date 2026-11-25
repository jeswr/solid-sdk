// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { SheetsList } from "../src/apps/sheets/components/sheets-list";
import type { WorkbookSummary } from "../src/apps/sheets/lib/contract";

const state = vi.hoisted(() => ({ list: vi.fn(), offline: false }));
vi.mock("../src/apps/sheets/state/service", () => ({
  useWorkbookService: () => state,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children }: { children: import("react").ReactNode }) => <main>{children}</main>,
}));
vi.mock("../src/apps/sheets/components/sheets-sidebar", () => ({
  SheetsSidebar: () => null,
  workbookHref: (container: string) => `/sheets/s/${encodeURIComponent(container)}`,
}));
vi.mock("../src/apps/sheets/components/share-workbook", () => ({ ShareWorkbook: () => null }));
vi.mock("../src/shell/sync/requires-online", () => ({
  useNeedsConnection: () => ({ disabled: state.offline }),
}));
vi.mock("../src/shell/sync/connection-state", () => ({
  useConnectionState: () => (state.offline ? "offline" : "online"),
}));

const row: WorkbookSummary = {
  title: "Budget",
  container: "https://alice.demo.pod/sheets/budget/",
  created: new Date("2026-11-01T10:00:00Z"),
  modified: new Date("2026-11-01T10:00:00Z"),
  creator: "https://alice.demo.pod/profile/card#me",
  sheetCount: 1,
};
beforeEach(() => {
  state.offline = false;
  state.list.mockReset().mockResolvedValue([row]);
});
afterEach(cleanup);

it("filters names without changing the underlying list and restores results on clear", async () => {
  render(<SheetsList />);
  await screen.findByRole("link", { name: /^Budget/ });
  const search = screen.getByRole("searchbox", { name: "Search spreadsheets" });
  fireEvent.change(search, { target: { value: " bUdGeT " } });
  expect(screen.getByRole("link", { name: /^Budget/ })).toBeTruthy();
  fireEvent.change(search, { target: { value: "Missing" } });
  expect(screen.getByRole("heading", { name: "No results for 'Missing'" })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect((search as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("link", { name: /^Budget/ })).toBeTruthy();
  expect(state.list).toHaveBeenCalledOnce();
});

it("recovers a failed list load with Retry", async () => {
  state.list.mockRejectedValueOnce(new Error("Pod unavailable"));
  render(<SheetsList />);
  await screen.findByRole("alert");
  expect(screen.getByText(/Couldn't load your spreadsheets/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("link", { name: /^Budget/ });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(state.list).toHaveBeenCalledTimes(2);
});

it("shows the first-run action for an empty list and explains offline access", async () => {
  state.offline = true;
  state.list.mockResolvedValue([]);
  render(<SheetsList />);
  await screen.findByRole("heading", { name: "No spreadsheets yet" });
  expect(screen.getByRole("link", { name: "New spreadsheet" }).getAttribute("href")).toBe(
    "/sheets/new",
  );
  expect(screen.getByText(/You're offline/)).toBeTruthy();
});
