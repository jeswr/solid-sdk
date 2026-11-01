// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams({ q: "secret" }),
  router: { push: vi.fn(), replace: vi.fn() },
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

import { DriveApp } from "../src/apps/drive/components/drive-app";
import {
  RecentView,
  SearchView,
  SharedView,
  StarredView,
  TrashView,
} from "../src/apps/drive/components/views";
import { listTrash, trashItems } from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveActions } from "../src/apps/drive/state/ui";

let actions: ReturnType<typeof useDriveActions>;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  actions = useDriveActions();
  return null;
}
function tree(body: ReactNode) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup() {
  const f = await wacPod();
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const view = await mount(tree(null));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
    expect(view.host.querySelector(".drv-usage")?.textContent).toMatch(/used$/);
  });
  return { f, view };
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it("Starred stays usable after star, trash, permanent delete and prunes descendant metadata", async () => {
  const { view } = await setup();
  const file = await drive.client.stat(`${PRIVATE}secret`);
  const other = `${DRIVE}public/placeholder`;
  await act(async () => {
    actions.toggleStar([file]);
    drive.updatePrefs((prefs) => ({
      ...prefs,
      starred: [...prefs.starred, PRIVATE, other],
      openedShared: [{ url: file.url, openedAt: new Date().toISOString() }],
    }));
  });
  await act(async () => actions.trash([await drive.client.stat(PRIVATE)]));
  const entries = await listTrash(drive.client, DRIVE);
  await act(async () => actions.removeForever(entries));
  await view.render(tree(h(StarredView)));
  await vi.waitFor(() => expect(view.host.querySelector(`[data-url="${other}"]`)).not.toBeNull());
  expect(view.host.querySelector('.drv-page [role="alert"]')).toBeNull();
  expect(drive.prefs.starred).toEqual([other]);
  expect(drive.prefs.openedShared).toEqual([]);
});

it.each([404, 410])("Starred drops a %s item while retaining healthy stars", async (status) => {
  const { f, view } = await setup();
  const gone = `${PRIVATE}secret`;
  const other = `${DRIVE}public/placeholder`;
  await act(async () => drive.updatePrefs((prefs) => ({ ...prefs, starred: [gone, other] })));
  f.intercept(async (url, init) =>
    url === gone && init?.method === "HEAD" ? new Response(null, { status }) : undefined,
  );
  await view.render(tree(h(StarredView)));
  await vi.waitFor(() => expect(view.host.querySelector(`[data-url="${other}"]`)).not.toBeNull());
  expect(view.host.querySelector('.drv-page [role="alert"]')).toBeNull();
  expect(drive.prefs.starred).toEqual([other]);
});

it.each([
  404, 410,
])("Shared prunes a %s link and its star without hiding healthy links", async (status) => {
  const { f, view } = await setup();
  const gone = `${PRIVATE}secret`;
  const other = `${DRIVE}public/placeholder`;
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      starred: [gone],
      openedShared: [gone, other].map((url) => ({ url, openedAt: new Date().toISOString() })),
    })),
  );
  f.intercept(async (url, init) =>
    url === gone && init?.method === "HEAD" ? new Response(null, { status }) : undefined,
  );
  await view.render(tree(h(SharedView)));
  await vi.waitFor(() => expect(drive.prefs.openedShared.map(({ url }) => url)).toEqual([other]));
  expect(drive.prefs.starred).toEqual([]);
  expect(view.host.querySelector(`[data-url="${gone}"]`)).toBeNull();
  expect(view.host.querySelector(`[data-url="${other}"]`)).not.toBeNull();
  expect(view.host.textContent).not.toContain("Some items couldn't be read");
});

