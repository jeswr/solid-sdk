// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withCharts } from "../src/apps/sheets/lib/charts/spec";
import type {
  MountEngine,
  SheetEngine,
  Snapshot,
  WorkbookService,
} from "../src/apps/sheets/lib/contract";
import { pendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

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
import { SheetsList } from "../src/apps/sheets/components/sheets-list";

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
function button(root: ParentNode, label: string) {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function setup(online = true) {
  const pod = await harness();
  const book = await pod.service.create({ title: "Conflict", snapshot: snapshot() });
  mocks.service = pod.service;
  mocks.session = { ...pod.options, storageUrl: pod.options.podRoot, mode: "demo" };
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
  return { ...pod, book };
}
async function conflict() {
  const pod = await setup();
  const local = snapshot("Local\nedit");
  const remote = snapshot("Remote\nvalues");
  const entry = pendingSaves.acquire(pod.service, pod.book);
  await pod.service.save(pod.book.container, remote, pod.book.version, { title: "Remote title" });
  entry.schedule(() => local);
  await entry.flush();
  expect(entry.status).toBe("conflict");
  return { ...pod, local, remote, entry };
}
beforeEach(() => {
  mocks.mount.mockReset();
  mocks.mount.mockImplementation(async (_host, options) => fakeEngine(options.snapshot));
  mocks.push.mockReset();
  vi.stubGlobal("matchMedia", window.matchMedia);
});
afterEach(() => vi.restoreAllMocks());

it("loads the remote snapshot into a mounted engine and returns conflict focus to File", async () => {
  const { book, remote, entry } = await conflict();
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  expect(mocks.mount.mock.calls[0]?.[1].commentsLoading).toBe(true);
  expect(document.activeElement?.textContent).toBe("Load their version");
  await click(button(document, "Load their version"));
  expect(engine.load).toHaveBeenCalledWith(remote, entry.workbook.version.snapshotEtag);
  expect(engine.snapshot()).toEqual(remote);
  expect(entry.workbook.snapshot).toEqual(remote);
  expect(entry.status).toBe("saved");
  await vi.waitFor(() => expect(document.activeElement).toBe(button(editor.host, "File")));
  await editor.unmount();
});

it("acknowledges saved workbook revisions for both renames and engine edits", async () => {
  const { book } = await setup();
  mocks.mount.mockImplementationOnce(async (_host, options) => ({
    ...fakeEngine(options.snapshot),
    setWorkbookRevision: vi.fn(),
  }));
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  expect(mocks.mount.mock.calls[0]?.[1].workbookRevision).toBe(book.version.snapshotEtag);
  const entry = pendingSaves.get(book.container);
  await act(async () => {
    entry?.rename("Renamed before editing");
    await entry?.flush();
  });
  expect(engine.setWorkbookRevision).toHaveBeenCalledWith(
    entry?.workbook.version.snapshotEtag,
    book.snapshot,
  );
  await act(async () => {
    vi.mocked(engine.onChange).mock.calls[0]?.[0]();
    await entry?.flush();
  });
  expect(engine.setWorkbookRevision).toHaveBeenLastCalledWith(
    entry?.workbook.version.snapshotEtag,
    engine.snapshot(),
  );
  await editor.unmount();
});

it.each([
  "https://other.example/sheets/book/",
  "not a URL",
])("explains the credential boundary when rejecting shared workbook link %s", async (container) => {
  const { calls } = await setup();
  calls.length = 0;
  const editor = await mount(h(SheetEditor, { container }));
  expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain(
    "same origin as your pod",
  );
  expect(calls).toEqual([]);
  expect(mocks.mount).not.toHaveBeenCalled();
  await editor.unmount();
});

it.each([
  401, 403,
])("explains unsupported private recipient access (%s) before mounting a grid", async (status) => {
  const { book, options } = await setup();
  const publicFetch = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.credentials).toBe("omit");
    return new Response(null, { status });
  });
  mocks.service = createWorkbookService({
    ...options,
    podRoot: "https://pod.example/bob/",
    publicFetch,
  });
  const editor = await mount(h(SheetEditor, { container: book.container }));
  expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain(
    "You need access from the owner's pod; opening private workbooks shared from another pod is not supported yet",
  );
  expect(mocks.mount).not.toHaveBeenCalled();
  expect(publicFetch).toHaveBeenCalledTimes(2);
  await editor.unmount();
});

