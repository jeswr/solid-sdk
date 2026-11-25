// AUTHORED-BY Claude Sonnet 5.5
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cells, LOCAL_ORIGIN, sheetStates } from "../src/apps/sheets/lib/collaboration/model";
import type { WorkbookCollaboration } from "../src/apps/sheets/lib/collaboration/persistence";
import {
  type MountEngine,
  type SheetEngine,
  type Snapshot,
  WorkbookConflictError,
  type WorkbookService,
} from "../src/apps/sheets/lib/contract";
import { pendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { act, click, h, mount } from "./drive-ui-dom";
import { harness } from "./sheets-workbook-helpers";

const mocks = vi.hoisted(() => ({
  service: null as WorkbookService | null,
  session: null as { fetch: typeof fetch; storageUrl: string; webId: string; mode: "demo" } | null,
  mount: vi.fn<MountEngine>(),
  push: vi.fn(),
}));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: mocks.session }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    children,
    context,
    actions,
  }: {
    children: ReactNode;
    context: ReactNode;
    actions: ReactNode;
  }) => h("main", { id: "main-content", tabIndex: -1 }, context, actions, children),
}));
vi.mock("../src/apps/sheets/state/service", () => ({ useWorkbookService: () => mocks.service }));
vi.mock("../src/apps/sheets/lib/engine", () => ({ loadEngine: async () => mocks.mount }));
vi.mock("../src/apps/sheets/components/sheets-sidebar", () => ({
  SheetsSidebar: () => null,
  workbookHref: () => "/sheets/book",
}));

import { SheetEditor } from "../src/apps/sheets/components/sheet-editor";

