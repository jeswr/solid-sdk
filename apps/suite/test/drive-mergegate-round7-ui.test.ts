// AUTHORED-BY Codex
import { beforeEach, expect, it, vi } from "vitest";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { OWNER, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const route = vi.hoisted(() => ({ ref: "", params: new URLSearchParams() }));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useParams: () => ({ ref: route.ref }),
  usePathname: () => "/drive/my",
  useSearchParams: () => route.params,
  useRouter: () => ({
    push: vi.fn(),
    replace: (url: string) => {
      route.params = new URL(url, "https://suite.example").searchParams;
    },
  }),
}));

import { PreviewDialog } from "../src/apps/drive/components/preview";
import {
  PreviewRouteView,
  RecentView,
  SharedView,
  StarredView,
} from "../src/apps/drive/components/views";
import { formatModified } from "../src/apps/drive/lib/view/view";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { useLiveItem, withHydratedMetadata } from "../src/apps/drive/state/resource";
import { DriveUiProvider, useDriveUi } from "../src/apps/drive/state/ui";

beforeEach(() => {
  localStorage.clear();
  route.params = new URLSearchParams();
});

async function setup(hiddenLink: boolean, own = false) {
  const pod = await wacPod();
  if (hiddenLink)
    pod.after(async (_url, _method, response) => {
      const headers = new Headers(response.headers);
      headers.delete("link");
      return new Response(response.body, { status: response.status, headers });
    });
  const session: PodSession = {
    mode: "demo",
    storageUrl: own ? ROOT : `${ROOT}alice/`,
    webId: own ? OWNER : `${ROOT}alice/profile#me`,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  let drive!: ReturnType<typeof useDrive>;
  let ui!: ReturnType<typeof useDriveUi>;
  function Probe() {
    drive = useDrive();
    ui = useDriveUi();
    return h(PreviewDialog);
  }
  return {
    pod,
    prefsKey: `suite.drive.prefs.${session.webId}`,
    drive: () => drive,
    ui: () => ui,
    tree: (body: ReturnType<typeof h>) =>
      h(DriveProvider, {
        session,
        children: h(DriveUiProvider, null, body, h(Probe)),
      }),
  };
}

function urls(host: Element) {
  return [...host.querySelectorAll<HTMLElement>("[data-url]")].map((row) => row.dataset.url);
}
function row(host: Element, url: string) {
  const found = host.querySelector<HTMLElement>(`[data-url="${url}"]`);
  if (!found) throw new Error(`Missing row: ${url}`);
  return found;
}
async function selectDocuments(view: Awaited<ReturnType<typeof mount>>) {
  await key(view.host.querySelector(".drv-chips button") as Element, "ArrowDown");
  const option = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(
    (item) => item.textContent === "Documents",
  );
  expect(option).toBeDefined();
  await click(option as Element);
  await key(document.querySelector('[role="menu"]') as Element, "Escape");
}

it.each([
  false,
  true,
])("Shared retains opened metadata and Documents filtering after reload (hidden Link: %s)", async (hiddenLink) => {
  const env = await setup(hiddenLink);
  const url = `${PUBLIC}placeholder`; // No extension: only the persisted MIME can classify it.
  expect((await env.pod.anonymous(url)).status).toBe(200);
  expect((await env.pod.fetch(url, { method: "HEAD" })).headers.has("link")).toBe(!hiddenLink);
  route.ref = encodeRef(url);
  const opened = await mount(env.tree(h(PreviewRouteView)));
  expect(opened.host.querySelector(".drv-preview-text")?.textContent).toBe("public");
  const csv = `${PUBLIC}ztable.txt`;
  await env.pod.pod.fetch(csv, {
    method: "PUT",
    headers: { "content-type": "text/csv" },
    body: "Name,Value\nNew,42",
  });
  route.ref = encodeRef(csv);
  await opened.render(env.tree(h(PreviewRouteView)));
  expect(opened.host.querySelector(".drv-csv")?.textContent).toContain("New");
  const previousClient = env.drive().client;
  await opened.unmount();

  const view = await mount(env.tree(h(SharedView)));
  expect(env.drive().client).not.toBe(previousClient);
  // Shared retains its newest-opened order even with names and persisted sort in another order.
  expect(urls(view.host)).toEqual([csv, url]);
  await act(async () =>
    env.drive().updatePrefs((current) => ({ ...current, sort: { key: "size", dir: "asc" } })),
  );
  expect(urls(view.host)).toEqual([csv, url]);
  await selectDocuments(view);
  await view.render(env.tree(h(SharedView)));
  expect(urls(view.host)).toEqual([url]);
  expect(row(view.host, url).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
    "text",
  );
  const stored = JSON.parse(localStorage.getItem(env.prefsKey) as string).openedShared;
  expect(stored).toHaveLength(2);
  const document = stored.find((entry: { url: string }) => entry.url === url);
  expect(document).toEqual({
    url,
    name: "placeholder",
    type: "file",
    contentType: "text/plain",
    size: 6,
    modified: expect.any(String),
    openedAt: expect.any(String),
  });
  expect(new Date(document.modified).toISOString()).toBe(document.modified);
  await click(view.host.querySelector('[aria-label="Grid view"]') as Element);
  expect(row(view.host, url).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
    "text",
  );
  expect(row(view.host, url).textContent).toContain(formatModified(new Date(document.modified)));
  route.params = new URLSearchParams({ type: "documents,data" });
  await view.render(env.tree(h(SharedView)));
  expect(urls(view.host)).toEqual([csv, url]);
  expect(row(view.host, csv).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
    "csv",
  );
});

it("Shared updates persisted metadata on a later open and keeps fresher in-memory metadata by URL", async () => {
  const env = await setup(true);
  const url = `${PUBLIC}placeholder`;
  let modified = "2026-01-01T00:00:00Z";
  env.pod.after(async (_url, _method, response) => {
    const headers = new Headers(response.headers);
    headers.delete("link");
    headers.set("last-modified", new Date(modified).toUTCString());
    return new Response(response.body, { status: response.status, headers });
  });
  route.ref = encodeRef(url);
  const view = await mount(env.tree(h(PreviewRouteView)));
  await view.render(env.tree(h(SharedView)));
  modified = "2026-02-01T00:00:00Z";
  await env.pod.pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/markdown" },
    body: "a longer replacement",
  });
  await view.render(env.tree(h(PreviewRouteView)));
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("a longer replacement");
  expect(env.drive().prefs.openedShared).toEqual([
    expect.objectContaining({
      url,
      contentType: "text/markdown",
      size: 20,
      type: "file",
      modified: "2026-02-01T00:00:00.000Z",
    }),
  ]);

  await view.render(env.tree(h(SharedView)));
  await click(row(view.host, url));
  await key(row(view.host, url), "Enter");
  const recorded = localStorage.getItem(env.prefsKey);
  modified = "2026-03-01T00:00:00Z";
  await act(async () => {
    await env.pod.pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/csv" },
      body: "Name,Value\nNew,42",
    });
    env.drive().invalidate(url);
  });
  expect(document.querySelector(".drv-csv")?.textContent).toContain("New");
  // A refresh within the same activation must keep round six's single-record behavior.
  expect(localStorage.getItem(env.prefsKey)).toBe(recorded);
  await act(async () => env.ui().setPreview(undefined));
  await act(async () => env.drive().updatePrefs((current) => ({ ...current })));
  expect(row(view.host, url).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
    "csv",
  );
  const snapshot = withHydratedMetadata(env.drive().client, {
    url,
    name: "placeholder",
    kind: "file" as const,
    contentType: "text/markdown",
    size: 20,
    modified: new Date(0),
  });
  expect(snapshot).toMatchObject({ contentType: "text/csv", size: 17 });
  expect(snapshot.modified?.getTime()).toBeGreaterThan(0);
  await view.unmount();

  const reloaded = await mount(env.tree(h(PreviewRouteView)));
  expect(env.drive().prefs.openedShared).toEqual([
    expect.objectContaining({ url, contentType: "text/csv", size: 17, type: "file" }),
  ]);
  await reloaded.unmount();
  const shared = await mount(env.tree(h(SharedView)));
  route.params = new URLSearchParams({ type: "data" });
  await shared.render(env.tree(h(SharedView)));
  expect(urls(shared.host)).toEqual([url]);
});

