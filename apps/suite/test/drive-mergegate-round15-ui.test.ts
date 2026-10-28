// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import type { DriveContextValue } from "../src/apps/drive/state/drive-context";
import { act, click, h, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const notices = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  params: new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: notices.toast,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => notices.params,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => drive }));

import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { PreviewBody } from "../src/apps/drive/components/preview";
import { DriveUiProvider } from "../src/apps/drive/state/ui";

let drive: DriveContextValue;

it.each([
  "Retry",
  "Delete",
])("failed file ACL and cleanup leave a persistent item banner across remounts with working %s", async (action) => {
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) =>
    (url === `${to}.policy` && init?.method === "PUT") || (url === to && init?.method === "DELETE")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  drive = {
    client,
    driveRoot: DRIVE,
    rootError: undefined,
    session: {
      mode: "demo",
      webId: OWNER,
      storageUrl: ROOT,
      displayName: "Owner",
      fetch: f.fetch,
      subscribe: () => () => {},
      reset: vi.fn(),
    },
    prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
    updatePrefs: vi.fn(),
    uploads: {
      tasks: [],
      enqueue: vi.fn(),
      resolve: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    },
    invalidate: vi.fn(),
    changes: { subscribe: () => () => {}, subscribeSubtree: () => () => {} },
  };
  const items = await client.list(PUBLIC);
  const tree = () =>
    h(DriveUiProvider, {
      children: h(FileBrowser, {
        title: "Public",
        items,
        folder: PUBLIC,
        columns: [],
        empty: { title: "Empty", icon: null },
      }),
    });
  let rendered = await mount(tree());
  const banner = () => rendered.host.querySelector('[role="alert"]');
  expect(banner()?.textContent).toContain("This file's sharing could not be secured");
  expect(banner()?.textContent).toContain("copy.txt");
  const button = (label: string) => {
    const found = [...rendered.host.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    );
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  };
  await click(button(action));
  expect(banner()?.textContent).toContain("This file's sharing could not be secured");
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  await rendered.unmount();
  rendered = await mount(tree());
  expect(banner()?.textContent).toContain("This file's sharing could not be secured");
  const item = await client.stat(to);
  const preview = await mount(h(DriveUiProvider, { children: h(PreviewBody, { item }) }));
  expect(preview.host.textContent).toContain("This file's sharing could not be secured");
  await preview.unmount();
  f.intercept(undefined);
  await act(async () => {
    await click(button(action));
  });
  expect(banner()).toBeNull();
  expect(drive.invalidate).toHaveBeenCalledWith(to);
  if (action === "Retry") {
    expect(await protectionLedger(f.fetch).get(to)).toBeUndefined();
    expect((await f.anonymous(to)).status).toBe(403);
  } else expect(f.pod.has(to)).toBe(false);
});
