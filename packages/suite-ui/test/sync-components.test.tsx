// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ConflictDialog,
  OfflinePill,
  SyncSheet,
  type SyncSnapshot,
  SyncStatus,
} from "../src/sync/index.js";

const now = new Date("2026-10-20T12:00:00Z");
const change = {
  id: "save",
  label: "Save notes",
  where: "My Drive / Work",
  queuedAt: new Date(now.getTime() - 120000),
  state: "pending" as const,
};
const conflict = {
  id: "notes",
  name: "Notes",
  where: "My Drive / Work",
  summary: "The title changed on another device.",
  changedAt: now,
};
const saved: SyncSnapshot = { online: true, reconnecting: false, pending: [], conflicts: [] };

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("OfflinePill / SyncStatus", () => {
  it("hides when synced and updates in place", () => {
    const { rerender } = render(<OfflinePill snapshot={saved} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SyncStatus snapshot={{ ...saved, online: false }} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Offline — showing saved copies" })).toBeTruthy();
  });
  it.each([
    [{ online: false }, "Offline — showing saved copies"],
    [{ reconnecting: true }, "Reconnecting…"],
    [{ pending: [change] }, "1 change waiting"],
    [{ pending: [change, change, change] }, "3 changes waiting"],
    [{ conflicts: [conflict] }, "1 conflict"],
    [{ conflicts: [conflict, conflict, conflict] }, "3 conflicts"],
    [{ online: false, pending: [change] }, "Offline — showing saved copies, 1 change waiting"],
    [
      { online: false, pending: [change, change, change] },
      "Offline — showing saved copies, 3 changes waiting",
    ],
  ])("announces and opens %j", (overrides, label) => {
    const onOpen = vi.fn();
    render(<OfflinePill snapshot={{ ...saved, ...overrides }} onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: label });
    expect(screen.getByRole("status").textContent).toBe(label);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it("gives the icon a name, live text, and a keyboard tooltip", async () => {
    const user = userEvent.setup();
    render(<OfflinePill snapshot={{ ...saved, online: false }} onOpen={vi.fn()} variant="icon" />);
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Offline — showing saved copies");
    expect(screen.getByRole("button").getAttribute("data-sync-variant")).toBe("icon");
    expect(screen.getByRole("status").textContent).toBe("Offline — showing saved copies");
  });
});

describe("SyncSheet", () => {
  const callbacks = {
    onOpenChange: vi.fn(),
    onRetry: vi.fn(),
    onRetryAll: vi.fn(),
    onResolve: vi.fn(),
  };
  it("is absent when closed and shows the saved empty state when open", () => {
    const { rerender } = render(
      <SyncSheet open={false} snapshot={saved} {...callbacks} now={now} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SyncSheet open snapshot={saved} {...callbacks} now={now} />);
    expect(screen.getByText("Everything is saved")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sync status" }));
    expect(screen.getByText("Not synced yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry all" })).toBeNull();
  });
  it("renders what, where, relative time, failed errors, conflicts and localised last sync", () => {
    const snapshot: SyncSnapshot = {
      ...saved,
      pending: [
        change,
        {
          ...change,
          id: "failed",
          label: "Rename notes",
          state: "failed",
          error: "Save was refused",
        },
        { ...change, id: "failed2", label: "Move notes", state: "failed" },
      ],
      conflicts: [conflict],
      lastSyncedAt: now,
    };
    render(<SyncSheet open snapshot={snapshot} {...callbacks} now={now} locale="en-GB" />);
    expect(screen.getByRole("heading", { name: "Waiting to sync" })).toBeTruthy();
    expect(screen.getAllByText("2 minutes ago")).toHaveLength(3);
    expect(screen.getAllByText("My Drive / Work")).toHaveLength(4);
    expect(screen.getByText("Save was refused").getAttribute("role")).toBe("alert");
    expect(screen.getByText("This change could not be synced.")).toBeTruthy();
    expect(screen.getByText(/Last synced/).textContent).toContain(
      new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(now),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Rename notes" }));
    expect(callbacks.onRetry).toHaveBeenCalledWith("failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry all" }));
    expect(callbacks.onRetryAll).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Resolve Notes" }));
    expect(callbacks.onResolve).toHaveBeenCalledWith("notes");
  });
  it("blocks retries offline with a focusable explanation and enables them on reconnection", async () => {
    const user = userEvent.setup();
    const snapshot: SyncSnapshot = {
      ...saved,
      online: false,
      pending: [{ ...change, state: "failed" }],
    };
    const { rerender } = render(<SyncSheet open snapshot={snapshot} {...callbacks} now={now} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry all" }).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Retry Save notes" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Retry all" }).getAttribute("aria-describedby"),
    ).toBeTruthy();
    screen.getByRole("group").focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Reconnect to retry");
    await user.keyboard("{Escape}");
    rerender(<SyncSheet open snapshot={{ ...snapshot, online: true }} {...callbacks} now={now} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry all" }).disabled).toBe(
      false,
    );
  });
  it("returns focus to the pill on Escape", async () => {
    const user = userEvent.setup();
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <OfflinePill snapshot={{ ...saved, online: false }} onOpen={() => setOpen(true)} />
          <SyncSheet
            open={open}
            onOpenChange={setOpen}
            snapshot={saved}
            now={now}
            onRetry={vi.fn()}
            onRetryAll={vi.fn()}
            onResolve={vi.fn()}
          />
        </>
      );
    }
    render(<Demo />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button")));
  });
});

describe("ConflictDialog", () => {
  it("renders nothing for an absent conflict or a closed dialog", () => {
    const props = { onChoose: vi.fn(), onOpenChange: vi.fn() };
    const { rerender } = render(<ConflictDialog open conflict={null} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<ConflictDialog open={false} conflict={conflict} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each([
    ["Keep mine", "mine"],
    ["Keep theirs", "theirs"],
    ["Keep both", "both"],
  ] as const)("chooses %s", (label, strategy) => {
    const choose = vi.fn();
    render(<ConflictDialog open conflict={conflict} onChoose={choose} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText(conflict.summary)).toBeTruthy();
    const both = screen.getByRole("button", { name: "Keep both" });
    expect(document.activeElement).toBe(both);
    expect(document.getElementById(both.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Keep both saves your version as a copy.",
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(choose).toHaveBeenCalledWith(strategy);
    for (const name of ["Keep mine", "Keep theirs", "Keep both"])
      expect(screen.getByRole("button", { name }).getAttribute("data-variant")).toBe("outline");
  });
  it("traps keyboard focus and returns to the opening control on Escape", async () => {
    const user = userEvent.setup();
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Resolve
          </button>
          <ConflictDialog
            open={open}
            conflict={conflict}
            onChoose={vi.fn()}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    render(<Demo />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep both" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep theirs" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep mine" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resolve" })),
    );
  });
});