it("Shared classifies legacy records from URL extensions while declared MIME and folder kind win", async () => {
  const env = await setup(true);
  const entries = [
    { url: `${PUBLIC}report.txt`, name: "A report" },
    { url: `${PUBLIC}picture.png` },
    { url: `${PUBLIC}report.pdf` },
    { url: `${PUBLIC}sound.mp3` },
    { url: `${PUBLIC}movie.mp4` },
    { url: `${PUBLIC}table.csv` },
    { url: `${PUBLIC}unknown` },
    { url: `${PUBLIC}folder.txt`, type: "folder" },
    { url: `${PUBLIC}opaque.txt`, contentType: "application/octet-stream" },
    { url: `${PUBLIC}odd%2Fname.txt` },
  ].map((entry) => ({ ...entry, openedAt: "2026-01-01T00:00:00Z" }));
  // Aggregate reads now reconcile missing URLs. Keep these MIME fixtures present.
  env.pod.intercept(async (url, init) =>
    init?.method === "HEAD" && entries.some((entry) => entry.url === url)
      ? new Response(null, { status: 200 })
      : undefined,
  );
  localStorage.setItem(env.prefsKey, JSON.stringify({ openedShared: entries }));
  const view = await mount(env.tree(h(SharedView)));
  for (const [family, indexes] of [
    ["documents", [0, 9]],
    ["images", [1]],
    ["pdfs", [2]],
    ["audio", [3]],
    ["video", [4]],
    ["data", [5]],
    ["other", [6, 8]],
    ["folders", [7]],
  ] as const) {
    route.params = new URLSearchParams({ type: family });
    await view.render(env.tree(h(SharedView)));
    expect(urls(view.host)).toEqual(indexes.map((index) => entries[index]?.url));
  }
});

