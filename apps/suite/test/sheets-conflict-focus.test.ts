// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  MountEngine,
  SheetEngine,
  Snapshot,
  WorkbookService,
} from "../src/apps/sheets/lib/contract";
import { pendingSaves } from "../src/apps/sheets/lib/pending-saves";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

const mocks = vi.hoisted(() => ({
  service: null as WorkbookService | null,
  mount: vi.fn<MountEngine>(),
  push: vi.fn(),
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
    dispose: vi.fn(),
    exportCsv: vi.fn(() => ""),
    activeSheet: vi.fn(() => ({ id: "data", name: "Data" })),
    importCsv: vi.fn(),
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
  expect(document.activeElement?.textContent).toBe("Load their version");
  await click(button(document, "Load their version"));
  expect(engine.load).toHaveBeenCalledWith(remote);
  expect(engine.snapshot()).toEqual(remote);
  expect(entry.workbook.snapshot).toEqual(remote);
  expect(entry.status).toBe("saved");
  await vi.waitFor(() => expect(document.activeElement).toBe(button(editor.host, "File")));
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
