// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { MouseEvent } from "react";
import { toast as sonnerToast } from "sonner";
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
  vi.restoreAllMocks();
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
test.each([
  "default",
  "loading",
] as const)("%s → Undo → success keeps the full 8s window", async (kind) => {
  vi.useFakeTimers();
  render(<Toaster />);
  const id = `undo-update-${kind}`;
  act(() => {
    if (kind === "default") toast("Moving", { id });
    else toast.loading("Moving", { id });
    toast("Moved", { id, action: { label: "Undo", onClick: vi.fn() } });
    toast.success("Confirmed", { id });
  });
  expect(toast.getToasts().filter((entry) => entry.id === id)).toEqual(
    expect.arrayContaining([expect.objectContaining({ duration: 8000 })]),
  );
  await act(() => vi.advanceTimersByTimeAsync(5200));
  expect(screen.getByText("Confirmed")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(3100));
  expect(screen.queryByText("Confirmed")).toBeNull();
});
test.each([
  "default",
  "success",
  "error",
  "info",
  "warning",
  "loading",
  "message",
  "custom",
] as const)("%s records Undo and explicit durations without reading Sonner history", (kind) => {
  vi.spyOn(sonnerToast, "getHistory").mockImplementation(() => {
    throw new Error("Toast policy must not read Sonner history");
  });
  const create = (data: Parameters<typeof toast>[1]) =>
    kind === "default"
      ? toast("Moved", data)
      : kind === "custom"
        ? toast.custom(() => <span>Moved</span>, data)
        : toast[kind]("Moved", data);
  const id = create({ action: { label: "Undo", onClick: vi.fn() } });
  toast.success("Confirmed", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 8000 });
  create({ id, duration: 12000 });
  toast.success("Confirmed again", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 12000 });
});
test("loading with Undo retains its window on a success update", () => {
  const id = toast.loading("Moving", { action: { label: "Undo", onClick: vi.fn() } });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 8000 });
  toast.success("Moved", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({ duration: 8000 });
});
test.each([
  undefined,
  null,
  { label: "Open", onClick: vi.fn() },
])("replacing Undo with %s recalculates subsequent updates", (action) => {
  const id = toast("Moving");
  toast("Moved", { id, action: { label: "Undo", onClick: vi.fn() } });
  toast.info("Action changed", { id, action });
  toast.success("Confirmed", { id });
  const expectedAction = action ? { ...action, onClick: expect.any(Function) } : action;
  expect(toast.getToasts().filter((entry) => entry.id === id)).toEqual([
    expect.objectContaining({ action: expectedAction, duration: 5000 }),
    expect.objectContaining({ action: expectedAction, duration: 5000 }),
  ]);
});
test.each(["id", "all"] as const)("dismiss(%s) clears Undo and explicit duration state", (kind) => {
  const id = toast("Moved", {
    id: `dismiss-reset-${kind}`,
    action: { label: "Undo", onClick: vi.fn() },
    duration: 12000,
  });
  if (kind === "id") toast.dismiss(id);
  else toast.dismiss();
  toast.success("Fresh toast", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    duration: 5000,
    action: undefined,
  });
});
test.each([
  { kind: "default", button: "action" },
  { kind: "default", button: "cancel" },
  { kind: "promise-loading", button: "action" },
  { kind: "promise-loading", button: "cancel" },
  { kind: "promise", button: "action" },
  { kind: "promise", button: "cancel" },
] as const)("$kind clears state after clicking $button before reusing the ID", async ({
  kind,
  button,
}) => {
  vi.useFakeTimers();
  render(<Toaster />);
  const callback = vi.fn();
  const data = {
    action: { label: "Undo", onClick: button === "action" ? callback : vi.fn() },
    ...(button === "cancel"
      ? { cancel: { label: "Cancel", onClick: callback }, duration: 12000 }
      : {}),
  };
  await act(async () => {
    if (kind === "default") toast("Moved", data);
    else {
      await toast
        .promise(Promise.resolve("Moved"), {
          ...data,
          ...(kind === "promise-loading" ? { loading: "Moving" } : {}),
          success: "Moved",
        })
        .unwrap();
    }
  });
  const entry = toast.getToasts().at(-1);
  if (!entry) throw new Error("Expected a toast");
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByRole("button", { name: button === "action" ? "Undo" : "Cancel" }));
  expect(callback).toHaveBeenCalledOnce();
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: "click" }));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(screen.queryByText("Moved")).toBeNull();
  act(() => {
    toast.success("Fresh toast", { id: entry.id });
  });
  expect(toast.getToasts().find((toast) => toast.id === entry.id)).toMatchObject({
    duration: 5000,
    action: undefined,
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Fresh toast")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5300));
  expect(screen.queryByText("Fresh toast")).toBeNull();
});
test("preventDefault in an action keeps its Undo state and callback", async () => {
  vi.useFakeTimers();
  render(<Toaster />);
  const undo = vi.fn((event: MouseEvent<HTMLButtonElement>) => event.preventDefault());
  let id: string | number = "";
  act(() => {
    id = toast("Moved", { action: { label: "Undo", onClick: undo } });
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(screen.getByText("Moved")).toBeTruthy();
  act(() => {
    toast.success("Confirmed", { id });
  });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    duration: 8000,
    action: { label: "Undo", onClick: expect.any(Function) },
  });
  await act(() => vi.advanceTimersByTimeAsync(5200));
  expect(screen.getByText("Confirmed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledTimes(2);
});
test.each([
  { source: "shared", loading: true },
  { source: "shared", loading: false },
  { source: "result", loading: true },
  { source: "result", loading: false },
] as const)("promise records $source Undo with loading=$loading", async ({ source, loading }) => {
  vi.spyOn(sonnerToast, "getHistory").mockImplementation(() => {
    throw new Error("Toast policy must not read Sonner history");
  });
  const action = { label: "Undo", onClick: vi.fn() };
  await toast
    .promise(Promise.resolve("Moved"), {
      ...(loading ? { loading: "Moving" } : {}),
      ...(source === "shared" ? { action } : {}),
      success: (message) => ({ message, ...(source === "result" ? { action } : {}) }),
    })
    .unwrap();
  const entry = toast.getToasts().at(-1);
  expect(entry).toMatchObject({
    action: { ...action, onClick: expect.any(Function) },
    duration: 8000,
  });
  if (!entry) throw new Error("Expected a promise result toast");
  toast.success("Confirmed", { id: entry.id });
  expect(toast.getToasts().at(-1)).toMatchObject({ duration: 8000 });
  toast.info("Confirmed again", { id: entry.id, duration: 12000 });
  toast.success("Done", { id: entry.id });
  expect(toast.getToasts().at(-1)).toMatchObject({ duration: 12000 });
});
test("promise settlement retains updates made while it was loading", async () => {
  const id = toast("Moving");
  toast("Moved", { id, action: { label: "Undo", onClick: vi.fn() } });
  let resolve = (_value: string) => {};
  const pending = toast.promise(
    new Promise<string>((done) => {
      resolve = done;
    }),
    { id, loading: "Confirming", success: "Confirmed" },
  );
  toast.info("Still confirming", { id, duration: 12000 });
  resolve("Confirmed");
  await pending.unwrap();
  expect(toast.getToasts().filter((entry) => entry.id === id)).toEqual([
    expect.objectContaining({ duration: 12000 }),
    expect.objectContaining({
      action: { label: "Undo", onClick: expect.any(Function) },
      duration: 12000,
    }),
  ]);
});
test.each([
  { kind: "default", event: "onAutoClose" },
  { kind: "default", event: "onDismiss" },
  { kind: "promise-loading", event: "onAutoClose" },
  { kind: "promise-loading", event: "onDismiss" },
  { kind: "promise", event: "onAutoClose" },
  { kind: "promise", event: "onDismiss" },
] as const)("$kind clears state on $event and preserves the caller's callback", async ({
  kind,
  event,
}) => {
  vi.useFakeTimers();
  render(<Toaster />);
  const id = `lifecycle-${kind}-${event}`;
  const callback = vi.fn();
  const data = {
    id,
    action: { label: "Undo", onClick: vi.fn() },
    duration: 12000,
    closeButton: true,
    [event]: callback,
  };
  await act(async () => {
    if (kind === "default") toast("Moved", data);
    else {
      await toast
        .promise(Promise.resolve("Moved"), {
          ...data,
          ...(kind === "promise-loading" ? { loading: "Moving" } : {}),
          success: "Moved",
        })
        .unwrap();
    }
    toast.success("Confirmed", { id });
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  if (event === "onDismiss") fireEvent.click(screen.getByRole("button", { name: "Close toast" }));
  await act(() => vi.advanceTimersByTimeAsync(12300));
  expect(callback).toHaveBeenCalledOnce();
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id }));
  act(() => {
    toast.success("Fresh toast", { id });
  });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    duration: 5000,
    action: undefined,
  });
});
test("an internally dismissed promise clears its record", async () => {
  const id = "promise-dismiss-reset";
  await toast
    .promise(Promise.resolve("Moved"), {
      id,
      loading: "Moving",
      action: { label: "Undo", onClick: vi.fn() },
      duration: 12000,
    })
    .unwrap();
  toast.success("Fresh toast", { id });
  expect(toast.getToasts().find((entry) => entry.id === id)).toMatchObject({
    duration: 5000,
    action: undefined,
  });
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