it("remounts a still-loading grid with the remote snapshot when resolving a reopened conflict", async () => {
  const { book, local, remote, entry } = await conflict();
  const waiting = deferred<SheetEngine>();
  mocks.mount.mockImplementationOnce(() => waiting.promise);
  const editor = await mount(h(SheetEditor, { container: book.container }));
  expect(mocks.mount.mock.calls[0]?.[1].snapshot).toEqual(local);
  await click(button(document, "Load their version"));
  expect(mocks.mount).toHaveBeenCalledTimes(2);
  expect(mocks.mount.mock.calls[1]?.[1].snapshot).toEqual(remote);
  const active = await mocks.mount.mock.results[1]?.value;
  expect(active.snapshot()).toEqual(remote);
  expect(entry.workbook.snapshot).toEqual(remote);
  expect(entry.status).toBe("saved");
  const discarded = fakeEngine(local);
  await act(() => waiting.resolve(discarded));
  expect(discarded.dispose).toHaveBeenCalledOnce();
  expect(active.snapshot()).toEqual(remote);
  await vi.waitFor(() => expect(document.activeElement).toBe(button(editor.host, "File")));
  await editor.unmount();
});

it("returns conflict focus after Keep mine finishes and File becomes enabled", async () => {
  const { service, book, local, entry } = await conflict();
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const waiting = deferred<void>();
  const original = service.save.bind(service);
  const save = vi.spyOn(service, "save").mockImplementationOnce(async (...args) => {
    await waiting.promise;
    return original(...args);
  });
  await click(button(document, "Keep mine"));
  const file = button(editor.host, "File");
  expect(entry.status).toBe("saving");
  expect(file.disabled).toBe(true);
  await act(async () => {
    waiting.resolve();
    await entry.flush();
  });
  expect(save.mock.calls[0]?.[3]?.force).toBe(true);
  expect(entry.status).toBe("saved");
  expect((await service.open(book.container)).snapshot).toEqual(local);
  expect(file.disabled).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe(file));
  await editor.unmount();
});

it("remounts local edits after Load their version is forbidden, then keeps those edits", async () => {
  const { service, book, setHook } = await setup();
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  const local = snapshot("Local\nunsaved edits", true);
  engine.load(local);
  const entry = pendingSaves.get(book.container);
  if (!entry) throw new Error("Missing pending writer");
  await service.save(book.container, snapshot("Remote\nedits"), book.version);
  await act(async () => {
    vi.mocked(engine.onChange).mock.calls[0]?.[0]();
    await entry.flush();
  });
  expect(entry.status).toBe("conflict");
  expect(entry.workbook.snapshot).toEqual(local);
  setHook((call) =>
    call.method === "GET" && call.url.endsWith("workbook.json")
      ? new Response(null, { status: 403 })
      : undefined,
  );
  await click(button(document, "Load their version"));
  expect(editor.host.textContent).toContain("Couldn't open this spreadsheet");
  expect(engine.dispose).toHaveBeenCalledOnce();
  expect(entry.workbook.snapshot).toEqual(local);
  setHook(() => undefined);
  await click(button(editor.host, "Retry"));
  expect(mocks.mount.mock.calls.at(-1)?.[1].snapshot).toEqual(local);
  await click(button(document, "Keep mine"));
  expect(entry.status).toBe("saved");
  expect((await service.open(book.container)).snapshot).toEqual(local);
  await editor.unmount();
});

it("starts the grid from the new workbook's snapshot when navigating between containers", async () => {
  const { service, book } = await setup();
  const other = await service.create({ title: "Other", snapshot: snapshot("Other\nvalues") });
  const editor = await mount(h(SheetEditor, { container: book.container }));
  await editor.render(h(SheetEditor, { container: other.container }));
  expect(mocks.mount.mock.calls.at(-1)?.[1].snapshot).toEqual(other.snapshot);
  await editor.unmount();
});