it.each([
  ["Recent", false],
  ["Recent", true],
  ["Starred", false],
  ["Starred", true],
] as const)("%s preserves type filters, sorting and list/grid icons after reload (hidden Link: %s)", async (surface, hiddenLink) => {
  const env = await setup(hiddenLink, surface === "Recent");
  const url = `${PUBLIC}placeholder`;
  const csv = `${PUBLIC}table.txt`; // Declared CSV must win over the .txt extension.
  await env.pod.pod.fetch(csv, {
    method: "PUT",
    headers: { "content-type": "text/csv" },
    body: "Name,Value\nNew,42",
  });
  localStorage.setItem(
    env.prefsKey,
    JSON.stringify({ starred: [url, csv, PUBLIC], sort: { key: "size", dir: "desc" } }),
  );
  route.ref = encodeRef(url);
  const opened = await mount(env.tree(h(PreviewRouteView)));
  const previousClient = env.drive().client;
  await opened.unmount();
  const View = surface === "Recent" ? RecentView : StarredView;
  const view = await mount(env.tree(h(View)));
  expect(env.drive().client).not.toBe(previousClient);
  await selectDocuments(view);
  await view.render(env.tree(h(View)));
  expect(urls(view.host)).toContain(url);
  expect(urls(view.host)).not.toContain(csv);
  route.params = new URLSearchParams({ type: "documents,data" });
  await view.render(env.tree(h(View)));
  if (surface === "Starred") expect(urls(view.host)).toEqual([csv, url]);
  else {
    const expected = (await env.drive().client.list(PUBLIC)).sort(
      (a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0),
    );
    expect(urls(view.host).filter((value) => value === csv || value === url)).toEqual(
      expected.map((item) => item.url),
    );
  }
  for (const mode of ["list", "grid"] as const) {
    if (mode === "grid")
      await click(view.host.querySelector('[aria-label="Grid view"]') as Element);
    expect(row(view.host, url).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
      "text",
    );
    expect(row(view.host, csv).querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe(
      "csv",
    );
    if (mode === "list") {
      expect(row(view.host, url).querySelector(".drv-col-size")?.textContent).toBe("6 B");
      expect(row(view.host, csv).querySelector(".drv-col-size")?.textContent).toBe("17 B");
    }
  }
});

it("does not overlay a hydrated URL onto a newer versioned listing or another URL", async () => {
  const env = await setup(true);
  const url = `${PUBLIC}placeholder`;
  function Hydrate() {
    useLiveItem({ url, name: "placeholder", kind: "file" });
    return null;
  }
  await mount(env.tree(h(Hydrate)));
  const newer = {
    url,
    name: "placeholder",
    kind: "file" as const,
    contentType: "text/csv",
    etag: '"newer-listing"',
  };
  expect(withHydratedMetadata(env.drive().client, newer)).toBe(newer);
  const unversioned = { url: `${PUBLIC}other`, name: "other", kind: "file" as const };
  expect(withHydratedMetadata(env.drive().client, unversioned)).toBe(unversioned);
});
