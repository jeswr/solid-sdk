// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbookService } from "../src/apps/sheets/lib/contract";
import { WorkbookConflictError } from "../src/apps/sheets/lib/contract";
import { pendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { act, h, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

const context = vi.hoisted(() => ({ service: null as WorkbookService | null }));
vi.mock("../src/apps/sheets/state/service", () => ({ useWorkbookService: () => context.service }));

import { useWorkbook } from "../src/apps/sheets/hooks/use-workbook";

let state: ReturnType<typeof useWorkbook>;
function Editor({ container }: { container: string }) {
  state = useWorkbook(container);
  return null;
}
const containers = new Set<string>();
afterEach(() => {
  for (const container of containers) pendingSaves.drop(container);
  containers.clear();
  vi.restoreAllMocks();
});
async function fixture(online = true, readOnly = false) {
  const h = await harness();
  const book = await h.service.create({ title: "Restore", snapshot: snapshot() });
  containers.add(book.container);
  context.service = h.service;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  if (readOnly) vi.spyOn(h.service, "open").mockResolvedValue({ ...book, readOnly: true });
  const ui = await mount(hElement(Editor, { container: book.container }));
  return { ...h, book, ui };
}
const hElement = h;

it("flushes edits, preserves a pre-restore snapshot, and reloads the exact anchors/charts and revision", async () => {
  const f = await fixture();
  const current = snapshot("Current edits");
  const historical = {
    ...f.book.snapshot,
    commentAnchors: { version: 1, anchors: { thread: { sheetId: "data", cell: "A2" } } },
    charts: {
      version: 1,
      entries: [
        {
          id: "chart",
          sheetId: "data",
          range: "A1:A2",
          type: "column",
          title: "Historical",
          legend: true,
          series: "columns",
        },
      ],
    },
  };
  const loaded = vi.fn();
  const save = vi.spyOn(f.service, "save");
  await act(async () => {
    state.scheduleSave(() => current);
    await state.restore(historical, loaded);
  });
  expect(state.status).toBe("saved");
  expect(state.workbook?.snapshot).toEqual(historical);
  expect(loaded).toHaveBeenCalledExactlyOnceWith(historical, state.version?.snapshotEtag);
  expect(save.mock.calls[0]?.[1]).toEqual(current);
  expect(save.mock.calls[1]?.[3]?.snapshotCurrent).toBe(true);
  const history = f.service.versions?.(f.book.container);
  const versions = await history?.list();
  expect(versions).toHaveLength(2);
  expect(await Promise.all((versions ?? []).map((v) => history?.load(v.url)))).toContainEqual(
    current,
  );
  await f.ui.unmount();
});

it("blocks restore while offline without replacing pending changes", async () => {
  const f = await fixture(false);
  const current = snapshot("Offline edits");
  await act(async () => {
    state.scheduleSave(() => current);
    await expect(state.restore(f.book.snapshot)).rejects.toThrow("online");
  });
  expect(pendingSaves.get(f.book.container)?.dirty).toBe(true);
  expect(pendingSaves.get(f.book.container)?.workbook.snapshot).toEqual(current);
  await f.ui.unmount();
  pendingSaves.drop(f.book.container);
});

it("blocks restore for a viewer", async () => {
  const f = await fixture(true, true);
  const save = vi.spyOn(f.service, "save");
  await act(async () => {
    await expect(state.restore(f.book.snapshot)).rejects.toThrow("Write");
  });
  expect(save).not.toHaveBeenCalled();
  await f.ui.unmount();
});

it("blocks restore when capturing the current state fails and preserves it for retry", async () => {
  const f = await fixture();
  const current = snapshot("Current edits");
  const historical = snapshot("Historical");
  const loaded = vi.fn();
  await act(async () => {
    state.scheduleSave(() => current);
    await state.flush();
  });
  f.calls.length = 0;
  f.setHook((call) =>
    call.method === "PUT" && call.url.startsWith(`${f.book.container}versions/`)
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await act(async () => {
    await expect(state.restore(historical, loaded)).rejects.toThrow("restore");
  });
  expect(state.status).toBe("error");
  expect(pendingSaves.get(f.book.container)?.dirty).toBe(true);
  expect(loaded).not.toHaveBeenCalled();
  expect((await f.storage.loadSnapshot(f.book.container)).value).toEqual(current);
  expect(f.calls.some((call) => call.method === "PUT" && call.url.endsWith("workbook.json"))).toBe(
    false,
  );

  f.setHook(() => undefined);
  await act(() => state.retry());
  expect(state.status).toBe("saved");
  expect((await f.storage.loadSnapshot(f.book.container)).value).toEqual(historical);
  const history = f.service.versions?.(f.book.container);
  const versions = await history?.list();
  expect(await Promise.all((versions ?? []).map((v) => history?.load(v.url)))).toContainEqual(
    current,
  );
  await f.ui.unmount();
});

it("retains failed restore in the normal conflict queue and can discard or retry it", async () => {
  const f = await fixture();
  const save = vi
    .spyOn(f.service, "save")
    .mockRejectedValueOnce(new WorkbookConflictError(f.book.container));
  await act(async () => {
    await expect(state.restore(snapshot("Historical"))).rejects.toThrow("restore");
  });
  expect(state.status).toBe("conflict");
  expect(pendingSaves.get(f.book.container)?.dirty).toBe(true);
  await act(() => state.retry(true));
  expect(save.mock.calls.at(-1)?.[3]).toMatchObject({ force: true, snapshotCurrent: true });
  expect(state.status).toBe("saved");
  await act(async () => {
    state.scheduleSave(() => snapshot("New edit"));
    await state.flush();
  });
  expect(save.mock.calls.at(-1)?.[3]?.snapshotCurrent).toBeUndefined();
  await f.ui.unmount();
});
