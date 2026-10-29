// AUTHORED-BY Codex
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchResult } from "../src/apps/drive/lib/operations/operations";
import { TrashIndexWarning } from "../src/apps/drive/lib/operations/operations";
import type { TrashEntry } from "../src/apps/drive/lib/operations/trash-index";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  restore: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@jeswr/suite-ui", () => ({ toast: mocks.toast }));
vi.mock("../src/apps/docs/editor/operations", () => ({
  deleteDocument: mocks.remove,
  restoreDocument: mocks.restore,
}));

import { trashDocumentWithUndo } from "../src/apps/docs/components/trash-actions";

const session = {} as PodSession;
const entries: TrashEntry[] = ["plan.ttl", "plan/"].map((name) => ({
  url: `https://pod.test/drive/.trash/slot/${name}`,
  original: `https://pod.test/docs/${name}`,
  name,
  trashedAt: new Date("2026-10-26"),
}));
const warning = new TrashIndexWarning("index.ttl", new Error("unavailable"));
afterEach(() => vi.resetAllMocks());
describe("Docs trash feedback", () => {
  it.each([
    false,
    true,
  ])("round37 Undo passes the confirmed document URL after renamed=%s restore", async (renamed) => {
    mocks.remove.mockResolvedValue({ done: entries, failed: [] });
    const url = renamed ? "https://pod.test/docs/plan%20(restored).ttl" : entries[0]?.original;
    mocks.restore.mockResolvedValue({
      done: [
        { entry: entries[1], url: "https://pod.test/docs/plan%20(restored)/", renamed },
        { entry: entries[0], url, renamed },
      ],
      failed: [],
    });
    const onRestored = vi.fn();
    await trashDocumentWithUndo(entries[0]?.original as string, session, onRestored);
    await mocks.toast.mock.calls[0]?.[1].action.onClick();
    expect(onRestored).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("shows Moved to trash with Undo only for a complete batch, and restores both records", async () => {
    mocks.remove.mockResolvedValue({ done: entries, failed: [] });
    mocks.restore.mockResolvedValue({
      done: entries.map((entry) => ({ entry, url: entry.original, renamed: false })),
      failed: [],
    });
    const refresh = vi.fn();
    expect(await trashDocumentWithUndo("document", session, refresh)).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith("document", session);
    expect(mocks.toast).toHaveBeenCalledWith(
      "Moved to trash",
      expect.objectContaining({ action: { label: "Undo", onClick: expect.any(Function) } }),
    );
    const undo = mocks.toast.mock.calls[0]?.[1].action.onClick;
    await undo();
    expect(mocks.restore).toHaveBeenCalledWith(entries, session);
    expect(mocks.toast.success).toHaveBeenCalledWith("Restored document");
    expect(refresh).toHaveBeenCalledOnce();
  });
  const failures: BatchResult<TrashEntry>[] = [
    {
      done: [entries[0] as TrashEntry],
      failed: [{ url: "companion", error: new Error("failed") }],
    },
    { done: entries, failed: [], warnings: [warning] },
    { done: [], failed: [{ url: "document", error: new Error("failed") }], warnings: [warning] },
    { done: [], failed: [] },
  ];
  it.each(
    failures,
  )("never claims success or offers Undo for a failed or warned batch (%#)", async (result) => {
    mocks.remove.mockResolvedValue(result);
    expect(await trashDocumentWithUndo("document", session, vi.fn())).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalled();
    if (result.warnings?.length) expect(mocks.toast.error).toHaveBeenCalledWith(warning.message);
  });
  it.each([
    "partial",
    "warning",
    "throw",
  ])("never claims a successful Undo after %s restore", async (failure) => {
    mocks.remove.mockResolvedValue({ done: entries, failed: [] });
    if (failure === "throw") mocks.restore.mockRejectedValue(new Error("offline"));
    else
      mocks.restore.mockResolvedValue(
        failure === "warning"
          ? { done: entries, failed: [], warnings: [warning] }
          : { done: [entries[0]], failed: [{ url: "companion", error: new Error("failed") }] },
      );
    await trashDocumentWithUndo("document", session, vi.fn());
    await mocks.toast.mock.calls[0]?.[1].action.onClick();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalled();
  });
});