it.each([
  401, 403, 404, 410,
])("renders the appropriate open error and pending-edit actions for %s", async (status) => {
  const { service, book, setHook } = await setup(false);
  const local = snapshot("Offline\nedit");
  const entry = pendingSaves.acquire(service, book);
  entry.setOnline(false);
  entry.schedule(() => local);
  await entry.flush();
  setHook((call) =>
    call.method === "GET" && call.url.endsWith("workbook.json")
      ? new Response(null, { status })
      : undefined,
  );
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const forbidden = status === 401 || status === 403;
  expect(editor.host.textContent).toContain(forbidden ? "Couldn't open" : "Can't open");
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(forbidden);
  if (forbidden) {
    expect(pendingSaves.get(book.container)).toBe(entry);
    setHook(() => undefined);
    await click(button(editor.host, "Retry"));
    expect(mocks.mount.mock.calls.at(-1)?.[1].snapshot).toEqual(local);
  } else {
    expect(editor.host.querySelector("button")).toBeNull();
    expect(pendingSaves.get(book.container)).toBeUndefined();
  }
  await editor.unmount();
  pendingSaves.drop(book.container);
});

it.each([
  "list",
  "editor",
])("deletes from the %s and clears offline pending data before reconnect", async (view) => {
  const { service, book } = await setup(false);
  const entry = pendingSaves.acquire(service, book);
  entry.setOnline(false);
  entry.schedule(() => snapshot("Offline\nedit"));
  await entry.flush();
  const screen = await mount(
    view === "list" ? h(SheetsList) : h(SheetEditor, { container: book.container }),
  );
  const trigger =
    view === "list"
      ? screen.host.querySelector<HTMLButtonElement>('[aria-label="Actions for Conflict"]')
      : button(screen.host, "File");
  if (!trigger) throw new Error("Missing menu trigger");
  await key(trigger, "ArrowDown");
  const remove = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Delete",
  );
  if (!remove) throw new Error("Missing delete menu item");
  await click(remove);
  await click(button(document, "Delete"));
  expect(pendingSaves.get(book.container)).toBeUndefined();
  await expect(service.open(book.container)).rejects.toMatchObject({
    name: "WorkbookNotFoundError",
  });
  const save = vi.spyOn(service, "save");
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
  if (view === "editor") expect(mocks.push).toHaveBeenCalledWith("/sheets");
  await screen.unmount();
});

