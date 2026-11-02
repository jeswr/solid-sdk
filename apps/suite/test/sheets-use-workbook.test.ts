// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedWorkbook, WorkbookService } from "../src/apps/sheets/lib/contract";
import { WorkbookConflictError, WorkbookNotFoundError } from "../src/apps/sheets/lib/contract";
import { pendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

const context = vi.hoisted(() => ({ service: null as WorkbookService | null }));
vi.mock("../src/apps/sheets/state/service", () => ({
  useWorkbookService: () => context.service,
}));

import { useWorkbook } from "../src/apps/sheets/hooks/use-workbook";

let state: ReturnType<typeof useWorkbook>;
function Editor({ container }: { container: string }) {
  state = useWorkbook(container);
  return null;
}
async function setup(online = true) {
  const pod = await harness();
  const book = await pod.service.create({ title: "Hook", snapshot: snapshot() });
  context.service = pod.service;
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
  return { ...pod, book };
}
afterEach(() => vi.restoreAllMocks());

describe("workbook editor lifecycle", () => {
  it("reuses offline pending edits on reopen and saves them after navigating away again", async () => {
    const { service, book } = await setup(false);
    const open = vi.spyOn(service, "open");
    const first = await mount(h(Editor, { container: book.container }));
    const local = snapshot("Offline\nedit");
    let alive = true;
    await act(() =>
      state.scheduleSave(() => {
        if (!alive) throw new Error("Disposed");
        return local;
      }),
    );
    await first.unmount();
    alive = false;
    const second = await mount(h(Editor, { container: book.container }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(state.workbook?.snapshot).toEqual(local);
    expect(state.status).toBe("offline");
    await second.unmount();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await pendingSaves.get(book.container)?.flush();
    expect((await service.open(book.container)).snapshot).toEqual(local);
    expect(pendingSaves.get(book.container)).toBeUndefined();
  });

  it("reopens a detached conflict and supports load theirs, keep mine and discard", async () => {
    const { service, book } = await setup();
    const first = await mount(h(Editor, { container: book.container }));
    await service.rename(book.container, "Remote title", book.version);
    await act(async () => {
      state.scheduleSave(() => snapshot("Mine\nedit"));
      await state.flush();
    });
    expect(state.status).toBe("conflict");
    await first.unmount();
    const second = await mount(h(Editor, { container: book.container }));
    expect(state.status).toBe("conflict");
    let loaded: unknown;
    await act(async () => {
      loaded = await state.reload();
    });
    expect(loaded).toEqual(book.snapshot);
    expect(state.metadata?.title).toBe("Remote title");
    await act(async () => {
      state.rename("Local title");
      await state.flush();
    });
    expect(state.metadata?.title).toBe("Local title");
    const save = vi
      .spyOn(service, "save")
      .mockRejectedValueOnce(new WorkbookConflictError(book.container));
    const mine = snapshot("Keep\nmine");
    await act(async () => {
      state.scheduleSave(() => mine);
      await state.flush();
      await state.retry(true);
    });
    expect(save.mock.calls.at(-1)?.[3]?.force).toBe(true);
    expect(state.workbook?.snapshot).toEqual(mine);
    await act(async () => {
      state.scheduleSave(() => snapshot("Discard\nme"));
      state.discard();
      await state.retry();
    });
    expect(state.status).toBe("saved");
    await second.unmount();
  });

  it("flushes on pagehide and hidden visibility, while retaining the unload guard for edits", async () => {
    const { service, book } = await setup();
    const editor = await mount(h(Editor, { container: book.container }));
    const save = vi.spyOn(service, "save");
    await act(() => state.scheduleSave(() => snapshot("First\nedit")));
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    await act(async () => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(save).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("pagehide"));
      await state.flush();
    });
    await act(async () => {
      state.scheduleSave(() => snapshot("Second\nedit"));
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await state.flush();
    });
    expect(save).toHaveBeenCalledTimes(2);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await editor.unmount();
  });

  it("reports open errors, retries, and ignores a late successful open after unmount", async () => {
    const { service, book } = await setup();
    const error = new Error("Read failed");
    const open = vi.spyOn(service, "open").mockRejectedValueOnce(error);
    const editor = await mount(h(Editor, { container: book.container }));
    expect(state.error).toBe(error);
    await act(() => state.retryOpen());
    expect(state.error).toBeUndefined();
    expect(state.workbook?.container).toBe(book.container);
    await editor.unmount();
    const waiting = deferred<OpenedWorkbook>();
    open.mockReturnValueOnce(waiting.promise);
    const late = await mount(h(Editor, { container: book.container }));
    await act(async () => {
      state.scheduleSave(() => snapshot());
      state.rename("Not loaded");
      await state.retry();
      await state.flush();
      state.discard();
    });
    await late.unmount();
    await act(() => waiting.resolve(book));
    expect(pendingSaves.get(book.container)).toBeUndefined();
  });

  it("ignores a late failed open and permits a read without an attached writer", async () => {
    const { service, book } = await setup();
    const waiting = deferred<OpenedWorkbook>();
    const open = vi.spyOn(service, "open").mockReturnValueOnce(waiting.promise);
    const editor = await mount(h(Editor, { container: book.container }));
    window.dispatchEvent(new Event("pagehide"));
    await editor.unmount();
    await act(() => waiting.reject(new Error("Late failure")));
    open.mockResolvedValue(book);
    expect(await state.reload()).toEqual(book.snapshot);
    expect(pendingSaves.get(book.container)).toBeUndefined();
  });

  it("validates pending entries on reopen and drops deleted workbooks instead of showing cached data", async () => {
    const { service, book } = await setup(false);
    const editor = await mount(h(Editor, { container: book.container }));
    await act(() => state.scheduleSave(() => snapshot("Offline\nedit")));
    await editor.unmount();
    expect(pendingSaves.get(book.container)?.dirty).toBe(true);
    await service.remove(book.container);
    const reopened = await mount(h(Editor, { container: book.container }));
    expect(state.error).toBeInstanceOf(WorkbookNotFoundError);
    expect(state.workbook).toBeNull();
    expect(pendingSaves.get(book.container)).toBeUndefined();
    const save = vi.spyOn(service, "save");
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await reopened.unmount();
  });

  it("ignores stale not-found responses after another editor has acquired pending data", async () => {
    const { service, book } = await setup(false);
    const waiting = deferred<OpenedWorkbook>();
    vi.spyOn(service, "open").mockReturnValueOnce(waiting.promise);
    const editor = await mount(h(Editor, { container: book.container }));
    await editor.unmount();
    const entry = pendingSaves.acquire(service, book);
    entry.setOnline(false);
    entry.schedule(() => snapshot("Newer\nedit"));
    await act(() => waiting.reject(new WorkbookNotFoundError(book.container)));
    expect(pendingSaves.get(book.container)).toBe(entry);
    pendingSaves.drop(book.container);
  });

  it.each([
    401, 403,
  ])("keeps detached edits and the unload warning when reopen returns %s, then retries", async (status) => {
    const { service, book, setHook } = await setup(false);
    const first = await mount(h(Editor, { container: book.container }));
    const local = snapshot("Offline\nedit");
    await act(() => state.scheduleSave(() => local));
    await first.unmount();
    const pending = pendingSaves.get(book.container);
    setHook((call) =>
      call.method === "GET" && call.url.endsWith("workbook.json")
        ? new Response(null, { status })
        : undefined,
    );
    const reopened = await mount(h(Editor, { container: book.container }));
    expect(state.error).toMatchObject({ name: "WorkbookNotFoundError", reason: "forbidden" });
    expect(state.workbook).toBeNull();
    expect(pendingSaves.get(book.container)).toBe(pending);
    expect(pending?.workbook.snapshot).toEqual(local);
    expect(pending?.dirty).toBe(true);
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    setHook(() => undefined);
    await act(() => state.retryOpen());
    expect(state.error).toBeUndefined();
    expect(state.workbook?.snapshot).toEqual(local);
    await reopened.unmount();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await pending?.flush();
    expect((await service.open(book.container)).snapshot).toEqual(local);
    expect(pendingSaves.get(book.container)).toBeUndefined();
  });

  it("keeps pending edits when loading their version is forbidden", async () => {
    const { book, setHook } = await setup(false);
    const editor = await mount(h(Editor, { container: book.container }));
    const local = snapshot("Unsaved\nedit");
    await act(() => state.scheduleSave(() => local));
    setHook((call) =>
      call.method === "GET" && call.url.endsWith("index.ttl")
        ? new Response(null, { status: 403 })
        : undefined,
    );
    await act(async () => {
      await expect(state.reload()).rejects.toMatchObject({ reason: "forbidden" });
    });
    expect(state.error).toMatchObject({ reason: "forbidden" });
    expect(pendingSaves.get(book.container)?.dirty).toBe(true);
    await editor.unmount();
    expect(pendingSaves.get(book.container)?.workbook.snapshot).toEqual(local);
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    pendingSaves.drop(book.container);
  });

  it("drops pending data if loading their version discovers deletion, while retaining other read failures", async () => {
    const { service, book } = await setup();
    const editor = await mount(h(Editor, { container: book.container }));
    const open = vi.spyOn(service, "open");
    const transient = new Error("Read failed");
    open.mockRejectedValueOnce(transient);
    await act(async () => {
      await expect(state.reload()).rejects.toBe(transient);
    });
    expect(pendingSaves.get(book.container)).toBeDefined();
    await service.remove(book.container);
    await act(async () => {
      await expect(state.reload()).rejects.toBeInstanceOf(WorkbookNotFoundError);
    });
    expect(state.error).toBeInstanceOf(WorkbookNotFoundError);
    expect(pendingSaves.get(book.container)).toBeUndefined();
    await editor.unmount();
  });
});