it.each([
  "network",
  "503",
])("Shared retains retryable %s links and Retry reads again", async (mode) => {
  const { f, view } = await setup();
  const url = `${PRIVATE}secret`;
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      openedShared: [{ url, openedAt: new Date().toISOString() }],
    })),
  );
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "HEAD") {
      if (mode === "network") throw new TypeError("Offline");
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await view.render(tree(h(SharedView)));
  await vi.waitFor(() => expect(view.host.textContent).toContain("Some items couldn't be read"));
  expect(drive.prefs.openedShared).toHaveLength(1);
  expect(view.host.querySelector(`[data-url="${url}"]`)).not.toBeNull();
  f.intercept(undefined);
  await click(button("Retry", view.host));
  await vi.waitFor(() =>
    expect(view.host.textContent).not.toContain("Some items couldn't be read"),
  );
});

it.each([
  RecentView,
  SearchView,
])("aggregate scans prune missing folders and their metadata", async (View) => {
  const { f, view } = await setup();
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      starred: [PRIVATE, `${PRIVATE}secret`],
      openedShared: [{ url: `${PRIVATE}secret`, openedAt: new Date().toISOString() }],
    })),
  );
  f.intercept(async (url, init) =>
    url === PRIVATE && (init?.method ?? "GET") === "GET"
      ? new Response(null, { status: 410 })
      : undefined,
  );
  await view.render(tree(h(View)));
  await vi.waitFor(() => expect(drive.prefs.starred).toEqual([]));
  expect(drive.prefs.openedShared).toEqual([]);
  expect(view.host.querySelector('.drv-page [role="alert"]')).toBeNull();
});

it("Empty Trash prunes deleted stars and descendants through its actual dialog action", async () => {
  const { view } = await setup();
  const result = await trashItems(drive.client, DRIVE, [await drive.client.stat(PRIVATE)], {
    webId: OWNER,
  });
  expect(result.failed).toEqual([]);
  await act(async () =>
    drive.updatePrefs((prefs) => ({ ...prefs, starred: [PRIVATE, `${PRIVATE}secret`] })),
  );
  await view.render(tree(h(TrashView)));
  await vi.waitFor(() => expect(button("Empty trash", view.host).disabled).toBe(false));
  await click(button("Empty trash", view.host));
  await click(button("Empty trash", document.querySelector('[role="alertdialog"]') as HTMLElement));
  await vi.waitFor(() => expect(drive.prefs.starred).toEqual([]));
  expect(await listTrash(drive.client, DRIVE)).toEqual([]);
});

it("pending Trash and Restore show Still deleting on the server with Retry and no success", async () => {
  const { f } = await setup();
  const { toast } = await import("@jeswr/suite-ui");
  f.intercept(async (url, init) =>
    url === `${PRIVATE}secret` && init?.method === "DELETE"
      ? new Response(null, { status: 202 })
      : undefined,
  );
  await act(async () => actions.trash([await drive.client.stat(PRIVATE)]));
  expect(toast.error).toHaveBeenCalledWith(
    "Still deleting on the server",
    expect.objectContaining({ action: { label: "Retry", onClick: expect.any(Function) } }),
  );
  expect(toast.success).not.toHaveBeenCalled();
  vi.mocked(toast.error).mockClear();
  const entries = await listTrash(drive.client, DRIVE);
  await act(async () => actions.restore(entries));
  expect(toast.error).toHaveBeenCalledWith(
    "Still deleting on the server",
    expect.objectContaining({ action: { label: "Retry", onClick: expect.any(Function) } }),
  );
  expect(toast.success).not.toHaveBeenCalled();
});

it("Trash provisioning preserves a pending cleanup message through its access-control error", async () => {
  const { f } = await setup();
  const { toast } = await import("@jeswr/suite-ui");
  const trash = `${DRIVE}.trash/`;
  f.intercept(async (url, init) => {
    if (url === `${trash}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (url === trash && init?.method === "DELETE") return new Response(null, { status: 202 });
    return undefined;
  });
  await act(async () => actions.trash([await drive.client.stat(PRIVATE)]));
  expect(toast.error).toHaveBeenCalledWith(
    "Still deleting on the server",
    expect.objectContaining({ action: { label: "Retry", onClick: expect.any(Function) } }),
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});
