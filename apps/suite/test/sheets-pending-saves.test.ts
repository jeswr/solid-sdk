// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbookConflictError, WorkbookPartialSaveError } from "../src/apps/sheets/lib/contract";
import { SheetStorageError } from "../src/apps/sheets/lib/model";
import { createPendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { harness, snapshot } from "./sheets-workbook-helpers";

async function setup(connected = true) {
  const h = await harness();
  const book = await h.service.create({ title: "Pending", snapshot: snapshot() });
  const registry = createPendingSaves();
  const events = new EventTarget();
  let online = connected;
  registry.connect(events, () => online);
  const entry = registry.acquire(h.service, book);
  return {
    h,
    book,
    registry,
    events,
    entry,
    setOnline(value: boolean) {
      online = value;
      events.dispatchEvent(new Event(value ? "online" : "offline"));
    },
  };
}

describe("pending workbook saves", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures offline edits before disposal, retains one writer, and saves after navigation", async () => {
    const { h, book, registry, entry, setOnline } = await setup(false);
    let alive = true;
    const changed = snapshot("Offline\nedit");
    const detach = entry.subscribe(() => {});
    entry.schedule(() => {
      if (!alive) throw new Error("Disposed engine");
      return changed;
    });
    detach();
    alive = false;
    await entry.flush();
    expect(entry.status).toBe("offline");
    expect(entry.dirty).toBe(true);
    expect(registry.get(book.container)?.workbook.snapshot).toEqual(changed);
    expect(registry.acquire(h.service, book)).toBe(entry);
    entry.rename("Offline title");
    setOnline(true);
    await entry.flush();
    expect((await h.service.open(book.container)).snapshot).toEqual(changed);
    expect(registry.get(book.container)).toBeUndefined();
  });

  it("keeps the latest edit and version when an in-flight save finishes after detachment", async () => {
    const { h, book, registry, entry } = await setup();
    let finish = () => {};
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = h.service.save.bind(h.service);
    const calls = vi.spyOn(h.service, "save").mockImplementationOnce(async (...args) => {
      await paused;
      return original(...args);
    });
    const detach = entry.subscribe(() => {});
    const firstSnapshot = snapshot("First\nedit");
    const saved = vi.fn();
    entry.onSaved(saved);
    entry.schedule(() => firstSnapshot);
    const saving = entry.flush();
    await Promise.resolve();
    const latest = snapshot("Latest\nedit");
    entry.schedule(() => latest);
    detach();
    finish();
    await saving;
    await entry.flush();
    expect(calls).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[0]?.[0]).toBe(firstSnapshot);
    expect(saved.mock.calls[0]?.[1]).toBe(calls.mock.calls[1]?.[2].snapshotEtag);
    expect(saved.mock.calls[1]?.[0]).toBe(latest);
    expect(calls.mock.calls[1]?.[2].snapshotEtag).not.toBe(book.version.snapshotEtag);
    expect((await h.service.open(book.container)).snapshot).toEqual(latest);
    expect(registry.get(book.container)).toBeUndefined();
  });

  it("adopts partial-save progress before an explicit Retry without forcing", async () => {
    const { h, book, entry } = await setup();
    const detach = entry.subscribe(() => {});
    const save = vi.spyOn(h.service, "save");
    const changed = snapshot("Partial\nedit");
    const saved = vi.fn();
    const stopSaved = entry.onSaved(saved);
    entry.schedule(() => changed);
    h.setHook((call) =>
      call.method === "PUT" && call.url.endsWith("1.jsonld")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await entry.flush();
    const first = await save.mock.results[0]?.value.catch((error: unknown) => error);
    expect(first).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(first instanceof WorkbookPartialSaveError)) throw first;
    expect(entry.workbook.version).toEqual(first.version);
    expect(saved).toHaveBeenCalledExactlyOnceWith(changed, first.version.snapshotEtag);
    expect(entry.status).toBe("error");
    h.setHook(() => undefined);
    await entry.retry();
    expect(save.mock.calls[1]?.[2]).toEqual(first.version);
    expect(save.mock.calls[1]?.[3]?.force).toBe(false);
    expect(entry.status).toBe("saved");
    stopSaved();
    detach();
    await entry.flush();
    expect((await h.service.open(book.container)).snapshot).toEqual(changed);
  });

  it.each([
    "workbook.json",
    "index.ttl",
  ])("does not associate a failed %s verification's old ETag with newer edits", async (resource) => {
    const { h, entry } = await setup();
    const detach = entry.subscribe(() => {});
    const saved = vi.fn();
    const stopSaved = entry.onSaved(saved);
    let written = false;
    h.setHook(async (call) => {
      if (!call.url.endsWith(resource)) return;
      if (call.method === "PUT") {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        written = true;
        return response;
      }
      if (written) return new Response(null, { status: 503 });
    });
    entry.schedule(() => snapshot("First\nedit"));
    await entry.flush();
    expect(entry.status).toBe("error");
    expect(saved).toHaveBeenCalledTimes(resource === "workbook.json" ? 0 : 1);
    saved.mockClear();
    const latest = snapshot("Latest\nedit");
    entry.schedule(() => latest);
    await entry.retry();
    expect(entry.status).toBe("error");
    expect(saved).not.toHaveBeenCalled();
    h.setHook(() => undefined);
    await entry.retry();
    expect(saved).toHaveBeenCalledExactlyOnceWith(latest, entry.workbook.version.snapshotEtag);
    stopSaved();
    detach();
    await entry.flush();
  });

  it("preserves detached conflicts for reopen, never retries on reconnect, and can Keep mine", async () => {
    const { h, book, registry, entry, setOnline } = await setup();
    const detach = entry.subscribe(() => {});
    const mine = snapshot("Mine\nedit");
    await h.service.rename(book.container, "Theirs", book.version);
    entry.schedule(() => mine);
    detach();
    await entry.flush();
    expect(entry.status).toBe("conflict");
    expect(registry.get(book.container)?.workbook.snapshot).toEqual(mine);
    const save = vi.spyOn(h.service, "save");
    setOnline(false);
    setOnline(true);
    await entry.flush();
    expect(save).not.toHaveBeenCalled();
    const close = registry.acquire(h.service, book).subscribe(() => {});
    await entry.retry(true);
    expect(save.mock.calls[0]?.[3]?.force).toBe(true);
    expect((await h.service.open(book.container)).snapshot).toEqual(mine);
    close();
    await entry.flush();
    expect(registry.get(book.container)).toBeUndefined();
  });

  it("can Load their version or discard a conflict without saving it", async () => {
    const { h, book, entry, registry } = await setup();
    const detach = entry.subscribe(() => {});
    const save = vi
      .spyOn(h.service, "save")
      .mockRejectedValueOnce(new WorkbookConflictError(book.container));
    entry.schedule(() => snapshot("Mine\nedit"));
    await entry.flush();
    const remote = { ...book, snapshot: snapshot("Theirs\nedit") };
    entry.reset(remote);
    expect(entry.workbook.snapshot).toEqual(remote.snapshot);
    expect(entry.status).toBe("saved");
    entry.schedule(() => snapshot());
    entry.discard();
    await entry.flush();
    expect(save).toHaveBeenCalledTimes(1);
    detach();
    await entry.flush();
    expect(registry.get(book.container)).toBeUndefined();
    registry.prune();
  });

  it("warns on tab close only while dirty and removes browser listeners when settled", async () => {
    const { entry, registry, events, setOnline } = await setup(false);
    const add = vi.spyOn(events, "addEventListener");
    const remove = vi.spyOn(events, "removeEventListener");
    registry.connect(events, () => false);
    expect(add).not.toHaveBeenCalled();
    const clean = new Event("beforeunload", { cancelable: true });
    events.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    const detach = entry.subscribe(() => {});
    entry.schedule(() => snapshot());
    const dirty = new Event("beforeunload", { cancelable: true });
    events.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    detach();
    setOnline(true);
    await entry.flush();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(["online", "offline", "beforeunload"]);
  });

  it("serializes renames and edits with the latest version, including renames during a write", async () => {
    const { h, book, entry } = await setup();
    const detach = entry.subscribe(() => {});
    entry.rename(" Renamed ");
    await entry.flush();
    expect(entry.workbook.metadata.title).toBe("Renamed");
    const save = vi.spyOn(h.service, "save");
    entry.schedule(() => snapshot("Cells\nchanged"));
    const saving = entry.flush();
    entry.rename("Final title");
    await saving;
    await entry.flush();
    expect((await h.service.open(book.container)).metadata.title).toBe("Final title");
    expect(save.mock.calls.at(-1)?.[2].indexEtag).not.toBe(book.version.indexEtag);
    detach();
    await entry.flush();
  });

  it("omits unchanged titles, adopts a racing remote rename, and sends only local renames", async () => {
    const { h, book, entry } = await setup();
    const detach = entry.subscribe(() => {});
    const save = vi.spyOn(h.service, "save");
    let renamed = false;
    h.setHook(async (call) => {
      if (!renamed && call.method === "PUT" && call.url.endsWith("workbook.json")) {
        renamed = true;
        await h.service.rename(book.container, "Remote title", book.version);
      }
    });
    entry.schedule(() => snapshot("First\nedit"));
    await entry.flush();
    expect(save.mock.calls[0]?.[3]).toEqual({ force: false });
    expect(entry.workbook.metadata.title).toBe("Remote title");
    entry.rename("Local title");
    await entry.flush();
    expect(save.mock.calls[1]?.[3]?.title).toBe("Local title");
    entry.schedule(() => snapshot("Second\nedit"));
    await entry.flush();
    expect(save.mock.calls[2]?.[3]).toEqual({ force: false });
    detach();
    await entry.flush();
  });

  it("preserves a rename made while a save is awaiting its result", async () => {
    const { h, entry } = await setup();
    const detach = entry.subscribe(() => {});
    let finish = () => {};
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = h.service.save.bind(h.service);
    const save = vi.spyOn(h.service, "save").mockImplementationOnce(async (...args) => {
      await paused;
      return original(...args);
    });
    entry.schedule(() => snapshot("Cells\nchanged"));
    const saving = entry.flush();
    await Promise.resolve();
    entry.rename("Renamed during save");
    finish();
    await saving;
    await entry.flush();
    expect(save.mock.calls[0]?.[3]?.title).toBeUndefined();
    expect(save.mock.calls[1]?.[3]?.title).toBe("Renamed during save");
    expect(entry.workbook.metadata.title).toBe("Renamed during save");
    detach();
    await entry.flush();
  });

  it("drops detached offline edits and removes their unload and reconnect listeners", async () => {
    const { h, book, entry, registry, events, setOnline } = await setup(false);
    const remove = vi.spyOn(events, "removeEventListener");
    const save = vi.spyOn(h.service, "save");
    const detach = entry.subscribe(() => {});
    entry.schedule(() => snapshot("Offline\nedit"));
    detach();
    await h.service.remove(book.container);
    registry.drop(book.container);
    expect(entry.dirty).toBe(false);
    expect(registry.get(book.container)).toBeUndefined();
    const closing = new Event("beforeunload", { cancelable: true });
    events.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(false);
    expect(remove).toHaveBeenCalledTimes(3);
    setOnline(true);
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    registry.drop(book.container);
  });

  it("drops a queued save before its writer starts", async () => {
    const { h, book, entry, registry } = await setup();
    const save = vi.spyOn(h.service, "save");
    entry.schedule(() => snapshot("Deleted\nedit"));
    const saving = entry.flush();
    registry.drop(book.container);
    await saving;
    expect(save).not.toHaveBeenCalled();
    expect(entry.dirty).toBe(false);
    expect(registry.get(book.container)).toBeUndefined();
  });

  it.each([
    true,
    false,
  ])("ignores an in-flight save settling after drop (success %s)", async (success) => {
    const { h, book, entry, registry } = await setup();
    const detach = entry.subscribe(() => {});
    let finish = () => {};
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi.spyOn(h.service, "save").mockImplementation(async () => {
      await paused;
      if (!success) throw new WorkbookConflictError(book.container);
      return book;
    });
    entry.schedule(() => snapshot("First\nedit"));
    const saving = entry.flush();
    await Promise.resolve();
    registry.drop(book.container);
    const replacement = registry.acquire(h.service, book);
    const close = replacement.subscribe(() => {});
    finish();
    await saving;
    detach();
    await entry.flush();
    expect(registry.get(book.container)).toBe(replacement);
    expect(save).toHaveBeenCalledOnce();
    close();
    await replacement.flush();
    expect(registry.get(book.container)).toBeUndefined();
  });

  it("holds independent containers and retries a detached transient failure on online", async () => {
    const { h, book, entry, registry, setOnline } = await setup();
    const other = await h.service.create({ title: "Other", snapshot: snapshot() });
    const second = registry.acquire(h.service, other);
    const detach = entry.subscribe(() => {});
    const close = second.subscribe(() => {});
    h.setHook((call) =>
      call.method === "PUT" && call.url.startsWith(book.container)
        ? new Response(null, { status: 503 })
        : undefined,
    );
    entry.schedule(() => snapshot("Held\nedit"));
    detach();
    await entry.flush();
    second.schedule(() => snapshot("Other\nedit"));
    await second.flush();
    expect(entry.status).toBe("error");
    expect(second.status).toBe("saved");
    close();
    await second.flush();
    expect(registry.get(other.container)).toBeUndefined();
    h.setHook(() => undefined);
    setOnline(true);
    await entry.flush();
    expect(registry.get(book.container)).toBeUndefined();
  });
});

