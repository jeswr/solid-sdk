// AUTHORED-BY Codex

import { LiteralFrom, RequiredAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
  useParams: () => ({ ref: encodeRef(FILE) }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DetailsPane } from "../src/apps/drive/components/details";
import { DriveApp } from "../src/apps/drive/components/drive-app";
import { PreviewBody } from "../src/apps/drive/components/preview";
import { FolderView, PreviewRouteView, TrashView } from "../src/apps/drive/components/views";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveUi } from "../src/apps/drive/state/ui";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;
const FILE = `${ROOT}report.txt`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let ui: ReturnType<typeof useDriveUi>;
function Probe() {
  drive = useDrive();
  ui = useDriveUi();
  return null;
}
function tree(body: ReactNode = h(FolderView)) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup(body = "old", contentType = "text/plain") {
  const pod = createDemoPod({
    root: STORAGE,
    seed: [{ path: "drive/report.txt", body, contentType }],
  });
  const fetch = vi.fn(pod.fetch);
  session = {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  const view = await mount(tree());
  return { view, pod, fetch };
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function fact(pane: Element, label: string) {
  return [...pane.querySelectorAll("dt")].find((element) => element.textContent === label)
    ?.nextElementSibling?.textContent;
}
async function rdfTitle(title: string) {
  const dataset = new Store();
  const subject = new TermWrapper(DataFactory.namedNode(FILE), dataset, DataFactory);
  RequiredAs.object(subject, "http://purl.org/dc/terms/title", title, LiteralFrom.string);
  const writer = new Writer();
  writer.addQuads([...dataset]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, text) => (error ? reject(error) : resolve(text)));
  });
}
async function settleUsage(host: Element) {
  await act(async () => {
    await vi.waitFor(() => expect(host.querySelector(".drv-usage")?.textContent).toMatch(/used$/));
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "dialog",
  "page",
] as const)("reloads the %s preview opened during a delayed replacement upload", async (kind) => {
  const { view, pod, fetch } = await setup();
  const item = await drive.client.stat(FILE);
  const pendingPut = deferred<void>();
  fetch.mockImplementation(async (input, init) => {
    if (input === FILE && init?.method === "PUT") await pendingPut.promise;
    return pod.fetch(input, init);
  });
  await act(async () => {
    drive.uploads.enqueue(ROOT, [
      new File(["replacement content"], "report.txt", { type: "text/plain" }),
    ]);
  });
  expect(drive.uploads.tasks[0]?.status).toBe("uploading");
  if (kind === "dialog") await act(async () => ui.setPreview({ items: [item], index: 0 }));
  else await view.render(tree(h(PreviewRouteView)));
  const preview = () => document.querySelector(".drv-preview-text");
  expect(preview()?.textContent).toBe("old");
  await click(button("Details"));
  await act(async () => pendingPut.resolve());
  expect(drive.uploads.tasks[0]?.status).toBe("conflict");
  await click(button("Replace"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("done");
  });
  expect(await (await drive.client.read(FILE)).text()).toBe("replacement content");
  expect(preview()?.textContent).toBe("replacement content");
  expect(fact(document.querySelector(".drv-details") as Element, "Size")).toBe("19 B");
});

it.each([
  "dialog",
  "page",
  "pane",
] as const)("refreshes cached %s Details after a replacement changes size and content type", async (kind) => {
  const { view } = await setup();
  const item = await drive.client.stat(FILE);
  if (kind === "dialog") await act(async () => ui.setPreview({ items: [item], index: 0 }));
  else await view.render(tree(kind === "page" ? h(PreviewRouteView) : h("p", null, "Details")));
  if (kind === "pane") {
    await act(async () => {
      ui.setDetailsItems([item]);
      ui.setDetailsOpen(true);
    });
  } else await click(button("Details"));
  const pane = () => document.querySelector(".drv-details") as Element;
  expect(fact(pane(), "Size")).toBe("3 B");
  await act(async () => {
    await drive.client.write(FILE, "longer replacement", { contentType: "text/markdown" });
  });
  expect(fact(pane(), "Size")).toBe("18 B");
  expect(fact(pane(), "Type")).toBe("Markdown document");
});

it.each([
  "Delete for ever",
  "Empty trash",
])("refreshes usage after permanently removing 2 MB through %s", async (action) => {
  const { view } = await setup("x".repeat(2_000_000));
  await settleUsage(view.host);
  vi.useFakeTimers();
  expect(view.host.querySelector(".drv-usage")?.textContent).toBe("2 MB used");
  const item = await drive.client.stat(FILE);
  await act(async () => {
    await operations.trashItems(drive.client, ROOT, [item]);
  });
  await view.render(tree(h(TrashView)));
  await act(async () => {
    await vi.waitFor(() => expect(view.host.querySelector("[data-url]")).not.toBeNull());
  });
  // Finish the root-change measurement before the only remaining events occur
  // beneath .trash/. This also makes the pre-fix stale counter deterministic.
  await settleUsage(view.host);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await click(button(action === "Empty trash" ? action : "Delete for ever: report.txt"));
  const dialog = document.querySelector('[role="alertdialog"]') as Element;
  expect(dialog).not.toBeNull();
  await click(button(action, dialog));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(view.host.textContent).toContain("Trash is empty");
  expect(await operations.measureUsage(drive.client, ROOT)).toBeLessThan(1024);
  expect(view.host.querySelector(".drv-usage")?.textContent).not.toBe("2 MB used");
});

it("revokes the previous preview blob and ignores reads superseded by resource changes", async () => {
  const { view } = await setup("image", "image/png");
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:old")
    .mockReturnValue("blob:new");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const item = await drive.client.stat(FILE);
  await view.render(tree(h(PreviewBody, { item })));
  expect(view.host.querySelector("img")?.getAttribute("src")).toBe("blob:old");
  const stale = deferred<Blob>();
  const latest = deferred<Blob>();
  vi.spyOn(drive.client, "read")
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(latest.promise);
  await act(async () => drive.invalidate(FILE));
  expect(revoke).toHaveBeenCalledWith("blob:old");
  expect(view.host.querySelector('[aria-label="Loading preview"]')).not.toBeNull();
  await act(async () => drive.invalidate(FILE));
  await act(async () => latest.resolve(new Blob(["latest"], { type: "image/png" })));
  expect(view.host.querySelector("img")?.getAttribute("src")).toBe("blob:new");
  await act(async () => stale.resolve(new Blob(["stale"], { type: "image/png" })));
  expect(view.host.querySelector("img")?.getAttribute("src")).toBe("blob:new");
  // Every created URL is released once, including any abandoned response.
  await view.unmount();
  expect(revoke.mock.calls).toHaveLength(create.mock.calls.length);
});

it("reloads RDF previews when their parent listing is invalidated", async () => {
  const { view } = await setup(await rdfTitle("Old title"), "text/turtle");
  const item = await drive.client.stat(FILE);
  await view.render(tree(h(PreviewBody, { item })));
  expect(view.host.querySelector(".drv-rdf")?.textContent).toContain("Old title");
  await act(async () => {
    await drive.client.write(FILE, await rdfTitle("New title"), { contentType: "text/turtle" });
  });
  expect(view.host.querySelector(".drv-rdf")?.textContent).toContain("New title");
});

it("refreshes the direct preview renderer when replacement changes its content type", async () => {
  const { view } = await setup();
  await view.render(tree(h(PreviewRouteView)));
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("old");
  await act(async () => {
    await drive.client.write(FILE, "Title,Value\nCurrent,42", { contentType: "text/csv" });
  });
  expect(view.host.querySelector(".drv-csv")?.textContent).toContain("Current42");
  expect(view.host.querySelector(".drv-preview-text")).toBeNull();
});

it("ignores superseded metadata responses in cached Details", async () => {
  const { view } = await setup();
  const item = await drive.client.stat(FILE);
  await view.render(tree(h(DetailsPane, { items: [item], onClose: vi.fn() })));
  const stale = deferred<DriveItem>();
  const latest = deferred<DriveItem>();
  vi.spyOn(drive.client, "stat")
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(latest.promise);
  await act(async () => drive.invalidate(FILE));
  await act(async () => drive.invalidate(FILE));
  await act(async () => latest.resolve({ ...item, size: 42 }));
  expect(fact(view.host.querySelector(".drv-details") as Element, "Size")).toBe("42 B");
  await act(async () => stale.resolve({ ...item, size: 12 }));
  expect(fact(view.host.querySelector(".drv-details") as Element, "Size")).toBe("42 B");
});

it("debounces subtree usage changes and ignores superseded measurements", async () => {
  const { view } = await setup();
  await settleUsage(view.host);
  vi.useFakeTimers();
  const stale = deferred<number>();
  const measure = vi
    .spyOn(operations, "measureUsage")
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue(42);
  await act(async () => {
    drive.invalidate(`${ROOT}nested/one.txt`);
    drive.invalidate(`${ROOT}.trash/slot/two.txt`);
    drive.invalidate(`${ROOT}nested/three.txt`);
    drive.invalidate(`${STORAGE}unrelated/file.txt`);
    await vi.advanceTimersByTimeAsync(199);
  });
  expect(measure).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(measure).toHaveBeenCalledOnce();
  await act(async () => drive.invalidate(`${ROOT}.trash/slot/two.txt`));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(measure).toHaveBeenCalledTimes(2);
  expect(view.host.querySelector(".drv-usage")?.textContent).toBe("42 B used");
  await act(async () => stale.resolve(2_000_000));
  expect(view.host.querySelector(".drv-usage")?.textContent).toBe("42 B used");
  await act(async () => drive.invalidate(`${ROOT}nested/four.txt`));
  await view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(measure).toHaveBeenCalledTimes(2);
});

it("keeps usage debounced while the upload queue publishes progress", async () => {
  const { view, fetch, pod } = await setup();
  await settleUsage(view.host);
  vi.useFakeTimers();
  const pending = deferred<void>();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "PUT") await pending.promise;
    return pod.fetch(input, init);
  });
  const measure = vi.spyOn(operations, "measureUsage");
  await act(async () => {
    drive.uploads.enqueue(ROOT, [new File(["new"], "new.txt", { type: "text/plain" })]);
  });
  expect(drive.uploads.tasks[0]?.status).toBe("uploading");
  expect(measure).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(drive.uploads.tasks[0]?.status).toBe("done");
  expect(measure).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(measure).toHaveBeenCalledOnce();
  expect(view.host.querySelector(".drv-usage")?.textContent).toBe("6 B used");
});