it.each([
  "editor",
  "list",
])("opens the shell sharing dialog for the workbook container from the %s", async (view) => {
  const { book, calls } = await setup();
  for (const name of [
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "SVGElement",
    "DocumentFragment",
  ] as const)
    vi.stubGlobal(name, window[name]);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const screen = await mount(
    view === "editor" ? h(SheetEditor, { container: book.container }) : h(SheetsList),
  );
  if (view === "editor") await click(button(screen.host, "Share"));
  else {
    const trigger = screen.host.querySelector<HTMLButtonElement>(
      '[aria-label="Actions for Conflict"]',
    );
    if (!trigger) throw new Error("Missing menu");
    await key(trigger, "ArrowDown");
    const share = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Share",
    );
    if (!share) throw new Error("Missing Share");
    await click(share);
  }
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("People with access"),
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Share Conflict");
  expect(calls.some((call) => call.method === "HEAD" && call.url === book.container)).toBe(true);
  expect(calls.some((call) => call.method === "PUT" && call.url === `${book.container}.acl`)).toBe(
    true,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Commenter");
  await click(button(document, "Done"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await screen.unmount();
});

it("shows View only, disables engine editing and skips autosave for a reader", async () => {
  const { book, pod, service, setHook } = await setup();
  const chartSnapshot = withCharts(book.snapshot, [
    {
      id: "chart",
      sheetId: "data",
      range: "A1:B2",
      type: "column",
      title: "Shared chart",
      legend: true,
      series: "columns",
    },
  ]);
  await service.save(book.container, chartSnapshot, book.version);
  mocks.mount.mockImplementationOnce(async (_host, options) => ({
    ...fakeEngine(options.snapshot),
    setCharts: vi.fn(),
  }));
  setHook(async (call) => {
    if (call.method !== "GET" || !call.url.startsWith(book.container)) return undefined;
    const response = await pod.fetch(call.url, call.init);
    const headers = new Headers(response.headers);
    headers.set("wac-allow", 'user="read",public=""');
    return new Response(response.body, { status: response.status, headers });
  });
  const save = vi.spyOn(service, "save");
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  expect(mocks.mount.mock.calls[0]?.[1].readOnly).toBe(true);
  expect(engine.setReadOnly).toHaveBeenCalledWith(true);
  expect(editor.host.textContent).toContain("View only");
  expect(button(editor.host, "Share").disabled).toBe(true);
  await vi.waitFor(async () => {
    await act(() => {});
    expect(editor.host.querySelector("svg title")?.textContent).toBe("Shared chart");
  });
  expect(button(editor.host, "Insert chart").disabled).toBe(true);
  expect(button(editor.host, "Edit chart").disabled).toBe(true);
  await click(button(editor.host, "Insert chart"));
  await click(button(editor.host, "Edit chart"));
  expect(editor.host.querySelector('[aria-label="Chart editor"]')).toBeNull();
  expect(engine.setCharts).not.toHaveBeenCalled();
  await act(async () => {
    vi.mocked(engine.onChange).mock.calls[0]?.[0]();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("online"));
    await pendingSaves.get(book.container)?.flush();
  });
  expect(save).not.toHaveBeenCalled();
  await key(button(editor.host, "File"), "ArrowDown");
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  expect(
    items.find((item) => item.textContent === "Import CSV")?.getAttribute("aria-disabled"),
  ).toBe("true");
  expect(items.find((item) => item.textContent === "Delete")?.getAttribute("aria-disabled")).toBe(
    "true",
  );
  await key(button(editor.host, "File"), "Escape");
  await editor.unmount();
  expect(save).not.toHaveBeenCalled();
});

it("switches the mounted editor to View only after a forbidden save", async () => {
  const { book, service, setHook } = await setup();
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  const save = vi.spyOn(service, "save");
  setHook((call) => (call.method === "PUT" ? new Response(null, { status: 403 }) : undefined));
  await act(async () => {
    vi.mocked(engine.onChange).mock.calls[0]?.[0]();
    await pendingSaves.get(book.container)?.flush();
  });
  expect(editor.host.textContent).toContain("View only");
  expect(engine.setReadOnly).toHaveBeenLastCalledWith(true);
  await act(async () => {
    vi.mocked(engine.onChange).mock.calls[0]?.[0]();
    window.dispatchEvent(new Event("online"));
    await pendingSaves.get(book.container)?.retry();
  });
  expect(save).toHaveBeenCalledOnce();
  await editor.unmount();
  pendingSaves.drop(book.container);
});

it("opens File version history, previews independently and restores through the conflict reload path", async () => {
  const { book, service } = await setup();
  const history = service.versions?.(book.container);
  await history?.capture("Original workbook");
  const changed = await service.save(book.container, snapshot("Current workbook"), book.version);
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const engine = await mocks.mount.mock.results[0]?.value;
  const load = vi.spyOn(service, "open");
  await key(button(editor.host, "File"), "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent === "Version history",
  );
  if (!item) throw new Error("Missing version history menu item");
  await click(item);
  await act(async () => {
    await import("../src/apps/sheets/components/version-history");
  });
  expect(document.querySelector('[aria-label="Spreadsheet versions"]')).not.toBeNull();
  expect(engine.setReadOnly).toHaveBeenLastCalledWith(true);
  const version = [
    ...document.querySelectorAll<HTMLButtonElement>('[aria-label="Spreadsheet versions"] button'),
  ].find((node) => node.textContent?.includes("Original workbook"));
  if (!version) throw new Error("Missing original version");
  await click(version);
  expect(mocks.mount.mock.calls.at(-1)?.[1].readOnly).toBe(true);
  expect(engine.load).not.toHaveBeenCalled();
  await click(button(document, "Restore this version"));
  await click(button(document, "Restore"));
  await vi.waitFor(() => expect(engine.load).toHaveBeenCalled());
  const opened = await service.open(book.container);
  expect(engine.load).toHaveBeenCalledWith(book.snapshot, opened.version.snapshotEtag);
  expect(opened.version.snapshotEtag).not.toBe(changed.version.snapshotEtag);
  expect(load).toHaveBeenCalled();
  expect(engine.setReadOnly).toHaveBeenLastCalledWith(false);
  await editor.unmount();
});
