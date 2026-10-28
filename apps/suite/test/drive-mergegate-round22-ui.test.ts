// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import type { PodSession } from "../src/lib/session/pod-session";
import { deleteOutcomes, terminalDelete, unknownDelete } from "./drive-delete-outcomes";
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
import { StarredView, TrashView } from "../src/apps/drive/components/views";
import { listTrash } from "../src/apps/drive/lib/operations/operations";
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

it.each([
  "permanent delete",
  "empty Trash",
])("%s of old Trash preserves the uploaded replacement star and shared reference", async (operation) => {
  const { view } = await setup();
  const original = `${PRIVATE}secret`;
  await act(async () => actions.trash([await drive.client.stat(original)]));
  const entries = await listTrash(drive.client, DRIVE);
  expect(entries).toHaveLength(1);
  await act(async () => {
    drive.uploads.enqueue(PRIVATE, [new File(["replacement"], "secret", { type: "text/plain" })]);
  });
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(drive.uploads.tasks[0]?.status).toBe("done");
    },
    { timeout: 5_000 },
  );
  await act(async () => {
    actions.toggleStar([await drive.client.stat(original)]);
    drive.updatePrefs((prefs) => ({
      ...prefs,
      openedShared: [{ url: original, openedAt: new Date().toISOString() }],
    }));
  });
  if (operation === "permanent delete") await act(async () => actions.removeForever(entries));
  else {
    await view.render(tree(h(TrashView)));
    await vi.waitFor(() => expect(button("Empty trash", view.host).disabled).toBe(false));
    await click(button("Empty trash", view.host));
    await click(
      button("Empty trash", document.querySelector('[role="alertdialog"]') as HTMLElement),
    );
    await vi.waitFor(async () => expect(await listTrash(drive.client, DRIVE)).toEqual([]));
  }
  expect(await (await drive.client.read(original)).text()).toBe("replacement");
  expect(drive.prefs.starred).toEqual([original]);
  expect(drive.prefs.openedShared.map(({ url }) => url)).toEqual([original]);
  await view.render(tree(h(StarredView)));
  await vi.waitFor(() =>
    expect(view.host.querySelector(`[data-url="${original}"]`)).not.toBeNull(),
  );
});

it.each(
  deleteOutcomes,
)("Empty Trash settles only terminal DELETE %s and otherwise keeps its entry guarded", async (outcome) => {
  const { f, view } = await setup();
  await act(async () => actions.trash([await drive.client.stat(`${PRIVATE}secret`)]));
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing entry");
  f.intercept(async (url, init) =>
    url === entry.url && init?.method === "DELETE" && !terminalDelete(outcome)
      ? unknownDelete(outcome)
      : undefined,
  );
  if (terminalDelete(outcome))
    f.after(async (url, method, response) =>
      url === entry.url && method === "DELETE"
        ? new Response(null, { status: outcome as number })
        : response,
    );
  const { toast } = await import("@jeswr/suite-ui");
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  await view.render(tree(h(TrashView)));
  await vi.waitFor(() => expect(button("Empty trash", view.host).disabled).toBe(false));
  await click(button("Empty trash", view.host));
  await click(button("Empty trash", document.querySelector('[role="alertdialog"]') as HTMLElement));
  if (terminalDelete(outcome)) {
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deleted for ever"));
    expect(f.pod.has(entry.url)).toBe(false);
    expect(await listTrash(drive.client, DRIVE)).toEqual([]);
    expect(await deletionLedger(f.fetch).get(entry.url)).toBeUndefined();
  } else {
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Still deleting on the server",
        expect.objectContaining({ action: { label: "Retry", onClick: expect.any(Function) } }),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(f.pod.has(entry.url)).toBe(true);
    expect(await listTrash(drive.client, DRIVE)).toHaveLength(1);
    expect(await deletionLedger(f.fetch).get(entry.url)).toEqual({ sources: [entry.url] });
    await expect(drive.client.remove(entry.url)).rejects.toMatchObject({ kind: "delete-pending" });
    f.intercept(undefined);
    expect((await f.fetch(entry.url, { method: "DELETE" })).ok).toBe(true);
    await act(async () => actions.removeForever([entry]));
    expect(await listTrash(drive.client, DRIVE)).toEqual([]);
    expect(await deletionLedger(f.fetch).get(entry.url)).toBeUndefined();
  }
});

it.each([
  200,
  401,
  403,
  503,
  "network",
  404,
  410,
] as const)("permanent deletion prunes only references confirmed absent by HEAD %s", async (status) => {
  const { f } = await setup();
  const original = `${PRIVATE}secret`;
  await act(async () => actions.trash([await drive.client.stat(original)]));
  const entries = await listTrash(drive.client, DRIVE);
  const entry = entries[0];
  if (!entry) throw new Error("Missing entry");
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      starred: [original, entry.url],
      openedShared: [original, entry.url].map((url) => ({
        url,
        openedAt: new Date().toISOString(),
      })),
    })),
  );
  f.intercept(async (url, init) => {
    if (url === original && init?.method === "HEAD") {
      if (status === "network") throw new TypeError("Offline");
      return new Response(null, { status });
    }
    return undefined;
  });
  await act(async () => actions.removeForever(entries));
  const expected = status === 404 || status === 410 ? [] : [original];
  expect(drive.prefs.starred).toEqual(expected);
  expect(drive.prefs.openedShared.map(({ url }) => url)).toEqual(expected);
});

it("source permanent deletion retains preferences when a replacement appears before its absence check", async () => {
  const { f } = await setup();
  const original = `${PRIVATE}secret`;
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      starred: [original],
      openedShared: [{ url: original, openedAt: new Date().toISOString() }],
    })),
  );
  f.after(async (url, method, response) => {
    if (url === original && method === "DELETE" && response.ok) {
      await f.pod.fetch(original, {
        method: "PUT",
        body: "replacement",
        headers: { "content-type": "text/plain" },
      });
      return new Response(null, { status: 204 });
    }
    return response;
  });
  await act(async () => {
    const result = await actions.removeSourcesForever([await drive.client.stat(original)]);
    expect(result?.done).toHaveLength(1);
  });
  expect(await (await drive.client.read(original)).text()).toBe("replacement");
  expect(drive.prefs.starred).toEqual([original]);
  expect(drive.prefs.openedShared.map(({ url }) => url)).toEqual([original]);
});
