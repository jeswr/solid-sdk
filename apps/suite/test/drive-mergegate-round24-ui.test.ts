// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
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
import { TrashView } from "../src/apps/drive/components/views";
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

it("Replace reserves the source: two Trash requests show already in progress and reload stays clean", async () => {
  const { f, view } = await setup();
  const source = `${PRIVATE}secret`;
  const { toast } = await import("@jeswr/suite-ui");
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "PUT" && new Headers(init.headers).has("if-match")) {
      reached();
      await gate;
    }
    return undefined;
  });
  await act(async () =>
    drive.uploads.enqueue(PRIVATE, [new File(["replacement"], "secret", { type: "text/plain" })]),
  );
  await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("conflict"));
  await act(async () => drive.uploads.resolve(drive.uploads.tasks[0]?.id as string, "replace"));
  await waiting;
  try {
    const item = await drive.client.stat(source);
    await act(async () => {
      await Promise.all([actions.trash([item]), actions.trash([item])]);
    });
    expect(
      vi
        .mocked(toast.error)
        .mock.calls.filter(([message]) => String(message).includes("already in progress")),
    ).toHaveLength(2);
    expect(f.calls.filter(({ url, method }) => url === source && method === "DELETE")).toEqual([]);
    expect(await deletionLedger(f.fetch).records()).toEqual([]);
    expect(await listTrash(drive.client, DRIVE)).toEqual([]);
  } finally {
    release();
  }
  await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("done"));
  expect(await (await drive.client.read(source)).text()).toBe("replacement");
  f.intercept(undefined);
  await view.render(h("div"));
  session = { ...session, fetch: (input, init) => f.fetch(input, init) };
  await view.render(tree(null));
  await vi.waitFor(() => expect(drive.driveRoot).toBe(DRIVE));
  await act(async () => actions.trash([await drive.client.stat(source)]));
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing Trash entry after retry");
  await act(async () => actions.removeForever([entry]));
  expect(await listTrash(drive.client, DRIVE)).toEqual([]);
  expect(await deletionLedger(f.fetch).records()).toEqual([]);
});

it("Trash overlap, Retry, reload and Empty trash preserve a replacement without orphaned guards", async () => {
  const { f, view } = await setup();
  const source = `${PRIVATE}secret`;
  const { toast } = await import("@jeswr/suite-ui");
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "DELETE") {
      reached();
      await gate;
      return new Response(null, { status: 202 });
    }
    return undefined;
  });
  const item = await drive.client.stat(source);
  let first!: Promise<void>;
  await act(async () => {
    first = actions.trash([item]);
    await waiting;
  });
  try {
    await act(async () => actions.trash([item]));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already in progress"));
  } finally {
    release();
    await act(async () => first);
  }
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing pending recovery");
  expect(await deletionLedger(f.fetch).records()).toHaveLength(1);
  await f.pod.fetch(source, {
    method: "PUT",
    body: "replacement",
    headers: { "content-type": "text/plain" },
  });
  const options = vi
    .mocked(toast.error)
    .mock.calls.find(([message]) => message === "Still deleting on the server")?.[1] as
    | { action: { onClick: () => Promise<void> } }
    | undefined;
  if (!options) throw new Error("Missing Retry");
  await act(async () => options.action.onClick());
  expect(await deletionLedger(f.fetch).records()).toEqual([]);
  f.intercept(undefined);
  await view.render(h("div"));
  session = { ...session, fetch: (input, init) => f.fetch(input, init) };
  await view.render(tree(null));
  await vi.waitFor(() => expect(drive.driveRoot).toBe(DRIVE));
  await view.render(tree(h(TrashView)));
  const empty = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Empty trash",
  );
  if (!empty) throw new Error("Missing Empty trash");
  await click(empty);
  const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (button) => button.textContent === "Empty trash",
  );
  if (!confirm) throw new Error("Missing Empty trash confirmation");
  await click(confirm);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(await (await drive.client.read(source)).text()).toBe("replacement");
  expect(await deletionLedger(f.fetch).records()).toEqual([]);
  expect(f.calls.filter(({ url, method }) => url === source && method === "DELETE")).toHaveLength(
    1,
  );
});
