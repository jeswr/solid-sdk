// AUTHORED-BY Codex

import { afterEach, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  client: { list: vi.fn(), createFolder: vi.fn(), stat: vi.fn() },
  query: "report",
  ref: "",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("../src/apps/drive/lib/client/client", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/client/client")>()),
  createSolidDriveClient: () => mocks.client,
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({ ensureTypeRegistrations: vi.fn() }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ q: mocks.query }),
  useParams: () => ({ ref: mocks.ref }),
  notFound: mocks.notFound,
}));
vi.mock("../src/apps/drive/state/ui", () => ({
  useDriveUi: () => ({}),
  useDriveActions: () => ({}),
}));
vi.mock("../src/apps/drive/components/file-browser", () => ({
  FileBrowser: ({ title, items }: { title: string; items?: DriveItem[] }) =>
    h(
      "section",
      null,
      h("h1", null, title),
      items ? items.map((item) => h("button", { key: item.url }, item.name)) : "Loading",
    ),
}));
vi.mock("../src/apps/drive/components/preview", () => ({
  PreviewPage: ({ item }: { item: DriveItem }) => h("p", null, `Preview ${item.name}`),
}));

import { PreviewRouteView, RecentView, SearchView } from "../src/apps/drive/components/views";
import { DriveError } from "../src/apps/drive/lib/client/client";
import {
  DriveProvider,
  type FolderState,
  useDrive,
  useFolder,
} from "../src/apps/drive/state/drive-context";

const ROOT = "https://pod.example/drive/";
const WORK = `${ROOT}Work/`;
const ARCHIVE = `${ROOT}Archive/`;
const report: DriveItem = {
  url: `${WORK}Report.pdf`,
  name: "Report.pdf",
  kind: "file",
  modified: new Date(),
};
const photo: DriveItem = { ...report, url: `${ROOT}photo.jpg`, name: "photo.jpg" };
const session: PodSession = {
  mode: "demo",
  webId: "https://pod.example/profile#me",
  storageUrl: "https://pod.example/",
  displayName: "Me",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: vi.fn(),
};
function wrap(child: ReturnType<typeof h>) {
  return h(DriveProvider, { session, children: child });
}
afterEach(() => {
  vi.clearAllMocks();
  mocks.client.list.mockReset();
  mocks.client.stat.mockReset();
  localStorage.clear();
});

it("clears actionable rows immediately on folder navigation and ignores abandoned successes", async () => {
  const work = deferred<DriveItem[]>();
  const archive = deferred<DriveItem[]>();
  mocks.client.list.mockImplementation((url: string) =>
    url === ROOT ? Promise.resolve([photo]) : url === WORK ? work.promise : archive.promise,
  );
  let state: FolderState | undefined;
  const renders: FolderState[] = [];
  function Probe({ url }: { url?: string }) {
    state = useFolder(url);
    renders.push(state);
    return null;
  }
  const view = await mount(wrap(h(Probe, { url: ROOT })));
  expect(state).toMatchObject({ status: "ready", items: [photo] });
  renders.length = 0;
  await view.render(wrap(h(Probe, { url: WORK })));
  expect(renders.every((entry) => entry.status === "loading")).toBe(true);
  const signal = mocks.client.list.mock.calls.find(([url]) => url === WORK)?.[1]
    .signal as AbortSignal;
  await view.render(wrap(h(Probe, { url: ARCHIVE })));
  expect(signal.aborted).toBe(true);
  await act(async () => archive.resolve([]));
  await act(async () => work.resolve([report]));
  expect(state).toMatchObject({ status: "ready", items: [] });
  await view.render(wrap(h(Probe, {})));
  expect(state?.status).toBe("loading");
  await view.unmount();
});
it("keeps only the newest reload of the same folder", async () => {
  const old = deferred<DriveItem[]>();
  mocks.client.list.mockReturnValueOnce(old.promise).mockResolvedValue([]);
  let reload!: () => void;
  let state: FolderState | undefined;
  function Probe() {
    const folder = useFolder(ROOT);
    reload = folder.reload;
    state = folder;
    return null;
  }
  const view = await mount(wrap(h(Probe)));
  await act(async () => reload());
  await act(async () => old.resolve([report]));
  expect(state).toMatchObject({ status: "ready", items: [] });
  await view.unmount();
});
it("cancels old searches and ignores their results after the query changes", async () => {
  const old = deferred<DriveItem[]>();
  mocks.query = "report";
  mocks.client.list.mockReturnValueOnce(old.promise).mockResolvedValue([photo]);
  const view = await mount(wrap(h(SearchView)));
  const options = mocks.client.list.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
  mocks.query = "photo";
  await view.render(wrap(h(SearchView)));
  expect(options?.signal?.aborted).toBe(true);
  expect(view.host.textContent).toContain('Results for "photo"');
  expect(view.host.textContent).toContain("photo.jpg");
  await act(async () => old.resolve([report]));
  expect(view.host.textContent).not.toContain("Report.pdf");
  await view.unmount();
});
it("Recent refreshes nested renames and trash changes through the subtree bus", async () => {
  let files = [report];
  mocks.client.list.mockImplementation((url: string) =>
    Promise.resolve(url === ROOT ? [{ url: WORK, name: "Work", kind: "folder" }] : files),
  );
  let invalidate!: (url: string) => void;
  function Probe() {
    invalidate = useDrive().invalidate;
    return h(RecentView);
  }
  const view = await mount(wrap(h(Probe)));
  expect(view.host.textContent).toContain("Report.pdf");
  files = [{ ...report, url: `${WORK}Renamed.pdf`, name: "Renamed.pdf" }];
  await act(async () => invalidate(report.url));
  expect(view.host.textContent).toContain("Renamed.pdf");
  expect(view.host.textContent).not.toContain("Report.pdf");
  files = [];
  await act(async () => invalidate(`${WORK}Renamed.pdf`));
  expect(view.host.querySelectorAll("button")).toHaveLength(0);
  const count = mocks.client.list.mock.calls.length;
  await act(async () => invalidate("https://pod.example/drive-other/file"));
  expect(mocks.client.list.mock.calls).toHaveLength(count);
  await view.unmount();
  await act(async () => invalidate(report.url));
  expect(mocks.client.list.mock.calls).toHaveLength(count);
});
it.each([
  401, 403, 500, 503, 0,
])("preserves access or retry errors for a preview HEAD failure (%s)", async (status) => {
  mocks.ref = encodeRef(report.url);
  mocks.client.stat.mockRejectedValue(
    status
      ? new DriveError(
          status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : "failed",
          status,
          report.url,
        )
      : new TypeError("Network failed"),
  );
  const view = await mount(wrap(h(PreviewRouteView)));
  expect(mocks.notFound).not.toHaveBeenCalled();
  expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
  expect(view.host.textContent).toContain(
    status === 401 ? "Sign in" : status === 403 ? "Request access" : "Retry",
  );
  mocks.client.stat.mockResolvedValue(report);
  const retry = [...view.host.querySelectorAll("button")].find((e) => e.textContent === "Retry");
  expect(retry).toBeDefined();
  await click(retry as Element);
  expect(view.host.textContent).toContain("Preview Report.pdf");
  await view.unmount();
});
it.each([
  404, 410,
])("uses notFound only for genuinely missing preview resources (%s)", async (status) => {
  mocks.ref = encodeRef(report.url);
  mocks.client.stat.mockRejectedValue(new DriveError("not-found", status, report.url));
  await expect(mount(wrap(h(PreviewRouteView)))).rejects.toThrow("NOT_FOUND");
  expect(mocks.notFound).toHaveBeenCalled();
});