it("does not schedule, rename, retry or reconnect saves for a read-only workbook", async () => {
  const { h, book, registry, entry } = await setup();
  const save = vi.spyOn(h.service, "save");
  const detach = entry.subscribe(() => {});
  entry.reset({ ...book, readOnly: true });
  entry.schedule(() => snapshot("Blocked"));
  entry.rename("Blocked title");
  entry.setOnline(false);
  entry.setOnline(true);
  await entry.retry(true);
  await entry.flush();
  expect(save).not.toHaveBeenCalled();
  expect(entry.dirty).toBe(false);
  expect(entry.workbook.metadata.title).toBe(book.metadata.title);
  detach();
  await entry.flush();
  expect(registry.get(book.container)).toBeUndefined();
});

it("retains edits after a nested forbidden save while stopping every automatic retry", async () => {
  const { h, book, registry, entry, setOnline } = await setup();
  const save = vi
    .spyOn(h.service, "save")
    .mockRejectedValueOnce(
      new WorkbookPartialSaveError(
        book.version,
        new Error("Derived write failed", { cause: new SheetStorageError(403, null) }),
      ),
    );
  const detach = entry.subscribe(() => {});
  const local = snapshot("Unsaved edits");
  entry.schedule(() => local);
  await entry.flush();
  expect(entry.workbook.readOnly).toBe(true);
  expect(entry.workbook.snapshot).toEqual(local);
  expect(entry.dirty).toBe(true);
  setOnline(false);
  setOnline(true);
  entry.schedule(() => snapshot("Blocked edit"));
  entry.rename("Blocked title");
  await entry.retry();
  await entry.flush();
  expect(save).toHaveBeenCalledOnce();
  detach();
  registry.drop(book.container);
});
