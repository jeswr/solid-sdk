// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Toaster, toast, toastDurations } from "../src/components/ui/sonner.js";

beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.useRealTimers();
});
test("message updates an existing ID without leaving stale entries", () => {
  const id = toast.message("Saving…", { id: "message-update" });
  expect(toast.message("Saved", { id, duration: 1 })).toBe(id);
  expect(toast.getToasts().filter((entry) => entry.id === id)).toMatchObject([
    { title: { props: { role: "status", children: "Saved" } }, duration: 1 },
  ]);
});
test("message restores a dismissed ID to the active toasts", () => {
  const id = toast.message("Saving…", { id: "message-restore" });
  toast.dismiss(id);
  expect(toast.getToasts().filter((entry) => entry.id === id)).toEqual([]);
  expect(toast.message("Saved", { id })).toBe(id);
  expect(toast.getToasts().filter((entry) => entry.id === id)).toMatchObject([
    { title: { props: { role: "status", children: "Saved" } }, duration: 5000 },
  ]);
});
test("normal and Undo toasts default to 5s and 8s; errors persist and can be dismissed", async () => {
  vi.useFakeTimers();
  const undo = vi.fn();
  render(<Toaster />);
  let normal: string | number = "";
  let withUndo: string | number = "";
  let error: string | number = "";
  act(() => {
    normal = toast.success("Link copied");
    withUndo = toast("Moved to trash", { action: { label: "Undo", onClick: undo } });
    error = toast.error("Can't reach your storage", { duration: 1 });
  });
  expect(toast.getHistory().find((entry) => entry.id === normal)).toMatchObject({ duration: 5000 });
  expect(toast.getHistory().find((entry) => entry.id === withUndo)).toMatchObject({
    duration: 8000,
  });
  expect(toast.getHistory().find((entry) => entry.id === error)).toMatchObject({
    duration: Infinity,
    closeButton: true,
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("alert").textContent).toBe("Can't reach your storage");
  expect(screen.getAllByRole("status").map((entry) => entry.textContent)).toContain("Link copied");
  await act(() => vi.advanceTimersByTimeAsync(5200));
  expect(screen.queryByText("Link copied")).toBeNull();
  expect(screen.getByText("Moved to trash")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(screen.getByText("Can't reach your storage")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close toast" }));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(screen.queryByText("Can't reach your storage")).toBeNull();
});
test.each([
  "text",
  "React-node",
] as const)("an ID update without action preserves the 8s %s Undo window", async (label) => {
  vi.useFakeTimers();
  render(<Toaster />);
  let id: string | number = "";
  act(() => {
    id = toast("Moved to trash", {
      ...(label === "React-node" ? { duration: toastDurations.undo } : {}),
      action: { label: label === "text" ? "Undo" : <span>Undo</span>, onClick: vi.fn() },
    });
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  act(() => {
    expect(toast.success("Move complete", { id })).toBe(id);
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 8000 });
  await act(() => vi.advanceTimersByTimeAsync(7900));
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(screen.queryByText("Move complete")).toBeNull();
});
test.each([
  undefined,
  null,
])("an ID update with action: %s restores the normal duration", async (action) => {
  vi.useFakeTimers();
  render(<Toaster />);
  let id: string | number = "";
  act(() => {
    id = toast("Moved to trash", {
      duration: toastDurations.undo,
      action: { label: <span>Undo</span>, onClick: vi.fn() },
    });
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  act(() => {
    toast.success("Move complete", { id, action });
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    action,
    duration: 5000,
  });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5300));
  expect(screen.queryByText("Move complete")).toBeNull();
});
test.each([
  1200,
  12000,
  Infinity,
])("an ID update honours an explicit duration of %s", (duration) => {
  const id = toast("Moved to trash", { action: { label: "Undo", onClick: vi.fn() } });
  toast.success("Move complete", { id, duration });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    action: { label: "Undo" },
    duration,
  });
  toast.success("Move confirmed", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration });
});
test("a success update to a persistent error returns to the normal duration", () => {
  const id = toast.error("Couldn't save");
  toast.success("Saved", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 5000 });
});
test("promise errors inherit persistence and an alert announcement", async () => {
  render(<Toaster />);
  await act(async () => {
    toast.promise(Promise.reject(new Error("private diagnostic")), {
      loading: "Saving…",
      error: "Couldn't save",
    });
    await Promise.resolve();
  });
  expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save");
  expect(toast.getHistory().at(-1)).toMatchObject({ duration: Infinity });
  expect(document.body.textContent).not.toContain("private diagnostic");
});
test.each([
  "default",
  "success",
  "info",
  "warning",
  "message",
  "custom",
] as const)("%s preserves the explicit Undo window for a React-node action label", (kind) => {
  const data = {
    duration: toastDurations.undo,
    action: { label: <span>Undo</span>, onClick: vi.fn() },
  };
  const id =
    kind === "default"
      ? toast("Moved to trash", data)
      : kind === "custom"
        ? toast.custom(() => <span>Moved to trash</span>, data)
        : toast[kind]("Moved to trash", data);
  expect(toast.getHistory().find((entry) => entry.id === id)).toMatchObject({ duration: 8000 });
});
test("a React-node Undo action remains available beyond five seconds", async () => {
  vi.useFakeTimers();
  const undo = vi.fn();
  render(<Toaster />);
  act(() => {
    toast("Moved to trash", {
      duration: toastDurations.undo,
      action: { label: <span>Undo</span>, onClick: undo },
    });
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(5200));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();
});
test.each([
  "shared",
  "result",
] as const)("promise success preserves the %s Undo window for a React-node label", async (source) => {
  const undoOptions = {
    duration: toastDurations.undo,
    action: { label: <span>Undo</span>, onClick: vi.fn() },
  };
  await act(async () => {
    toast.promise(Promise.resolve("Saved"), {
      loading: "Saving…",
      ...(source === "shared" ? undoOptions : {}),
      success: (message) => ({ message, ...(source === "result" ? undoOptions : {}) }),
    });
    await Promise.resolve();
  });
  expect(toast.getHistory().at(-1)).toMatchObject({ duration: 8000 });
});
test("error persistence takes precedence over an explicit Undo window", async () => {
  const data = {
    duration: toastDurations.undo,
    action: { label: <span>Undo</span>, onClick: vi.fn() },
  };
  const id = toast.error("Couldn't save", data);
  expect(toast.getHistory().find((entry) => entry.id === id)).toMatchObject({
    duration: Infinity,
    closeButton: true,
  });
  await act(async () => {
    toast.promise(Promise.reject(new Error("Save failed")), {
      ...data,
      loading: "Saving…",
      error: { message: "Couldn't save", ...data },
    });
    await Promise.resolve();
  });
  expect(toast.getHistory().at(-1)).toMatchObject({ duration: Infinity, closeButton: true });
});
test("toast markup passes axe for success, Undo and persistent error", async () => {
  const { container } = render(<Toaster />);
  act(() => {
    toast.success("Link copied");
    toast("Moved to trash", { action: { label: "Undo", onClick: vi.fn() } });
    toast.error("Can't reach your storage");
  });
  await screen.findByRole("alert");
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
