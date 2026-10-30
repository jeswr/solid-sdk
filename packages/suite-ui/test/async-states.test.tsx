// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import {
  CollectionPlaceholder,
  type CollectionState,
} from "../src/collections/collection-state.js";
import { type ErrorCategory, errorActionLabels } from "../src/components/async-copy.js";
import { EmptyState, type EmptyVariant } from "../src/components/empty-state.js";
import {
  type ClassifiedError,
  type ErrorRecovery,
  ErrorState,
} from "../src/components/error-state.js";
import { type LoadingPreset, LoadingSkeleton } from "../src/components/loading-skeleton.js";
import { renderAsync } from "../src/components/render-async.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function accessible(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
const cases: [ErrorCategory, string, string[]][] = [
  ["reauth", "Sign in to continue", ["Sign in"]],
  ["forbidden", "You don't have access to this", ["Request access", "Switch account"]],
  ["not-found", "This item isn't here any more", ["Go to parent", "Home"]],
  ["conflict", "This item changed somewhere else", ["Review changes"]],
  ["name-taken", "A file with this name already exists", []],
  ["quota", "Your pod is full", ["Manage storage"]],
  ["too-large", "This file is too large for your storage", []],
  ["offline", "Not available offline", ["Retry"]],
  ["unreachable", "Can't reach your storage", ["Retry", "Show saved copies"]],
  ["unsupported", "Not available on this storage", []],
  ["unknown", "Something went wrong", ["Reload", "Report a problem"]],
];
test.each(
  cases,
)("%s renders exact §9 copy, recovery actions and alert", async (category, copy, labels) => {
  const handler = vi.fn<() => void>();
  const actions = Object.fromEntries(
    Object.keys(errorActionLabels).map((name) => [name, handler]),
  ) as ErrorRecovery;
  const { container } = render(<ErrorState error={category} actions={actions} accessRequests />);
  expect(screen.getByRole("heading", { name: copy }).textContent).toBe(copy);
  expect(screen.getByRole("alert").textContent).toContain(copy);
  expect(screen.queryAllByRole("button").map((button) => button.textContent)).toEqual(labels);
  for (const label of labels) fireEvent.click(screen.getByRole("button", { name: label }));
  expect(handler).toHaveBeenCalledTimes(labels.length);
  if (category === "reauth")
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  await accessible(container);
});
test("access requests require the capability and navigation renders native links", async () => {
  const { rerender, container } = render(
    <ErrorState
      error="forbidden"
      actions={{ requestAccess: vi.fn<() => void>(), switchAccount: vi.fn<() => void>() }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  rerender(<ErrorState error="not-found" actions={{ goToParent: "/drive", home: "/" }} />);
  expect(screen.getByRole("link", { name: "Go to parent" }).getAttribute("href")).toBe("/drive");
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  rerender(
    <ErrorState
      error="unknown"
      actions={{ report: "https://github.com/jeswr/solid-sdk/issues/new" }}
    />,
  );
  expect(screen.getByRole("link", { name: "Report a problem" }).getAttribute("href")).not.toContain(
    "body=",
  );
  expect(container.textContent).not.toContain("http");
  await accessible(container);
  rerender(<ErrorState error="unknown" actions={{ report: "javascript:alert(1)" }} />);
  expect(screen.queryByRole("link")).toBeNull();
});
test("retry respects retryAfterMs and cleans up its timer", async () => {
  vi.useFakeTimers();
  const retry = vi.fn<() => void>();
  const { unmount } = render(
    <ErrorState error={{ category: "unreachable", retryAfterMs: 8000 }} actions={{ retry }} />,
  );
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(7999));
  expect(button.disabled).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("a long Retry-After does not overflow to an immediate retry", async () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <ErrorState
      error={{ category: "unreachable", retryAfterMs: 3_000_000_000 }}
      actions={{ retry: vi.fn<() => void>() }}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(true);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("a repeated error with the same Retry-After starts a new wait", async () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  const error: ClassifiedError = { category: "unreachable", retryAfterMs: 8000 };
  const { rerender, unmount } = render(<ErrorState error={error} actions={{ retry }} />);
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(button.disabled).toBe(false);
  rerender(<ErrorState error={{ ...error }} actions={{ retry }} />);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(7999));
  expect(button.disabled).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1));
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("an in-flight replacement cancels the old timer and stable errors keep their deadline", async () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  const initialError: ClassifiedError = { category: "unreachable", retryAfterMs: 8000 };
  const { rerender, unmount } = render(<ErrorState error={initialError} actions={{ retry }} />);
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  await act(() => vi.advanceTimersByTimeAsync(4000));
  const nextError = { ...initialError };
  rerender(<ErrorState error={nextError} actions={{ retry }} />);
  expect(vi.getTimerCount()).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(button.disabled).toBe(true);
  rerender(<ErrorState error={nextError} actions={{ retry: vi.fn<() => void>() }} />);
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(button.disabled).toBe(false);
  rerender(<ErrorState error={nextError} actions={{ retry }} />);
  expect(button.disabled).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("collection retries keep the current deadline and restart for a new error occurrence", async () => {
  vi.useFakeTimers();
  const onRetry = vi.fn();
  const state: CollectionState = { status: "error", kind: "unreachable", retryAfterMs: 8000 };
  const { rerender, unmount } = render(
    <CollectionPlaceholder kind="table" count={0} state={state} onRetry={onRetry} />,
  );
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  await act(() => vi.advanceTimersByTimeAsync(4000));
  rerender(<CollectionPlaceholder kind="table" count={1} state={state} onRetry={onRetry} />);
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(button.disabled).toBe(false);
  rerender(<CollectionPlaceholder kind="table" count={1} state={{ ...state }} onRetry={onRetry} />);
  expect(button.disabled).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(8000));
  fireEvent.click(button);
  expect(onRetry).toHaveBeenCalledOnce();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
const emptyCases: [EmptyVariant, string][] = [
  ["first-use", "No files yet"],
  ["no-results", "No results for 'summer'"],
  ["filtered-empty", "No results for 'summer'"],
  ["no-access", "You don't have access to this"],
  ["not-available-offline", "Not available offline"],
];
test.each(
  emptyCases,
)("%s empty state has a status region and accessible anatomy", async (variant, title) => {
  const { container } = render(
    <EmptyState
      variant={variant}
      query="summer"
      onClearFilters={vi.fn<() => void>()}
      onRetry={vi.fn<() => void>()}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(title);
  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  await accessible(container);
});
test("empty actions support keyboard activation and clear filters", async () => {
  const primary = vi.fn<() => void>();
  const secondary = vi.fn<() => void>();
  const clear = vi.fn<() => void>();
  const user = userEvent.setup();
  const { rerender } = render(
    <EmptyState
      title="No documents yet"
      body="Create a document to get started."
      primaryAction={
        <button type="button" onClick={primary}>
          Create a document
        </button>
      }
      secondaryAction={
        <button type="button" onClick={secondary}>
          Import a document
        </button>
      }
    />,
  );
  await user.tab();
  await user.keyboard("{Enter}");
  await user.tab();
  await user.keyboard(" ");
  expect(primary).toHaveBeenCalledOnce();
  expect(secondary).toHaveBeenCalledOnce();
  rerender(<EmptyState variant="filtered-empty" query="" onClearFilters={clear} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(clear).toHaveBeenCalledOnce();
});
test.each<LoadingPreset>([
  "list",
  "grid",
  "document",
  "detail",
  "table",
])("%s skeleton announces loading and uses layout height tokens", async (preset) => {
  const { container } = render(<LoadingSkeleton preset={preset} count={3} />);
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(container.querySelectorAll(".suite-loading-row")).toHaveLength(3);
  expect(container.querySelector(".suite-loading-layout")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  const css = readFileSync("src/styles/components.css", "utf8");
  expect(css).toMatch(/\.suite-loading-row\s*\{[^}]*height: var\(--row-h\)/);
  expect(css).toMatch(
    /\.suite-loading-grid \.suite-loading-row\s*\{[^}]*height: var\(--row-h-grid-card\)/,
  );
  expect(css).toMatch(/\.suite-loading-header\s*\{[^}]*height: var\(--control-h\)/);
  await accessible(container);
});
test("renderAsync prioritises first-load, error, empty, then lazily renders content", () => {
  const children = vi.fn(() => "content");
  expect(renderAsync({ loading: "loading", error: "error", empty: "empty", children })).toBe(
    "loading",
  );
  expect(renderAsync({ loading: false, error: "error", empty: "empty", children })).toBe("error");
  expect(renderAsync({ error: null, empty: "empty", children })).toBe("empty");
  expect(children).not.toHaveBeenCalled();
  expect(renderAsync({ children })).toBe("content");
  expect(children).toHaveBeenCalledOnce();
});
