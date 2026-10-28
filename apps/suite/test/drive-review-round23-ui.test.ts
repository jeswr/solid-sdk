// AUTHORED-BY Codex

import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { REPORT_PDF } from "../src/lib/demo-pod/binaries";
import { createDemoPod } from "../src/lib/demo-pod/pod";
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
import { PreviewPage } from "../src/apps/drive/components/preview";
import { FolderView } from "../src/apps/drive/components/views";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { renameItem } from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;
const FILE = `${ROOT}report.txt`;
const PDF = `${ROOT}report.pdf`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}
function tree(body: ReactNode = h(FolderView)) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup() {
  const pod = createDemoPod({
    root: STORAGE,
    seed: [{ path: "drive/report.txt", body: "old", contentType: "text/plain" }],
  });
  session = {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  return mount(tree());
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function fact(label: string) {
  return [...(document.querySelector(".drv-details")?.querySelectorAll("dt") ?? [])].find(
    (element) => element.textContent === label,
  )?.nextElementSibling?.textContent;
}
async function openRow(url: string) {
  const row = document.querySelector(`[data-url="${url}"]`);
  if (!row) throw new Error(`Missing row: ${url}`);
  await act(async () => {
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "dialog",
  "page",
  "pane",
] as const)("revalidates %s metadata when opened after Replace completes but before the listing refresh", async (kind) => {
  const view = await setup();
  await act(async () => {
    await renameItem(drive.client, await drive.client.stat(FILE), "report.pdf");
  });
  const cached = (await drive.client.list(ROOT)).find((item) => item.url === PDF);
  if (!cached) throw new Error("Missing renamed file");
  expect(cached).toMatchObject({ contentType: "text/plain", size: 3 });
  const listing = deferred<void>();
  const list = drive.client.list.bind(drive.client);
  vi.spyOn(drive.client, "list").mockImplementation(async (...args) => {
    await listing.promise;
    return list(...args);
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await act(async () => {
    drive.uploads.enqueue(ROOT, [
      new File([new Uint8Array(REPORT_PDF)], "report.pdf", { type: "application/pdf" }),
    ]);
  });
  expect(drive.uploads.tasks[0]?.status).toBe("conflict");
  await click(button("Replace"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("done");
  });
  expect(view.host.querySelector('[aria-label="Refreshing"]')).not.toBeNull();
  const stat = vi.spyOn(drive.client, "stat");
  if (kind === "dialog") await openRow(PDF);
  else
    await view.render(
      tree(
        kind === "page"
          ? h(PreviewPage, { item: cached, parent: ROOT })
          : h(DetailsPane, { items: [cached], onClose: vi.fn() }),
      ),
    );
  if (kind !== "pane") await click(button("Details"));
  // All notifications happened before this view mounted: its resource version is zero.
  expect(fact("Type")).toBe("PDF document");
  expect(fact("Size")).toBe(`${REPORT_PDF.byteLength} B`);
  expect(stat).toHaveBeenCalledWith(PDF);
  if (kind !== "pane") {
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("blob:report");
    expect(document.querySelector(".drv-preview-text")).toBeNull();
  }
  await act(async () => listing.resolve());
  expect(fact("Type")).toBe("PDF document");
  expect(fact("Size")).toBe(`${REPORT_PDF.byteLength} B`);
});

it.each([
  { field: "ETag", change: { etag: '"new"' }, body: "new" },
  { field: "size", change: { size: 19 }, body: "replacement content" },
  { field: "content type", change: { contentType: "text/x-report" }, body: "new" },
])("adopts refreshed listing $field after preview mounts and ignores older HEAD responses", async ({
  change,
  body,
}) => {
  const view = await setup();
  const cached = (await drive.client.list(ROOT))[0];
  if (!cached) throw new Error("Missing file");
  const latest: DriveItem = { ...cached, ...change };
  const listing = deferred<DriveItem[]>();
  const list = drive.client.list.bind(drive.client);
  vi.spyOn(drive.client, "list").mockImplementation((url, options) =>
    url === ROOT ? listing.promise : list(url, options),
  );
  const staleHead = deferred<DriveItem>();
  let refreshed = false;
  const stat = drive.client.stat.bind(drive.client);
  vi.spyOn(drive.client, "stat").mockImplementation((url, options) =>
    url !== FILE
      ? stat(url, options)
      : refreshed
        ? Promise.reject(new Error("Metadata temporarily unavailable"))
        : staleHead.promise,
  );
  const read = vi.spyOn(drive.client, "read").mockResolvedValue(new Blob(["old"]));
  // Start the delayed refresh before mounting: no new notification will help the preview.
  await act(async () => drive.invalidate(FILE));
  await openRow(FILE);
  await click(button("Details"));
  await click(button("Show technical details"));
  // Opening waits for metadata before its first GET. The refreshed listing must
  // supersede this pending HEAD without loading or displaying the stale bytes.
  expect(document.querySelector('[aria-label="Loading preview"]')).not.toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(fact("Size")).toBe("3 B");
  await act(async () => {
    refreshed = true;
    read.mockResolvedValue(new Blob([body]));
    listing.resolve([latest]);
  });
  expect(view.host.querySelector('[aria-label="Refreshing"]')).toBeNull();
  expect(document.querySelector(".drv-preview-text")?.textContent).toBe(body);
  expect(fact("Size")).toBe(`${latest.size} B`);
  expect(fact("Content type")).toBe(latest.contentType);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => staleHead.resolve(cached));
  expect(document.querySelector(".drv-preview-text")?.textContent).toBe(body);
  expect(fact("Size")).toBe(`${latest.size} B`);
  expect(fact("Content type")).toBe(latest.contentType);
});

it("ignores a content read superseded by newer metadata for the same preview URL", async () => {
  const view = await setup();
  const cached = await drive.client.stat(FILE);
  vi.spyOn(drive.client, "stat").mockRejectedValue(new Error("Metadata unavailable"));
  const staleRead = deferred<Blob>();
  vi.spyOn(drive.client, "read")
    .mockReturnValueOnce(staleRead.promise)
    .mockResolvedValue(new Blob(["replacement content"]));
  await view.render(tree(h(PreviewPage, { item: cached, parent: ROOT })));
  await view.render(tree(h(PreviewPage, { item: { ...cached, size: 19 }, parent: ROOT })));
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("replacement content");
  await act(async () => staleRead.resolve(new Blob(["old"])));
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("replacement content");
});
