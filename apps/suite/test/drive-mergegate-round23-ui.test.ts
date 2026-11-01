// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it("a replacement finishing during Trash surfaces 412 and releases both endpoints across reload", async () => {
  const { f, view } = await setup();
  const source = `${PRIVATE}secret`;
  const { toast } = await import("@jeswr/suite-ui");
  let releasePut!: () => void;
  let putReached!: () => void;
  let putFinished!: () => void;
  const reached = new Promise<void>((resolve) => {
    putReached = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    putFinished = resolve;
  });
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "PUT" && new Headers(init.headers).has("if-match")) {
      putReached();
      await release;
    }
    if (url === source && init?.method === "DELETE") {
      releasePut();
      await finished;
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === source && method === "PUT" && response.ok) putFinished();
    return response;
  });
  // External writers bypass Drive's source reservations and still need validators.
  const replacement = f.fetch(source, {
    method: "PUT",
    body: "replacement",
    headers: {
      "content-type": "text/plain",
      "if-match": (await drive.client.stat(source)).etag as string,
    },
  });
  await act(async () => reached);
  await act(async () => actions.trash([await drive.client.stat(source)]));
  await replacement;
  expect(toast.error).toHaveBeenCalledWith("This item changed. Refresh and try again.");
  expect(await (await drive.client.read(source)).text()).toBe("replacement");
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing recovery copy");
  expect(await (await drive.client.read(entry.url)).text()).toBe("secret contents");
  expect(await deletionLedger(f.fetch).get(source)).toBeUndefined();
  expect(await deletionLedger(f.fetch).get(entry.url)).toBeUndefined();
  f.intercept(undefined);
  f.after(undefined);
  await view.render(h("div"));
  await view.render(tree(null));
  await vi.waitFor(() => expect(drive.driveRoot).toBe(DRIVE));
  await drive.client.write(
    source,
    "another upload",
    { contentType: "text/plain", ifMatch: (await drive.client.stat(source)).etag as string },
    { kind: "protect-ancestors" },
  );
  await act(async () =>
    expect(await actions.rename(await drive.client.stat(source), "renamed")).toBeDefined(),
  );
  const renamed = `${PRIVATE}renamed`;
  const folder = `${PRIVATE}folder/`;
  await drive.client.createFolder(folder, { kind: "inherit-verified" });
  await act(async () => actions.move([await drive.client.stat(renamed)], folder));
  await act(async () =>
    actions.removeSourcesForever([await drive.client.stat(`${folder}renamed`)]),
  );
  expect(f.pod.has(`${folder}renamed`)).toBe(false);
  expect(f.pod.has(entry.url)).toBe(true);
});

async function retryPendingToast() {
  const { toast } = await import("@jeswr/suite-ui");
  const options = vi
    .mocked(toast.error)
    .mock.calls.find(([message]) => message === "Still deleting on the server")?.[1] as
    | { action: { onClick: () => void } }
    | undefined;
  if (!options) throw new Error("Missing deletion Retry");
  await act(async () => options.action.onClick());
}

it("Trash Retry rechecks the surviving changed source without another DELETE", async () => {
  const { f } = await setup();
  const source = `${PRIVATE}secret`;
  f.intercept(async (url, init) =>
    url === source && init?.method === "DELETE" ? new Response(null, { status: 202 }) : undefined,
  );
  await act(async () => actions.trash([await drive.client.stat(source)]));
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect(await deletionLedger(f.fetch).get(source)).toBeDefined();
  await f.pod.fetch(source, {
    method: "PUT",
    body: "survived",
    headers: { "content-type": "text/plain" },
  });
  await retryPendingToast();
  await vi.waitFor(async () =>
    expect(await deletionLedger(f.fetch).get(entry.url)).toBeUndefined(),
  );
  expect(await deletionLedger(f.fetch).get(source)).toBeUndefined();
  expect(f.calls.filter(({ url, method }) => url === source && method === "DELETE")).toHaveLength(
    1,
  );
  expect(await (await drive.client.read(source)).text()).toBe("survived");
  expect(f.pod.has(entry.url)).toBe(true);
});

it.each([
  "gone",
  "changed",
  "unchanged",
] as const)("Drive load rechecks persisted %s deletion guards and offers Retry while unresolved", async (state) => {
  const { f, view } = await setup();
  const source = `${PRIVATE}secret`;
  f.intercept(async (url, init) =>
    url === source && init?.method === "DELETE" ? new Response(null, { status: 202 }) : undefined,
  );
  await act(async () => actions.trash([await drive.client.stat(source)]));
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  await view.render(h("div"));
  f.intercept(undefined);
  if (state === "gone") await f.pod.fetch(source, { method: "DELETE" });
  if (state === "changed")
    await f.pod.fetch(source, {
      method: "PUT",
      body: "changed",
      headers: { "content-type": "text/plain" },
    });
  const { toast } = await import("@jeswr/suite-ui");
  vi.mocked(toast.error).mockClear();
  session = { ...session, fetch: (input, init) => f.fetch(input, init) };
  await view.render(tree(null));
  await vi.waitFor(() => expect(drive.driveRoot).toBe(DRIVE));
  if (state === "unchanged") {
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Still deleting on the server",
        expect.objectContaining({ action: { label: "Retry", onClick: expect.any(Function) } }),
      ),
    );
    expect(await deletionLedger(f.fetch).get(source)).toBeDefined();
    await f.pod.fetch(source, { method: "DELETE" });
    await retryPendingToast();
  }
  await vi.waitFor(async () =>
    expect(await deletionLedger(f.fetch).get(entry.url)).toBeUndefined(),
  );
  expect(await deletionLedger(f.fetch).get(source)).toBeUndefined();
  expect(f.pod.has(entry.url)).toBe(true);
});
