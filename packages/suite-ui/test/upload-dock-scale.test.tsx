// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UploadDock } from "../src/components/upload-dock.js";
import type { UploadItem } from "../src/uploads/queue.js";

const items: UploadItem[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: String(index),
  name: `File ${index}`,
  status: "uploading",
  sent: 0,
  total: 100,
  attempt: 1,
}));
const controls = { onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn() };
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("su-upload-item") ? 144 : 400;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1_440_000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      height: this.offsetHeight,
      width: 400,
      top: 0,
      left: 0,
      right: 400,
      bottom: this.offsetHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === "object") {
        this.scrollTop = options.top ?? 0;
        this.dispatchEvent(new Event("scroll"));
      }
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a collapsed 10,000-file queue mounts no rows, including on progress updates", () => {
  const { container, rerender } = render(
    <UploadDock {...controls} items={items} initiallyCollapsed />,
  );
  expect(container.querySelectorAll("li")).toHaveLength(0);
  rerender(
    <UploadDock
      {...controls}
      items={items.map((item) => ({ ...item, sent: 25 }))}
      initiallyCollapsed
    />,
  );
  expect(container.querySelectorAll("li")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toContain("10000 uploading");
});

test("scrolling keeps the focused control mounted and completion restores focus across windows", async () => {
  const { container, rerender } = render(<UploadDock {...controls} items={items} />);
  const pause = screen.getByRole("button", { name: "Pause File 0" });
  act(() => pause.focus());
  const viewport = container.querySelector(".su-upload-scroll");
  expect(viewport).not.toBeNull();
  fireEvent.scroll(viewport as HTMLElement, { target: { scrollTop: 144 * 5000 } });
  await screen.findByRole("button", { name: "Pause File 5000" });
  expect(document.activeElement).toBe(pause);
  expect(container.querySelectorAll("li").length).toBeLessThan(30);
  rerender(
    <UploadDock
      {...controls}
      items={items.map((item, index) =>
        index === 0 ? { ...item, status: "done", sent: 100 } : item,
      )}
    />,
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause File 1" })),
  );
  expect(screen.getByRole("status").textContent).toContain("1 uploaded");
  expect(container.querySelectorAll("li").length).toBeLessThan(30);
});

test("completed queues retain a keyboard-focusable scroll region", () => {
  render(<UploadDock {...controls} items={items.map((item) => ({ ...item, status: "done" }))} />);
  const viewport = screen.getByRole("region", { name: "Upload files" });
  expect(viewport.tabIndex).toBe(0);
  act(() => viewport.focus());
  expect(document.activeElement).toBe(viewport);
  expect(screen.getAllByRole("listitem").length).toBeLessThan(30);
  expect(screen.getByRole("status").textContent).toContain("10000 uploaded");
});

test("an expanded 10,000-file queue mounts a window with list positions and reaches the last file by keyboard", async () => {
  const { container } = render(<UploadDock {...controls} items={items} />);
  const rows = container.querySelectorAll("li");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(30);
  expect(rows[0]?.getAttribute("aria-setsize")).toBe("10000");
  expect(rows[0]?.getAttribute("aria-posinset")).toBe("1");
  const pause = screen.getByRole("button", { name: "Pause File 0" });
  pause.focus();
  fireEvent.keyDown(pause, { key: "End" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause File 9999" })),
  );
  fireEvent.click(document.activeElement as HTMLElement);
  expect(controls.onPause).toHaveBeenCalledWith("9999");
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause File 0" })),
  );
  const cancel = screen.getByRole("button", { name: "Cancel File 0" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause File 1" })),
  );
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  expect(container.querySelectorAll("li")).toHaveLength(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /uploads.*Expand/ }));
});