function fakeEngine(initial: Snapshot) {
  let current = initial;
  const engine: SheetEngine = {
    load: vi.fn((next) => {
      current = next;
    }),
    snapshot: vi.fn(() => current),
    onChange: vi.fn(() => () => {}),
    setDark: vi.fn(),
    setReadOnly: vi.fn(),
    dispose: vi.fn(),
    exportCsv: vi.fn(() => ""),
    activeSheet: vi.fn(() => ({ id: "data", name: "Data" })),
    importCsv: vi.fn(() => ({ status: "imported" as const })),
  };
  return engine;
}
function buttons(root: ParentNode) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent?.trim());
}
function button(root: ParentNode, label: string) {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function edit(runtime: WorkbookCollaboration, value: string) {
  const state = sheetStates(runtime.doc).get("data");
  const key = [...cells(state as NonNullable<typeof state>).keys()][0] as string;
  runtime.doc.transact(
    () => cells(state as NonNullable<typeof state>).set(key, { v: value }),
    LOCAL_ORIGIN,
  );
}
const text = (runtime: WorkbookCollaboration) => JSON.stringify(sheetStates(runtime.doc).toJSON());
const base: Snapshot = {
  id: "ignored",
  sheetOrder: ["data"],
  styles: {},
  sheets: {
    data: {
      id: "data",
      name: "Data",
      rowCount: 3,
      columnCount: 2,
      cellData: { 0: { 0: { v: "Yesterday" } } },
    },
  },
};
async function setup() {
  const pod = await harness();
  const book = await pod.service.create({
    title: `Elsewhere ${crypto.randomUUID()}`,
    snapshot: base,
  });
  mocks.service = pod.service;
  mocks.session = { ...pod.options, storageUrl: pod.options.podRoot, mode: "demo" };
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  return { ...pod, book };
}
beforeEach(() => {
  mocks.mount.mockReset();
  mocks.mount.mockImplementation(async (_host, options) => fakeEngine(options.snapshot));
  vi.stubGlobal("matchMedia", window.matchMedia);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("retires a second client's log when another client restores, so the restored content stays", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const pod = await setup();
  const { book } = pod;
  const a = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  const b = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  edit(a, "Today");
  await a.flush();
  await b.sync();
  expect(text(b)).toContain("Today");
  const retired = vi.fn();
  b.onRetired(retired);

  // A restores yesterday's version under a fresh instance id and remounts onto a new log.
  const restored = { ...book.snapshot, id: crypto.randomUUID() };
  await pod.service.save(book.container, restored, book.version, { force: true });
  await a.destroy().catch(() => {});
  const fresh = (await pod.service.collaborate?.(
    book.container,
    restored,
    false,
  )) as WorkbookCollaboration;
  expect(text(fresh)).toContain("Yesterday");
  vi.setSystemTime(Date.now() + 10_000);

  // B edits: its append notices the new instance id, writes nothing, and retires.
  const oldLog = new URL(`collab/${book.snapshot.id}/`, book.container).href;
  pod.calls.length = 0;
  edit(b, "Stale edit");
  await expect(b.flush()).rejects.toThrow("deleted or replaced");
  expect(retired).toHaveBeenCalledTimes(1);
  expect(b.isRetired).toBe(true);
  expect(
    pod.calls.filter(
      (call) => call.method === "PUT" && call.url.startsWith(oldLog) && !call.url.endsWith("/"),
    ),
  ).toEqual([]);
  await fresh.sync();
  expect(text(fresh)).toContain("Yesterday");
  expect(text(fresh)).not.toContain("Stale edit");
  expect(text(fresh)).not.toContain("Today");
  await fresh.destroy();

  // B reopens on the new instance and lands on the restored log.
  const reopened = (await pod.service.collaborate?.(
    book.container,
    (
      await pod.service.open(book.container)
    ).snapshot,
    false,
  )) as WorkbookCollaboration;
  expect(text(reopened)).toContain("Yesterday");
  expect(text(reopened)).not.toContain("Stale edit");
  await reopened.destroy();
});

it("reports a save through a retired log as a conflict, not a retryable error", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const pod = await setup();
  const { book } = pod;
  const stale = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  // The workbook is restored elsewhere under a fresh instance id.
  const restored = { ...book.snapshot, id: crypto.randomUUID() };
  const saved = await pod.service.save(book.container, restored, book.version, { force: true });
  vi.setSystemTime(Date.now() + 10_000);
  edit(stale, "Stale edit");
  await expect(pod.service.save(book.container, book.snapshot, saved.version)).rejects.toThrow(
    WorkbookConflictError,
  );
  expect(stale.isRetired).toBe(true);
  expect((await pod.service.open(book.container)).snapshot.id).toBe(restored.id);
});

it("keeps an ordinary flush failure as a retryable save error", async () => {
  const pod = await setup();
  const { book } = pod;
  const live = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  vi.spyOn(live, "flush").mockRejectedValueOnce(new Error("Network down"));
  const failure = await pod.service
    .save(book.container, book.snapshot, book.version)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(WorkbookConflictError);
  expect((failure as Error).message).toBe("Network down");
  expect(live.isRetired).toBe(false);
  await live.destroy();
});

it("retires an idle client on sync, so it stops reading and flushing the old log", async () => {
  const pod = await setup();
  const { book } = pod;
  const viewer = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  const retired = vi.fn();
  viewer.onRetired(retired);
  await viewer.sync();
  expect(retired).not.toHaveBeenCalled();
  await pod.service.save(
    book.container,
    { ...book.snapshot, id: crypto.randomUUID() },
    book.version,
    { force: true },
  );
  await viewer.sync();
  expect(retired).toHaveBeenCalledTimes(1);
  await expect(viewer.flush()).rejects.toThrow("deleted or replaced");
});

it("does not retire the log when the currency check fails transiently", async () => {
  const pod = await setup();
  const { book } = pod;
  const client = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  pod.setHook((call) =>
    call.url.endsWith("workbook.json") ? new Response(null, { status: 503 }) : undefined,
  );
  await client.sync();
  expect(client.isRetired).toBe(false);
  pod.setHook(() => undefined);
  await client.destroy();
});

it.each([
  401, 408, 429, 500, 503,
])("fails the open on a transient %i from a log member instead of skipping it", async (status) => {
  const pod = await setup();
  const { book } = pod;
  const first = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  edit(first, "Edited");
  await first.flush();
  await first.destroy();
  pod.setHook((call) =>
    call.method === "GET" && /\/collab\/[^/]+\/[^/]+$/.test(call.url) && !call.url.endsWith("/seed")
      ? new Response(null, { status })
      : undefined,
  );
  await expect(pod.service.collaborate?.(book.container, book.snapshot, false)).rejects.toThrow(
    String(status),
  );
});

it("skips a forbidden log member and counts it", async () => {
  const pod = await setup();
  const { book } = pod;
  const first = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  edit(first, "Edited");
  await first.flush();
  await first.destroy();
  pod.setHook((call) =>
    call.method === "GET" && /\/collab\/[^/]+\/[^/]+$/.test(call.url) && !call.url.endsWith("/seed")
      ? new Response(null, { status: 403 })
      : undefined,
  );
  const skipping = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  expect(skipping.skippedUpdates).toBeGreaterThan(0);
  await skipping.destroy();
});

it("remounts a clean editor onto the restored instance when its collaboration is retired", async () => {
  const pod = await setup();
  const { book } = pod;
  const editor = await mount(h(SheetEditor, { container: book.container }));
  await act(async () => {
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  });
  const first = mocks.mount.mock.calls[0]?.[1];
  const restored = { ...book.snapshot, id: crypto.randomUUID() };
  await pod.service.save(book.container, restored, book.version, { force: true });
  await act(async () => {
    await first?.collaboration?.sync();
  });
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2));
  const second = mocks.mount.mock.calls[1]?.[1];
  expect(second?.snapshot.id).toBe(restored.id);
  expect(second?.collaboration).not.toBe(first?.collaboration);
  await editor.unmount();
});

