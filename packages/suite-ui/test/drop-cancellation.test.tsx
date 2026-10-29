// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DropZoneOverlay } from "../src/components/drop-zone-overlay.js";
import type { DropEntry } from "../src/uploads/drop.js";

function stalledDrop(zone: HTMLElement) {
  let finish = (_entries: DropEntry[]) => {};
  const entry: DropEntry = {
    name: "Folder",
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (ok) => {
        finish = ok;
      },
    }),
  };
  fireEvent.drop(zone, {
    dataTransfer: {
      types: ["Files"],
      files: [],
      items: [{ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null }],
    },
  });
  return (entries: DropEntry[]) => finish(entries);
}

test("Escape cancels a stalled traversal, restores focus and accepts another drop without stale ingestion", async () => {
  const onFiles = vi.fn();
  render(
    <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
      <button type="button">Open folder</button>
    </DropZoneOverlay>,
  );
  const action = screen.getByRole("button", { name: "Open folder" });
  action.focus();
  const zone = screen.getByRole("region");
  const finish = stalledDrop(zone);
  expect(zone.getAttribute("aria-busy")).toBe("true");
  expect(action.closest("[inert]")).not.toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(zone.getAttribute("aria-busy")).toBe("false"));
  expect(action.closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(action);
  const later = vi.fn();
  await act(async () => finish([{ name: "late", isFile: true, isDirectory: false, file: later }]));
  expect(later).not.toHaveBeenCalled();
  expect(onFiles).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Choose files"), {
    target: { files: [new File(["ok"], "ok.txt")] },
  });
  await waitFor(() => expect(onFiles).toHaveBeenCalledOnce());
  await waitFor(() => expect(zone.getAttribute("aria-busy")).toBe("false"));
});

test("unmount aborts traversal before late entries can be read or delivered", async () => {
  const onFiles = vi.fn();
  const { unmount } = render(<DropZoneOverlay folderName="Projects" onFiles={onFiles} />);
  const finish = stalledDrop(screen.getByRole("region"));
  unmount();
  const file = vi.fn();
  await act(async () => finish([{ name: "late", isFile: true, isDirectory: false, file }]));
  expect(file).not.toHaveBeenCalled();
  expect(onFiles).not.toHaveBeenCalled();
});

test("configured traversal limits and timeouts leave busy state with recovery feedback", async () => {
  vi.useFakeTimers();
  try {
    render(
      <DropZoneOverlay folderName="Projects" onFiles={vi.fn()} readOptions={{ timeoutMs: 10 }} />,
    );
    const zone = screen.getByRole("region");
    stalledDrop(zone);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(zone.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("alert").textContent).toContain("Can't read these files");
  } finally {
    vi.useRealTimers();
  }
});
