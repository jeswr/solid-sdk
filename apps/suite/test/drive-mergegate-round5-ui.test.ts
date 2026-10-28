// AUTHORED-BY Codex
import { beforeEach, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  ref: "",
  client: {
    list: vi.fn(),
    stat: vi.fn(),
    read: vi.fn(),
    createFolder: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../src/apps/drive/lib/client/client", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/client/client")>()),
  createSolidDriveClient: () => mocks.client,
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({ ensureTypeRegistrations: vi.fn() }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => {
  const search = new URLSearchParams();
  return {
    useParams: () => ({ ref: mocks.ref }),
    usePathname: () => "/drive/my",
    useSearchParams: () => search,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    notFound: () => {
      throw new Error("NOT_FOUND");
    },
  };
});

import { DetailsPane } from "../src/apps/drive/components/details";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { PreviewDialog } from "../src/apps/drive/components/preview";
import {
  FolderView,
  PreviewRouteView,
  RecentView,
  SharedView,
  StarredView,
} from "../src/apps/drive/components/views";
import { DriveProvider } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";

const ROOT = "https://pod.example/alice/";
const BOB = "https://pod.example/bob/";
const WEBID = `${BOB}profile/card#me`;
const foreign: DriveItem = {
  url: `${BOB}public/report.txt`,
  name: "Bob's report",
  kind: "file",
  contentType: "text/plain",
};
const folder: DriveItem = { url: `${BOB}public/`, name: "public", kind: "folder" };
const own: DriveItem = {
  ...foreign,
  url: `${ROOT}drive/own.txt`,
  name: "Own file",
  modified: new Date(),
};
const http = vi.fn<typeof fetch>();
const session: PodSession = {
  mode: "demo",
  webId: `${ROOT}profile/card#me`,
  storageUrl: ROOT,
  displayName: "Alice",
  fetch: http,
  subscribe: () => () => {},
  reset: vi.fn(),
};
const prefsKey = `suite.drive.prefs.${session.webId}`;
function wrap(child: ReturnType<typeof h>) {
  return h(DriveProvider, { session, children: h(DriveUiProvider, null, child) });
}
function browser(items: DriveItem[]) {
  return h(FileBrowser, {
    title: "Files",
    items,
    columns: ["owner"],
    empty: { title: "Empty", icon: null },
  });
}
function fact(host: Element, label: string) {
  return [...host.querySelectorAll("dt")].find((dt) => dt.textContent === label)?.nextElementSibling
    ?.textContent;
}
function stored() {
  return JSON.parse(localStorage.getItem(prefsKey) ?? '{"openedShared":[]}').openedShared;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.client.list.mockResolvedValue([]);
  mocks.client.stat.mockImplementation(async (url: string) =>
    url === foreign.url ? foreign : url === own.url ? own : { url, name: "public", kind: "folder" },
  );
  mocks.client.read.mockResolvedValue(
    new Blob(["Readable public content"], { type: "text/plain" }),
  );
  http.mockResolvedValue(new Response(null, { status: 404 }));
});
it("never attributes an undiscoverable foreign owner to Alice in Details or the listing", async () => {
  const view = await mount(
    wrap(
      h(
        "div",
        null,
        h(DetailsPane, { items: [foreign], onClose: vi.fn() }),
        browser([own, foreign]),
      ),
    ),
  );
  expect(fact(view.host, "Owner")).toBe("Unknown");
  expect([...view.host.querySelectorAll(".drv-col-owner")].map((cell) => cell.textContent)).toEqual(
    ["Owner", "Unknown", "Me"],
  );
  await click(
    [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show technical details",
    ) as Element,
  );
  expect(fact(view.host, "Owner Account ID")).toBe("Unknown");
});
it("discovers Bob through storageDescription and pim:storage for every owner label", async () => {
  const description = `${BOB}profile/card`;
  http.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "HEAD" && url === foreign.url)
      return new Response(null, {
        headers: {
          link: `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      });
    if (url === description || url === WEBID)
      return new Response(
        `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BOB}>; <http://xmlns.com/foaf/0.1/name> "Bob".`,
        { headers: { "content-type": "text/turtle" } },
      );
    return new Response(null, { status: 404 });
  });
  const view = await mount(
    wrap(
      h("div", null, h(DetailsPane, { items: [foreign], onClose: vi.fn() }), browser([foreign])),
    ),
  );
  expect(fact(view.host, "Owner")).toBe("Bob");
  expect(view.host.querySelector("td.drv-col-owner")?.textContent).toBe("Bob");
  await click(
    [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show technical details",
    ) as Element,
  );
  expect(fact(view.host, "Owner Account ID")).toBe(WEBID);
});
it("records successful foreign file and folder opens through preferences, deduplicates and lists newest first", async () => {
  const writes = vi.spyOn(Object.getPrototypeOf(localStorage), "setItem");
  mocks.ref = encodeRef(foreign.url);
  const view = await mount(wrap(h(PreviewRouteView)));
  expect(view.host.textContent).toContain("Readable public content");
  expect(stored()).toEqual([
    {
      url: foreign.url,
      name: foreign.name,
      type: "file",
      contentType: "text/plain",
      openedAt: expect.any(String),
    },
  ]);
  const first = stored()[0].openedAt;
  await view.render(wrap(h(FolderView, { url: folder.url })));
  expect(stored()).toHaveLength(2);
  expect(stored()[0]).toMatchObject({ url: folder.url, name: folder.name, type: "folder" });
  await view.render(wrap(h(PreviewRouteView)));
  expect(stored()).toHaveLength(2);
  expect(stored()[0].url).toBe(foreign.url);
  expect(Date.parse(stored()[0].openedAt)).toBeGreaterThanOrEqual(Date.parse(first));
  expect(writes).toHaveBeenCalled();
  await view.render(wrap(h(SharedView)));
  expect(
    [...view.host.querySelectorAll("[data-url]")].map((row) => row.getAttribute("data-url")),
  ).toEqual([foreign.url, folder.url]);
  expect(view.host.textContent).toContain(foreign.name);
  expect(view.host.textContent).toContain("Opened");
});
it("does not record failed files, failed folders, own-storage opens or abandoned reads", async () => {
  mocks.ref = encodeRef(foreign.url);
  mocks.client.read.mockRejectedValueOnce(new Error("Forbidden"));
  const view = await mount(wrap(h(PreviewRouteView)));
  expect(stored()).toEqual([]);
  mocks.client.list.mockRejectedValueOnce(new Error("Forbidden"));
  await view.render(wrap(h(FolderView, { url: folder.url })));
  expect(stored()).toEqual([]);
  mocks.ref = encodeRef(own.url);
  await view.render(wrap(h(PreviewRouteView)));
  await view.render(wrap(h(FolderView, { url: `${ROOT}drive/` })));
  expect(stored()).toEqual([]);
  const pending = deferred<Blob>();
  mocks.client.read.mockReturnValueOnce(pending.promise);
  mocks.ref = encodeRef(foreign.url);
  await view.render(wrap(h(PreviewRouteView)));
  await view.render(wrap(h(SharedView)));
  await act(async () => pending.resolve(new Blob(["Late"])));
  expect(stored()).toEqual([]);
});
it("disables foreign Rename, Move and Trash in Starred, including keyboard and direct actions", async () => {
  localStorage.setItem(prefsKey, JSON.stringify({ starred: [foreign.url] }));
  let actions!: ReturnType<typeof useDriveActions>;
  let ui!: ReturnType<typeof useDriveUi>;
  function Probe() {
    actions = useDriveActions();
    ui = useDriveUi();
    return h(StarredView);
  }
  const view = await mount(wrap(h(Probe)));
  const row = view.host.querySelector("[data-url]") as HTMLElement;
  await click(row);
  expect(view.host.querySelector('[aria-label="Move to…"]')?.getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(
    view.host.querySelector('[aria-label="Move to trash"]')?.getAttribute("aria-disabled"),
  ).toBe("true");
  await key(row, "F2");
  expect(ui.dialog).toBeUndefined();
  await key(row, "m");
  expect(ui.dialog).toBeUndefined();
  await key(row, "Delete");
  await act(async () => {
    await actions.rename(foreign, "new.txt");
    await actions.move([foreign], `${ROOT}drive/`);
    await actions.trash([foreign]);
  });
  expect(mocks.client.move).not.toHaveBeenCalled();
  expect(mocks.client.remove).not.toHaveBeenCalled();
  expect(mocks.client.createFolder).toHaveBeenCalledTimes(1);
  await act(async () => actions.toggleStar([foreign]));
  expect(view.host.textContent).toContain("No starred items");
});
it("Recent never scans outside the active Drive root", async () => {
  mocks.client.list.mockResolvedValue([own]);
  const view = await mount(wrap(h(RecentView)));
  expect(view.host.textContent).toContain(own.name);
  expect(mocks.client.list.mock.calls.map(([url]) => url)).toEqual([`${ROOT}drive/`]);
});

it("records a foreign folder opened directly by reference", async () => {
  mocks.ref = encodeRef(folder.url);
  await mount(wrap(h(PreviewRouteView)));
  expect(stored()).toEqual([
    { url: folder.url, name: folder.name, type: "folder", openedAt: expect.any(String) },
  ]);
});

it("records unsupported foreign files only after successful metadata reads", async () => {
  mocks.ref = encodeRef(foreign.url);
  mocks.client.stat.mockResolvedValue({ ...foreign, contentType: "application/octet-stream" });
  const view = await mount(wrap(h(PreviewRouteView)));
  expect(view.host.textContent).toContain("Can't preview this file");
  expect(stored()).toEqual([
    {
      url: foreign.url,
      name: foreign.name,
      type: "file",
      contentType: "application/octet-stream",
      openedAt: expect.any(String),
    },
  ]);
});

it("Shared preserves legacy entries and uses the newest timestamp for each URL", async () => {
  localStorage.setItem(
    prefsKey,
    JSON.stringify({
      openedShared: [
        { url: folder.url, openedAt: "2026-01-01T00:00:00Z" },
        { url: foreign.url, name: "Newest report", type: "file", openedAt: "2026-10-28T10:00:00Z" },
        { url: foreign.url, name: "Old report", type: "file", openedAt: "2026-01-02T00:00:00Z" },
      ],
    }),
  );
  const view = await mount(wrap(h(SharedView)));
  expect(
    [...view.host.querySelectorAll("[data-url]")].map((row) => row.getAttribute("data-url")),
  ).toEqual([foreign.url, folder.url]);
  expect(view.host.textContent).toContain("Newest report");
  expect(view.host.textContent).not.toContain("Old report");
});

it("clears foreign owner labels on selection changes and ignores late discovery", async () => {
  const pending = deferred<Response>();
  http.mockImplementation(async (input, init) => {
    if (String(input) === foreign.url && init?.method === "HEAD") return pending.promise;
    if (String(input) === WEBID)
      return new Response(
        `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${BOB}>; <http://xmlns.com/foaf/0.1/name> "Bob".`,
        { headers: { "content-type": "text/turtle" } },
      );
    return new Response(null, { status: 404 });
  });
  const details = (item: DriveItem) => wrap(h(DetailsPane, { items: [item], onClose: vi.fn() }));
  const view = await mount(details(foreign));
  expect(fact(view.host, "Owner")).toBe("Unknown");
  await view.render(details(own));
  expect(fact(view.host, "Owner")).toBe("Me");
  await act(async () =>
    pending.resolve(
      new Response(null, {
        headers: { link: `<${WEBID}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"` },
      }),
    ),
  );
  expect(fact(view.host, "Owner")).toBe("Me");
  await click(
    [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show technical details",
    ) as Element,
  );
  expect(fact(view.host, "Owner Account ID")).toBe(session.webId);
});

it("records foreign opens in the listing preview dialog without recording own neighbours", async () => {
  let actions!: ReturnType<typeof useDriveActions>;
  let ui!: ReturnType<typeof useDriveUi>;
  function Modal() {
    actions = useDriveActions();
    ui = useDriveUi();
    return h(PreviewDialog);
  }
  const view = await mount(wrap(h(Modal)));
  await act(async () => actions.open(foreign, [foreign, own], ui.setPreview));
  expect(stored()).toEqual([
    {
      url: foreign.url,
      name: foreign.name,
      type: "file",
      contentType: "text/plain",
      openedAt: expect.any(String),
    },
  ]);
  await key(document.body, "ArrowRight");
  expect(stored()).toHaveLength(1);
  await act(async () => ui.setPreview(undefined));
  await view.unmount();
});
