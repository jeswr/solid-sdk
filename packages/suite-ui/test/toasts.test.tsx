// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Toaster, toast } from "../src/components/ui/sonner.js";

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
test("normal and Undo toasts enforce 5s and 8s; errors persist and can be dismissed", async () => {
  vi.useFakeTimers();
  const undo = vi.fn();
  render(<Toaster />);
  let normal: string | number = "";
  let withUndo: string | number = "";
  let error: string | number = "";
  act(() => {
    normal = toast.success("Link copied", { duration: 1 });
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
