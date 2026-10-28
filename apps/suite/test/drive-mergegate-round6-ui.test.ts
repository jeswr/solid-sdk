// AUTHORED-BY Codex
import { beforeEach, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const route = vi.hoisted(() => ({ ref: "" }));
vi.mock("@/apps/docs/lib/model/type-index", () => ({ ensureTypeRegistrations: vi.fn() }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => {
  const search = new URLSearchParams();
  return {
    useParams: () => ({ ref: route.ref }),
    usePathname: () => "/drive/my",
    useSearchParams: () => search,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

import { PreviewDialog } from "../src/apps/drive/components/preview";
import {
  PreviewRouteView,
  RecentView,
  SharedView,
  StarredView,
} from "../src/apps/drive/components/views";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveUi } from "../src/apps/drive/state/ui";

beforeEach(() => localStorage.clear());

it.each([
  "Shared",
  "Shared without cached metadata",
  "Starred",
  "Recent",
] as const)("%s preview uses one HEAD and one GET per activation despite preference writes", async (surface) => {
  const pod = await wacPod();
  const shared = surface.startsWith("Shared");
  const foreign = surface !== "Recent";
  const storageUrl = foreign ? `${ROOT}alice/` : ROOT;
  const webId = foreign ? `${storageUrl}profile#me` : OWNER;
  const url = `${PUBLIC}placeholder`;
  expect((await pod.anonymous(url)).status).toBe(200);
  const session: PodSession = {
    mode: "demo",
    storageUrl,
    webId,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const prefsKey = `suite.drive.prefs.${webId}`;
  localStorage.setItem(
    prefsKey,
    JSON.stringify({
      starred: [url],
      openedShared:
        surface === "Shared without cached metadata"
          ? [{ url, openedAt: "2026-01-01T00:00:00Z" }]
          : [],
    }),
  );
  let drive!: ReturnType<typeof useDrive>;
  let ui!: ReturnType<typeof useDriveUi>;
  function Probe() {
    drive = useDrive();
    ui = useDriveUi();
    return h(PreviewDialog);
  }
  const tree = (body: ReturnType<typeof h>) =>
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, body, h(Probe)),
    });
  route.ref = encodeRef(url);
  const View = shared ? SharedView : surface === "Starred" ? StarredView : RecentView;
  const view = await mount(
    tree(h(surface === "Shared without cached metadata" ? View : PreviewRouteView)),
  );
  if (surface !== "Shared without cached metadata")
    expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("public");
  await view.render(tree(h(View)));
  expect(view.host.querySelector(`[data-url="${url}"]`)).not.toBeNull();
  const writes = vi.spyOn(Object.getPrototypeOf(localStorage), "setItem");
  const requests = () => pod.calls.filter((call) => call.url === url);
  // Bound the broken implementation too, so a reload loop fails without hanging act().
  pod.intercept(async (target) => {
    if (target === url && requests().length > 12)
      throw new Error("Preview request budget exceeded");
    return undefined;
  });
  try {
    for (let activation = 0; activation < 2; activation++) {
      pod.calls.length = 0;
      writes.mockClear();
      let finishRecent: (() => Promise<void>) | undefined;
      if (surface === "Recent" && activation === 0) {
        // A scan started before opening can replace rows after the preview is hydrated.
        const listing = await drive.client.list(PUBLIC);
        const pending = deferred<DriveItem[]>();
        const list = drive.client.list.bind(drive.client);
        const spy = vi
          .spyOn(drive.client, "list")
          .mockImplementation((folder, options) =>
            folder === PUBLIC ? pending.promise : list(folder, options),
          );
        await act(async () => drive.invalidate(url));
        finishRecent = async () => {
          await act(async () => pending.resolve(listing.map((item) => ({ ...item }))));
          spy.mockRestore();
        };
      }
      const row = view.host.querySelector(`[data-url="${url}"]`) as HTMLElement;
      await click(row);
      await key(row, "Enter");
      const source = ui.preview?.items[ui.preview.index];
      if (finishRecent) {
        await finishRecent();
        expect(ui.preview?.items[ui.preview.index]).toBe(source);
      }
      expect(writes.mock.calls.filter(([key]) => key === prefsKey)).toHaveLength(foreign ? 1 : 0);
      if (shared)
        expect(ui.preview?.items[ui.preview.index]).toMatchObject({
          contentType: "text/plain",
          size: 6,
          etag: expect.any(String),
        });
      // Simulate another preference subscriber rebuilding arrays during the open preview.
      await act(async () =>
        drive.updatePrefs((current) => ({ ...current, sort: { ...current.sort } })),
      );
      if (shared) expect(ui.preview?.items[ui.preview.index]).toBe(source);
      expect(requests()).toEqual([
        { url, method: "HEAD" },
        { url, method: "GET" },
      ]);
      expect(document.querySelector('[role="dialog"] .drv-preview-text')?.textContent).toBe(
        "public",
      );
      expect(writes.mock.calls.filter(([key]) => key === prefsKey)).toHaveLength(foreign ? 2 : 1);
      if (shared && activation === 0) {
        // A real ETag change reloads this activation's bytes without recording another open.
        const before = JSON.parse(localStorage.getItem(prefsKey) as string).openedShared;
        pod.calls.length = 0;
        await act(async () => {
          await pod.pod.fetch(url, {
            method: "PUT",
            headers: { "content-type": "text/plain" },
            body: "public",
          });
          drive.invalidate(url);
        });
        expect(requests()).toEqual([
          { url, method: "HEAD" },
          { url, method: "GET" },
        ]);
        expect(document.querySelector('[role="dialog"] .drv-preview-text')?.textContent).toBe(
          "public",
        );
        expect(writes.mock.calls.filter(([key]) => key === prefsKey)).toHaveLength(2);
        expect(JSON.parse(localStorage.getItem(prefsKey) as string).openedShared).toEqual(before);
      }
      await act(async () => ui.setPreview(undefined));
    }
    expect(drive.driveRoot).toBe(foreign ? `${storageUrl}drive/` : DRIVE);
  } finally {
    writes.mockRestore();
    await view.unmount();
  }
});
