// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import {
  SheetNotFound,
  SheetsAccessNotice,
  SheetsEmpty,
  SheetsLoadError,
} from "../src/apps/sheets/components/sheets-states";

afterEach(cleanup);

it("offers a native create link for a first spreadsheet", () => {
  render(<SheetsEmpty query="" onClear={vi.fn()} />);
  expect(screen.getByRole("heading").textContent).toBe("No spreadsheets yet");
  expect(screen.getByRole("link", { name: "New spreadsheet" }).getAttribute("href")).toBe(
    "/sheets/new",
  );
  expect(screen.getByRole("status").getAttribute("data-variant")).toBe("first-use");
});

it("describes a search miss and clears the query", () => {
  const clear = vi.fn();
  render(<SheetsEmpty query="Budget" onClear={clear} />);
  expect(screen.getByRole("heading").textContent).toBe("No results for 'Budget'");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(clear).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link")).toBeNull();
});

it.each([
  false,
  true,
])("offers Retry and a way back after a load failure (offline=%s)", (offline) => {
  const retry = vi.fn();
  render(<SheetsLoadError offline={offline} onRetry={retry} message="Couldn't open your data." />);
  expect(screen.getByRole("alert").getAttribute("data-category")).toBe(
    offline ? "offline" : "unreachable",
  );
  expect(screen.getByText("Couldn't open your data.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Back to spreadsheets" }).getAttribute("href")).toBe(
    "/sheets",
  );
});

it("explains a missing workbook and links back to the list", () => {
  render(<SheetNotFound />);
  expect(screen.getByRole("alert").getAttribute("data-category")).toBe("not-found");
  expect(screen.getByText(/spreadsheet may have been moved or deleted/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to spreadsheets" }).getAttribute("href")).toBe(
    "/sheets",
  );
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])("explains offline and view-only access independently (offline=%s, readOnly=%s)", (offline, readOnly) => {
  const view = render(<SheetsAccessNotice offline={offline} readOnly={readOnly} />);
  expect(!!screen.queryByText(/You're offline/)).toBe(offline);
  expect(!!screen.queryByText(/View only/)).toBe(readOnly);
  if (!offline && !readOnly) expect(view.container.childElementCount).toBe(0);
  else expect(screen.getByRole("status")).toBeTruthy();
});
