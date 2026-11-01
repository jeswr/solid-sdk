// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
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
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { trashItems } from "../src/apps/drive/lib/operations/operations";
import { serializeTrashIndex, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveUi } from "../src/apps/drive/state/ui";

let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let ui: ReturnType<typeof useDriveUi>;
function Probe() {
  drive = useDrive();
  ui = useDriveUi();
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
function failRead(f: Awaited<ReturnType<typeof wacPod>>, failed: string, method = "GET") {
  f.intercept(async (url, init) =>
    url === failed && (init?.method ?? "GET") === method
      ? new Response(null, { status: 503 })
      : undefined,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it.each([
  { View: RecentView, label: "Recent", empty: "Nothing recent yet" },
  { View: SearchView, label: "Search", empty: "No results" },
])("$label reports root and partial listing failures with a working Retry", async ({
  View,
  empty,
}) => {
  const { f, view } = await setup();
  for (const failed of [DRIVE, PRIVATE]) {
    await view.render(tree(null));
    failRead(f, failed);
    await view.render(tree(h(View)));
    const page = view.host.querySelector(".drv-page") as HTMLElement;
    await vi.waitFor(() => expect(page.querySelector('[role="alert"]')).not.toBeNull());
    expect(page.textContent).not.toContain(empty);
    f.intercept(undefined);
    await click(button("Retry", page));
    await vi.waitFor(() =>
      expect(page.querySelector(`[data-url="${PRIVATE}secret"]`)).not.toBeNull(),
    );
    expect(page.querySelector('[role="alert"]')).toBeNull();
  }
});

it("Starred reports failed HEADs instead of hiding saved stars and retries all reads", async () => {
  const { f, view } = await setup();
  const urls = [`${PRIVATE}secret`, `${DRIVE}public/placeholder`];
  await act(async () => drive.updatePrefs((prefs) => ({ ...prefs, starred: urls })));
  for (const failures of [urls, [urls[0] as string]]) {
    await view.render(tree(null));
    f.intercept(async (url, init) =>
      failures.includes(url) && init?.method === "HEAD"
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await view.render(tree(h(StarredView)));
    const page = view.host.querySelector(".drv-page") as HTMLElement;
    await vi.waitFor(() => expect(page.querySelector('[role="alert"]')).not.toBeNull());
    expect(page.textContent).not.toContain("No starred items");
    expect(page.querySelectorAll("[data-url]")).toHaveLength(urls.length - failures.length);
    if (failures.length < urls.length)
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        "Some items couldn't be read",
      );
    f.intercept(undefined);
    await click(button("Retry", page));
    await vi.waitFor(() => expect(page.querySelectorAll("[data-url]")).toHaveLength(2));
  }
});

it("Starred ignores a failed query superseded by a different set of stars", async () => {
  const { view } = await setup();
  const stale = deferred<DriveItem>();
  vi.spyOn(drive.client, "stat").mockReturnValueOnce(stale.promise);
  await act(async () =>
    drive.updatePrefs((prefs) => ({ ...prefs, starred: [`${PRIVATE}secret`] })),
  );
  await view.render(tree(h(StarredView)));
  await act(async () => drive.updatePrefs((prefs) => ({ ...prefs, starred: [] })));
  await act(async () => stale.reject(new Error("old failure")));
  expect(view.host.textContent).toContain("No starred items");
  expect(view.host.querySelector(".drv-page [role=alert]")).toBeNull();
});

it("storage usage exposes a failed descendant read with Retry and measures again", async () => {
  const { f, view } = await setup();
  for (const failed of [DRIVE, PRIVATE]) {
    failRead(f, failed);
    await act(async () => drive.invalidate(`${DRIVE}changed`));
    const usage = view.host.querySelector(".drv-usage") as HTMLElement;
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(usage.textContent).toContain("Couldn't measure usage");
    });
    f.intercept(undefined);
    await click(button("Retry", usage));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(usage.textContent).toMatch(/used$/);
    });
  }
});

it("Move tree reports root and expanded folder listing failures and retries that folder", async () => {
  const { f } = await setup();
  const item = await drive.client.stat(`${DRIVE}public/placeholder`);
  failRead(f, DRIVE);
  await act(async () => ui.openDialog({ kind: "move", items: [item] }));
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')).not.toBeNull());
  f.intercept(undefined);
  await click(button("Retry", dialog));
  await vi.waitFor(() => expect(dialog.querySelector(`[data-node="${PRIVATE}"]`)).not.toBeNull());
  const nested = `${PRIVATE}nested/`;
  await f.fetch(nested, { method: "PUT", body: "", headers: { "content-type": "text/turtle" } });
  failRead(f, PRIVATE);
  await click(button("Expand private", dialog));
  await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')).not.toBeNull());
  f.intercept(undefined);
  await click(button("Retry", dialog));
  await vi.waitFor(() => expect(dialog.querySelector(`[data-node="${nested}"]`)).not.toBeNull());
  expect(dialog.querySelector('[role="alert"]')).toBeNull();
});

it("Trash keeps its error state on index, entry and recovery listing failures and Retry re-reads", async () => {
  const { f, view } = await setup();
  const result = await trashItems(drive.client, DRIVE, [await drive.client.stat(PRIVATE)], {
    webId: OWNER,
  });
  expect(result.failed).toEqual([]);
  const entry = result.done[0];
  if (!entry) throw new Error("Missing trash fixture");
  const indexUrl = `${DRIVE}.trash/index.ttl`;
  const current = await drive.client.readRdf(indexUrl);
  if (!current?.etag) throw new Error("Missing trash index");
  const index = trashIndexFrom(current.dataset);
  index.record(entry.url).status = "partial";
  await drive.client.write(
    indexUrl,
    await serializeTrashIndex(index),
    { contentType: "text/turtle", ifMatch: current.etag },
    { kind: "protect-ancestors" },
  );
  for (const [failed, method] of [
    [indexUrl, "GET"],
    [entry.url, "HEAD"],
    [entry.url, "GET"],
  ]) {
    await view.render(tree(null));
    failRead(f, failed as string, method);
    await view.render(tree(h(TrashView)));
    const page = view.host.querySelector(".drv-page") as HTMLElement;
    await vi.waitFor(() => expect(page.querySelector('[role="alert"]')).not.toBeNull());
    expect(page.textContent).not.toContain("Trash is empty");
    f.intercept(undefined);
    await click(button("Retry", page));
    await vi.waitFor(() => expect(page.querySelector(`[data-url="${entry.url}"]`)).not.toBeNull());
  }
});

it("Shared with me keeps saved links visible while the pod is unavailable", async () => {
  const { f, view } = await setup();
  const url = "https://shared.example/report.pdf";
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      openedShared: [{ url, name: "Shared report", openedAt: new Date().toISOString() }],
    })),
  );
  f.intercept(async () => new Response(null, { status: 503 }));
  await view.render(tree(h(SharedView)));
  expect(view.host.querySelector(`[data-url="${url}"]`)).not.toBeNull();
  expect(view.host.textContent).not.toContain("Nothing shared with you yet");
});
