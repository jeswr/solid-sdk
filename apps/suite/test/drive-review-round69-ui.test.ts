// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));

import { Breadcrumbs } from "../src/apps/drive/components/breadcrumbs";
import { DriveApp } from "../src/apps/drive/components/drive-app";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { createSolidDriveClient, type DriveItem } from "../src/apps/drive/lib/client/client";
import {
  captureDragItems,
  clearDragItems,
  takeDragItems,
} from "../src/apps/drive/state/drag-items";
import { useDrive, useFolder } from "../src/apps/drive/state/drive-context";
import { useDriveUi } from "../src/apps/drive/state/ui";

let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let ui: ReturnType<typeof useDriveUi>;
function Browser({ pinned }: { pinned?: DriveItem }) {
  drive = useDrive();
  ui = useDriveUi();
  const listing = useFolder(PRIVATE);
  return h(FileBrowser, {
    title: "Files",
    folder: PRIVATE,
    items:
      listing.status === "ready"
        ? listing.items.map((item) => (item.url === pinned?.url ? { ...item, ...pinned } : item))
        : undefined,
    columns: [],
    empty: { title: "Empty", icon: null },
  });
}
async function setup(drag = false) {
  const f = await rdfPod();
  await f.pod.fetch(`${PRIVATE}other`, { method: "PUT", body: "other contents" });
  if (drag) {
    f.policies.set(`${DRIVE}.policy`, await aclBody(DRIVE));
    await f.pod.fetch(`${PRIVATE}target/`, { method: "PUT", body: "" });
  }
  const pinned = drag
    ? await createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER }).stat(
        `${PRIVATE}secret`,
      )
    : undefined;
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const tree = (item = pinned) =>
    h(
      DriveApp,
      null,
      drag ? h(Breadcrumbs, { folder: PRIVATE }) : null,
      h(Browser, item ? { pinned: item } : {}),
    );
  const view = await mount(tree());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
    expect(view.host.querySelector(`[data-url="${PRIVATE}secret"]`)).not.toBeNull();
  });
  return { ...view, f, pinned, show: (item: DriveItem) => view.render(tree(item)) };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "list",
  "grid",
])("round 69: ] targets the unselected focused %s item and toggles once", async (mode) => {
  const view = await setup();
  await act(async () =>
    drive.updatePrefs((prefs) => ({ ...prefs, view: mode as "list" | "grid" })),
  );
  const row = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}secret"]`);
  if (!row) throw new Error("Missing row");
  await act(async () => row.focus());
  await key(row, "]");
  expect(ui.detailsOpen).toBe(true);
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([`${PRIVATE}secret`]);
  expect(view.host.querySelector(".drv-details h2")?.textContent).toBe("secret");
  expect(row.getAttribute(mode === "list" ? "aria-selected" : "data-selected")).not.toBe("true");
  await key(row, "]");
  expect(ui.detailsOpen).toBe(false);
  expect(view.host.querySelector(".drv-details")).toBeNull();
});

it("round 69: ] uses the same focused-or-selected targets as d", async () => {
  const view = await setup();
  const other = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}other"]`);
  const secret = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}secret"]`);
  if (!other || !secret) throw new Error("Missing rows");
  await click(other);
  await act(async () => secret.focus());
  await key(secret, "]");
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([`${PRIVATE}secret`]);
  await key(secret, "]");
  await key(secret, "d");
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([`${PRIVATE}secret`]);
});

function transfer() {
  const values = new Map<string, string>();
  return {
    types: ["application/x-solid-drive-items"],
    effectAllowed: "none",
    setData: (kind: string, value: string) => values.set(kind, value),
    getData: (kind: string) => values.get(kind) ?? "",
  };
}
async function dragEvent(element: Element, type: string, data: ReturnType<typeof transfer>) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: data });
    element.dispatchEvent(event);
  });
}

it.each(
  ["folder", "breadcrumb"].flatMap((target) => ["list", "grid"].map((mode) => ({ target, mode }))),
)("round 69 shape a: $target drop in $mode retains the drag's confirmed identity after a listing refresh", async ({
  target,
  mode,
}) => {
  const view = await setup(true);
  const confirmed = view.pinned as DriveItem;
  await act(async () =>
    drive.updatePrefs((prefs) => ({ ...prefs, view: mode as "list" | "grid" })),
  );
  const source = view.host.querySelector(`[data-url="${confirmed.url}"]`);
  if (!source) throw new Error("Missing drag source");
  const data = transfer();
  await dragEvent(source, "dragstart", data);
  await view.f.pod.fetch(confirmed.url, { method: "PUT", body: "another client's replacement" });
  await view.show(await drive.client.stat(confirmed.url));
  const destination = view.host.querySelector(
    target === "breadcrumb"
      ? ".drv-crumbs ol li"
      : mode === "grid"
        ? `[data-drive-row="${PRIVATE}target/"]`
        : `[data-url="${PRIVATE}target/"]`,
  );
  if (!destination) throw new Error("Missing drop target");
  const moving = vi.spyOn(drive.client, "move");
  await dragEvent(destination, "drop", data);
  await vi.waitFor(() => expect(moving).toHaveBeenCalledTimes(1));
  await act(async () => {
    await moving.mock.results[0]?.value.catch(() => undefined);
  });
  expect(moving.mock.calls[0]?.[3]).toMatchObject({
    ifMatch: confirmed.etag,
    verifyHeaders: confirmed.verifyHeaders,
  });
  expect(await (await view.f.pod.fetch(confirmed.url)).text()).toBe("another client's replacement");
  expect(view.f.calls).not.toContainEqual({ url: confirmed.url, method: "DELETE" });
});

it.each([
  "folder",
  "breadcrumb",
])("round 69: an unchanged confirmed drag still moves through the %s target", async (target) => {
  const view = await setup(true);
  const source = view.host.querySelector(`[data-url="${PRIVATE}secret"]`);
  const destination = view.host.querySelector(
    target === "breadcrumb" ? ".drv-crumbs ol li" : `[data-url="${PRIVATE}target/"]`,
  );
  if (!source || !destination) throw new Error("Missing drag nodes");
  const data = transfer();
  const moving = vi.spyOn(drive.client, "move");
  await dragEvent(source, "dragstart", data);
  await dragEvent(destination, "drop", data);
  await vi.waitFor(() => expect(moving).toHaveBeenCalledTimes(1));
  await act(async () => {
    await moving.mock.results[0]?.value;
  });
  const to = target === "breadcrumb" ? `${DRIVE}secret` : `${PRIVATE}target/secret`;
  expect(view.f.pod.has(`${PRIVATE}secret`)).toBe(false);
  expect(await (await view.f.pod.fetch(to)).text()).toBe("secret contents");
});

it("round 69: drag captures are immutable, single-use and scoped to their client and active drag", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const other = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = { ...(await client.stat(`${PRIVATE}secret`)) };
  const confirmed = { ...selected };
  const token = captureDragItems(client, [selected]);
  selected.etag = '"later listing"';
  expect(takeDragItems(other, token)).toEqual([]);
  expect(takeDragItems(client, token)).toEqual([confirmed]);
  expect(takeDragItems(client, token)).toEqual([]);
  const superseded = captureDragItems(client, [confirmed]);
  const current = captureDragItems(client, [confirmed]);
  expect(takeDragItems(client, superseded)).toEqual([]);
  expect(takeDragItems(client, current)).toEqual([confirmed]);
  const cancelled = captureDragItems(client, [confirmed]);
  clearDragItems(client);
  expect(takeDragItems(client, cancelled)).toEqual([]);
});
