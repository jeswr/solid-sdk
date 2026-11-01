// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

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
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveUi } from "../src/apps/drive/state/ui";

let session: PodSession;
let pathname: string;
let ui: ReturnType<typeof useDriveUi>;
let drive: ReturnType<typeof useDrive>;
function Browser({ items, folder }: { items: DriveItem[]; folder?: string }) {
  ui = useDriveUi();
  drive = useDrive();
  return h(FileBrowser, {
    title: "Files",
    items,
    ...(folder ? { folder } : {}),
    columns: [],
    empty: { title: "Empty", icon: null },
  });
}
function Probe() {
  ui = useDriveUi();
  return null;
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "My Drive",
  "Recent",
  "Starred",
  "Trash",
  "same-folder remount",
])("round 71: route remount to %s clears Details metadata and access without a selection", async (destination) => {
  const f = await rdfPod();
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  pathname = "/drive/f/private";
  const source = { url: `${PRIVATE}secret`, name: "secret", kind: "file" as const };
  const view = await mount(
    h(DriveApp, null, h(Browser, { key: "source", items: [source], folder: PRIVATE })),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
  });
  const row = view.host.querySelector<HTMLElement>(`[data-url="${source.url}"]`);
  if (!row) throw new Error("Missing source");
  await click(row);
  await key(row, "d");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you");
  });
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([source.url]);
  if (destination === "My Drive") {
    const link = view.host.querySelector('a[href="/drive/my"]');
    if (!link) throw new Error("Missing My Drive link");
    // Next's route commit is represented by the keyed route body below.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await click(link);
  }
  pathname =
    destination === "same-folder remount"
      ? pathname
      : `/drive/${destination.toLowerCase().replace("my drive", "my")}`;
  await view.render(
    h(
      DriveApp,
      null,
      destination === "Trash"
        ? h(Probe)
        : h(Browser, {
            key: "destination",
            items: [],
            ...(destination === "My Drive"
              ? { folder: DRIVE }
              : destination === "same-folder remount"
                ? { folder: PRIVATE }
                : {}),
          }),
    ),
  );
  expect(ui.detailsOpen).toBe(true);
  expect(ui.detailsItems).toEqual([]);
  expect(view.host.textContent).toContain("Select an item to see its details");
  expect(view.host.querySelector(".drv-access-line")).toBeNull();
  expect(view.host.querySelector(".drv-details h2")?.textContent).not.toBe("secret");
});
