// AUTHORED-BY Codex
import { toast } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
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
  usePathname: () => "/drive/trash",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));
// Each case opens a new browser session; the marker itself has separate tests.
vi.mock("../src/apps/drive/state/purge-marker", () => ({ claimPurge: () => true }));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { TrashView } from "../src/apps/drive/components/views";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import * as operations from "../src/apps/drive/lib/operations/operations";

let session: PodSession;
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "resolved",
  "rejected after deletion",
  "refused DELETE",
])("round 70: startup purge invalidates an already loaded Trash when %s without push", async (settlement) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const trashed = await operations.trashItems(
    client,
    DRIVE,
    [await client.stat(`${PRIVATE}secret`)],
    { webId: OWNER, now: new Date(Date.now() - 31 * 86_400_000) },
  );
  expect(trashed.failed).toEqual([]);
  const entry = trashed.done[0];
  if (!entry) throw new Error("Missing expired entry");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let deleting = false;
  f.intercept(async (url, init) => {
    if (url === entry.url && init?.method === "DELETE") {
      deleting = true;
      await held;
    }
    return undefined;
  });
  const realPurge = operations.purgeExpired;
  const errors = vi.spyOn(toast, "error");
  const purging = vi.spyOn(operations, "purgeExpired").mockImplementation(async (...args) => {
    const result = await realPurge(...args);
    if (settlement === "rejected after deletion") throw new Error("Purge settlement failed");
    return result;
  });
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const view = await mount(h(DriveApp, null, h(TrashView)));
  const emptyButton = () =>
    [...view.host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Empty trash",
    );
  try {
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(deleting).toBe(true);
      expect(view.host.querySelector(`[data-url="${entry.url}"]`)).not.toBeNull();
      expect(view.host.querySelector('[aria-label="Restore: secret"]')).not.toBeNull();
      expect(emptyButton()?.disabled).toBe(false);
    });
  } finally {
    // Release even if an assertion fails so the shared operation lock can settle.
    if (settlement === "refused DELETE")
      await f.pod.fetch(entry.url, { method: "PUT", body: "another client's replacement" });
    release();
    await act(async () => {
      await purging.mock.results[0]?.value.catch(() => undefined);
    });
  }
  if (settlement === "refused DELETE") {
    expect(await (await f.pod.fetch(entry.url)).text()).toBe("another client's replacement");
    expect(await operations.listTrash(client, DRIVE)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("This item changed. Refresh and try again.");
    expect(view.host.querySelector(`[data-url="${entry.url}"]`)).not.toBeNull();
    return;
  }
  expect(f.pod.has(entry.url)).toBe(false);
  expect(await operations.listTrash(client, DRIVE)).toEqual([]);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector(`[data-url="${entry.url}"]`)).toBeNull();
    expect(view.host.textContent).toContain("Trash is empty");
    expect(view.host.querySelector('[aria-label="Restore: secret"]')).toBeNull();
    expect(emptyButton()?.disabled).toBe(true);
  });
  expect(purging).toHaveBeenCalledTimes(1);
  if (settlement === "rejected after deletion")
    expect(errors).toHaveBeenCalledWith("Couldn't finish clearing expired Trash");
});
