// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { FolderView } from "../src/apps/drive/components/views";
import { resetDemoPod } from "../src/lib/demo-pod/browser";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";
import { encodeRef } from "../src/lib/refs";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };

beforeEach(() => {
  // The real browser facade holds its connection until reset; it must not be
  // treated as a short-lived transaction by drive-ui-dom's act helper.
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
});
afterEach(async () => {
  await resetDemoPod();
  vi.clearAllMocks();
});

it("cold-starts My Drive through the real session and durable pod, then opens Work by keyboard", async () => {
  // Unlike the operation tests, do not open the pod before mounting or mock the
  // session, discovery, client, shell or listing. This exercises root()'s missing
  // heading checkpoint; Chromium's failed script downloads are outside Vitest.
  const view = await mount(h(DriveApp, null, h(FolderView)));
  try {
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(view.host.querySelector("h1")?.textContent).toBe("My Drive");
      expect(
        [...view.host.querySelectorAll("tbody .drv-name")].map((row) => row.textContent),
      ).toEqual(["Archive", "Photos", "Work", "data.ttl", "notes.md"]);
    });
    expect(view.host.textContent).not.toContain("Opening your Drive…");
    expect(view.host.textContent).not.toContain("Can't open your Drive");
    const work = view.host.querySelector(`tr[data-url="${DEMO_ROOT}drive/Work/"]`);
    expect(work).not.toBeNull();
    (work as HTMLElement).focus();
    await key(work as Element, "Enter");
    expect(mocks.router.push).toHaveBeenCalledWith(
      `/drive/f/${encodeRef(`${DEMO_ROOT}drive/Work/`)}`,
    );
  } finally {
    await view.unmount();
  }
});