it("never loads a snapshot of another instance into the mounted engine, and refuses Keep mine across a restore", async () => {
  const pod = await setup();
  const { book } = pod;
  const editor = await mount(h(SheetEditor, { container: book.container }));
  await act(async () => {
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  });
  const engine = await mocks.mount.mock.results[0]?.value;
  const entry = pendingSaves.get(book.container);
  const restored = { ...book.snapshot, id: crypto.randomUUID() };
  await pod.service.save(book.container, restored, book.version, { force: true });
  // Unsaved local edits on this stale client: the save conflicts and the dialog tells the user.
  await act(async () => {
    entry?.schedule(() => ({ ...book.snapshot }));
    await entry?.flush();
  });
  await vi.waitFor(() => expect(entry?.status).toBe("conflict"));
  await vi.waitFor(() => expect(buttons(document)).toContain("Load their version"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("restored somewhere else"));
  expect(buttons(document)).not.toContain("Keep mine");
  expect(buttons(document)).toContain("Save mine as a copy");
  expect(mocks.mount).toHaveBeenCalledTimes(1);

  await click(button(document, "Load their version"));
  expect(engine.load).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2));
  expect(mocks.mount.mock.calls[1]?.[1].snapshot.id).toBe(restored.id);
  await editor.unmount();
});

it("keeps Keep mine for an ordinary conflict, but checks the stored id before forcing", async () => {
  const pod = await setup();
  const { book } = pod;
  const editor = await mount(h(SheetEditor, { container: book.container }));
  await act(async () => {
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  });
  const entry = pendingSaves.get(book.container);
  const remote = { ...book.snapshot, styles: { remote: { bl: 1 } } };
  await pod.service.save(book.container, remote, book.version, { title: "Remote title" });
  await act(async () => {
    entry?.schedule(() => ({ ...book.snapshot }));
    await entry?.flush();
  });
  await vi.waitFor(() => expect(buttons(document)).toContain("Keep mine"));
  await editor.unmount();
});

it("opens read-only with a notice when log members were skipped, until the user chooses to edit", async () => {
  const pod = await setup();
  const { book } = pod;
  const first = (await pod.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  edit(first, "Edited");
  await first.flush();
  await first.destroy();
  pod.setHook((call) =>
    call.method === "GET" && /\/collab\/[^/]+\/[^/]+$/.test(call.url) && !call.url.endsWith("/seed")
      ? new Response(null, { status: 403 })
      : undefined,
  );
  const editor = await mount(h(SheetEditor, { container: book.container }));
  await act(async () => {
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  });
  const options = mocks.mount.mock.calls[0]?.[1];
  const engine = await mocks.mount.mock.results[0]?.value;
  expect(options?.readOnly).toBe(true);
  await vi.waitFor(() => expect(engine.setReadOnly).toHaveBeenCalledWith(true, false));
  expect(editor.host.textContent).toContain("Some cells may show older values");
  await click(button(editor.host, "Edit anyway"));
  expect(engine.setReadOnly).toHaveBeenLastCalledWith(false);
  expect(editor.host.textContent).not.toContain("Edit anyway");
  await editor.unmount();
});

it("does not report a published restore as failed when the queue goes offline right after the save", async () => {
  const pod = await setup();
  const { book } = pod;
  const entry = pendingSaves.acquire(pod.service, book);
  const restored = { ...book.snapshot, id: crypto.randomUUID() };
  pod.setHook(async (call) => {
    if (call.method !== "PUT" || !call.url.endsWith("workbook.json")) return undefined;
    const response = await pod.pod.fetch(call.url, call.init);
    entry.setOnline(false);
    return response;
  });
  await expect(entry.restore(restored)).resolves.toBeUndefined();
  pod.setHook(() => undefined);
  expect((await pod.service.open(book.container)).snapshot.id).toBe(restored.id);
  expect(entry.workbook.snapshot.id).toBe(restored.id);
  pendingSaves.drop(book.container);
});
