// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DriveAccessError } from "../src/apps/drive/lib/client/access";
import { DrivePartialFailureError } from "../src/apps/drive/lib/client/client";
import { DriveDeletePendingError } from "../src/apps/drive/lib/client/deletion";
import * as operations from "../src/apps/drive/lib/operations/operations";
import * as undo from "../src/apps/drive/state/undo";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

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

it("round 58: mixed bulk moves show every failed member's private recovery URLs", async () => {
  const { f } = await setup();
  const source = `${PRIVATE}tree/`;
  const destination = `${PRIVATE}target/`;
  await f.pod.fetch(destination, { method: "PUT", body: "" });
  await f.pod.fetch(`${source}a`, { method: "PUT", body: "first child" });
  await f.pod.fetch(`${source}b`, { method: "PUT", body: "second child" });
  let refused = false;
  f.intercept(async (url, init) => {
    if (url === `${source}b` && init?.method === "DELETE") {
      refused = true;
      return new Response(null, { status: 403 });
    }
    if (refused && url === `${destination}tree/a.policy`)
      return new Response(null, { status: 503 });
    return undefined;
  });
  const selected = await Promise.all([
    drive.client.stat(`${PRIVATE}secret`),
    drive.client.stat(source),
  ]);
  let result: Awaited<ReturnType<typeof actions.move>>;
  await act(async () => {
    result = await actions.move(selected, destination);
  });
  expect(result?.done).toHaveLength(1);
  expect(result?.failed).toHaveLength(1);
  expect((await f.pod.fetch(`${source}a`)).status).toBe(404);
  expect(await (await f.pod.fetch(`${destination}tree/a`)).text()).toBe("");
  const backups: string[] = [];
  for (const [url] of f.pod.snapshot().resources)
    if (url.includes("/.drive-recovery-") && !url.endsWith("/")) backups.push(url);
  expect(backups).toHaveLength(1);
  for (const url of backups) expect(await (await f.pod.fetch(url)).text()).toBe("first child");
  const { toast } = await import("@jeswr/suite-ui");
  for (const url of backups)
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).toContain(url);
});

it.each([
  "move",
  "Restore",
  "Trash",
  "Delete forever",
])("round 58: bulk %s reports later members and nested pending recovery locations", async (step) => {
  await setup();
  const first = `${ROOT}.drive-recovery-first/0-a`;
  const second = `${ROOT}.drive-recovery-second/0-b`;
  const error = (url: string) =>
    new DrivePartialFailureError(PRIVATE, [], [], [url], new DriveDeletePendingError(PRIVATE));
  const result = {
    done: [],
    failed: [
      { url: `${PRIVATE}a`, error: error(first) },
      {
        url: `${PRIVATE}b`,
        error: new operations.TrashRestorePartialError([
          { url: `${PRIVATE}b`, error: new DriveAccessError(error(second)) },
        ]),
      },
    ],
  };
  const selected = await drive.client.stat(`${PRIVATE}secret`);
  switch (step) {
    case "move":
      vi.spyOn(operations, "moveItems").mockResolvedValue(result);
      await act(async () => {
        await actions.move([selected], PRIVATE);
      });
      break;
    case "Restore":
      vi.spyOn(operations, "restoreItems").mockResolvedValue(result);
      await act(async () => {
        await actions.restore([]);
      });
      break;
    case "Trash":
      vi.spyOn(operations, "trashItems").mockResolvedValue(result);
      await act(async () => {
        await actions.trash([selected]);
      });
      break;
    case "Delete forever":
      vi.spyOn(operations, "deleteForever").mockResolvedValue(result);
      await act(async () => {
        await actions.removeForever([]);
      });
      break;
  }
  const { toast } = await import("@jeswr/suite-ui");
  const messages = JSON.stringify(vi.mocked(toast.error).mock.calls);
  expect(messages).toContain(first);
  expect(messages).toContain(second);
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining(second),
    expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) }),
  );
});

it("round 58: reverse move failures retain private recovery locations", async () => {
  await setup();
  const selected = await drive.client.stat(`${PRIVATE}secret`);
  const to = `${PRIVATE}moved`;
  vi.spyOn(operations, "moveItems").mockResolvedValue({
    done: [{ from: selected.url, to, identity: { url: to, etag: '"moved"' } }],
    failed: [],
  });
  const backup = `${ROOT}.drive-recovery-undo/0-secret`;
  vi.spyOn(undo, "moveWithValidator").mockRejectedValue(
    new DrivePartialFailureError(to, [], [], [backup], new Error("refused")),
  );
  await act(async () => {
    await actions.move([selected], PRIVATE);
  });
  const { toast } = await import("@jeswr/suite-ui");
  const options = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as unknown as {
    action: { onClick(): Promise<void> };
  };
  await act(async () => options.action.onClick());
  expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).toContain(backup);
});

it.each([
  "Restore",
  "Trash",
  "Delete forever",
])("round 58: %s persistence warnings preserve nested recovery locations", async (step) => {
  await setup();
  const backup = `${ROOT}.drive-recovery-index/0-index.ttl`;
  const partial = new DrivePartialFailureError(PRIVATE, [], [], [backup], new Error("refused"));
  const warning = new operations.TrashIndexWarning(
    DRIVE,
    new Error("persistence", { cause: partial }),
  );
  const result = { done: [], failed: [], warnings: [warning] };
  const selected = await drive.client.stat(`${PRIVATE}secret`);
  if (step === "Restore") {
    vi.spyOn(operations, "restoreItems").mockResolvedValue(result);
    await act(async () => {
      await actions.restore([]);
    });
  } else if (step === "Trash") {
    vi.spyOn(operations, "trashItems").mockResolvedValue(result);
    await act(async () => {
      await actions.trash([selected]);
    });
  } else {
    vi.spyOn(operations, "deleteForever").mockResolvedValue(result);
    await act(async () => {
      await actions.removeForever([]);
    });
  }
  const { toast } = await import("@jeswr/suite-ui");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(warning.message));
  expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).toContain(backup);
});
