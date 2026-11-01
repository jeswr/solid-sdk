// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { clearTimeout as clearDeadline, setTimeout as deadline } from "node:timers";
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from "vitest";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { exclusiveLocks } from "./drive-locks";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/apps/docs/lib/model/type-index",
  async () => import("../src/apps/docs/lib/model/type-index"),
);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast } from "@jeswr/suite-ui";
import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { TrashView } from "../src/apps/drive/components/views";
import { DriveAccessError } from "../src/apps/drive/lib/client/access";
import { listTrash } from "../src/apps/drive/lib/operations/operations";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveActions } from "../src/apps/drive/state/ui";
import { getDemoPod, resetDemoPod } from "../src/lib/demo-pod/browser";
import { DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const DRIVE = `${DEMO_ROOT}drive/`;
let drive: ReturnType<typeof useDrive>;
let actions: ReturnType<typeof useDriveActions>;
let demoView: Awaited<ReturnType<typeof mount>> | undefined;
let trashLoads: MockInstance<typeof listTrash>;
function Probe() {
  drive = useDrive();
  actions = useDriveActions();
  return null;
}
function bounded<T>(work: Promise<T>, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof deadline>;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = deadline(() => reject(new Error("Drive operation did not settle")), ms);
    }),
  ]).finally(() => clearDeadline(timer));
}
beforeEach(() => {
  // The browser facade keeps its DB connection open; use an independent factory.
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  Object.defineProperty(navigator, "locks", { configurable: true, value: exclusiveLocks(1_000) });
  trashLoads = vi.spyOn(operations, "listTrash");
});
async function cleanupDemo() {
  // Stop subscriptions before draining whole reconciliations. A single fetch
  // settling does not mean its multi-request listTrash operation has finished.
  await demoView?.unmount();
  demoView = undefined;
  await Promise.allSettled(
    trashLoads.mock.results
      .filter((result) => result.type === "return")
      .map((result) => result.value),
  );
  await resetDemoPod();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
}
afterEach(cleanupDemo);

async function setup() {
  const pod = await bounded(getDemoPod());
  const transport = vi.fn(pod.fetch);
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    storageUrl: DEMO_ROOT,
    fetch: transport,
    subscribe: pod.subscribe,
    reset: resetDemoPod,
  };
  const view = await mount(
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, h(Probe), h(TrashView), h(DriveDialogs)),
    }),
  );
  demoView = view;
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
  });
  return { pod, view, transport };
}

it("demo cleanup settles an in-flight Trash reload before resetting its session", async () => {
  const { pod, view, transport } = await setup();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toContain("Trash is empty");
  });
  const started = deferred<void>();
  const gate = deferred<void>();
  transport.mockImplementation(async (input, init) => {
    if (String(input) === `${DRIVE}.trash/index.ttl` && (init?.method ?? "GET") === "GET") {
      started.resolve();
      await gate.promise;
    }
    return pod.fetch(input, init);
  });
  await act(async () => drive.invalidate(`${DRIVE}.trash/`));
  await started.promise;
  const result = trashLoads.mock.results.at(-1);
  if (result?.type !== "return") throw new Error("Missing Trash reload");
  const reloaded = result.value.then(
    (entries) => ({ entries }),
    (error: unknown) => ({ error }),
  );
  const cleaning = cleanupDemo();
  gate.resolve();
  await cleaning;
  expect(await reloaded).toEqual({ entries: [] });
});

it("restores the demo pod's notes.md through the Trash row within the toast deadline", async () => {
  // Only arrangement skips simulated network delay, so the unfixed browser
  // facade fails at the Restore button rather than timing out while trashing.
  const original = globalThis.setTimeout;
  const arrangement = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((callback, delay, ...args) =>
      original(callback, delay === 60 ? 0 : delay, ...args),
    );
  Object.defineProperty(navigator, "locks", { configurable: true, value: exclusiveLocks(10_000) });
  const { pod, view } = await setup();
  const items = await Promise.all(
    ["notes.md", "data.ttl"].map((name) => drive.client.stat(`${DRIVE}${name}`)),
  );
  await act(async () => {
    await bounded(actions.trash(items));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelectorAll("tbody tr")).toHaveLength(2);
  });
  const button = view.host.querySelector('[aria-label="Restore: notes.md"]');
  expect(button).not.toBeNull();
  arrangement.mockRestore();
  await act(async () => {
    await click(button as Element);
    await vi.waitFor(
      () => {
        expect(toast.success).toHaveBeenCalledWith("Restored notes.md");
      },
      { timeout: 5_000, interval: 10 },
    );
  });
  expect(pod.has(`${DRIVE}notes.md`)).toBe(true);
  expect((await listTrash(drive.client, DRIVE)).map(({ name }) => name)).toEqual(["data.ttl"]);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      [...view.host.querySelectorAll("tbody .drv-name")].map((row) => row.textContent),
    ).toEqual(["data.ttl"]);
  });
  expect(toast.error).not.toHaveBeenCalled();
}, 8_000);

it.each([
  "access refusal",
  "lock failure",
])("shows an error toast when restore's exclusive operation rejects: %s", async (failure) => {
  await setup();
  await act(async () => actions.trash([await drive.client.stat(`${DRIVE}notes.md`)]));
  const entries = await listTrash(drive.client, DRIVE);
  expect(entries).toHaveLength(1);
  const error =
    failure === "access refusal"
      ? new DriveAccessError("Access binding refused")
      : new Error("Web Lock request failed");
  vi.spyOn(navigator.locks, "request").mockRejectedValueOnce(error);
  await act(async () => {
    await expect(bounded(actions.restore(entries))).resolves.toBeUndefined();
  });
  expect(toast.error).toHaveBeenCalledWith(
    failure === "access refusal" ? error.message : "Couldn't restore",
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect((await listTrash(drive.client, DRIVE)).map(({ name }) => name)).toEqual(["notes.md"]);
}, 5_000);

it("shows an access refusal from the real restore path and keeps the recovery copy", async () => {
  const { pod, view, transport } = await setup();
  await act(async () => bounded(actions.trash([await drive.client.stat(`${DRIVE}notes.md`)])));
  const entries = await listTrash(drive.client, DRIVE);
  const fetch = pod.fetch;
  transport.mockImplementation(async (input, init) => {
    const response = await fetch(input, init);
    // An unsupported access model must refuse the operation rather than imply privacy.
    if (String(input) === `${DRIVE}notes.md`) response.headers.set("ACP-Allow", 'public="read"');
    return response;
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector('[aria-label="Restore: notes.md"]')).not.toBeNull();
  });
  await act(async () => {
    await click(view.host.querySelector('[aria-label="Restore: notes.md"]') as Element);
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(new DriveAccessError().message),
    );
  });
  expect(toast.success).not.toHaveBeenCalled();
  expect(pod.has(`${DRIVE}notes.md`)).toBe(false);
  expect(pod.has(entries[0]?.url as string)).toBe(true);
  expect((await listTrash(drive.client, DRIVE)).map(({ name }) => name)).toEqual(["notes.md"]);
}, 5_000);

it("serializes concurrent Trash index updates without refusing independent items", async () => {
  await setup();
  const items = await Promise.all(
    ["notes.md", "data.ttl"].map((name) => drive.client.stat(`${DRIVE}${name}`)),
  );
  await act(async () => {
    await bounded(Promise.all(items.map((item) => actions.trash([item]))));
  });
  expect(toast.error).not.toHaveBeenCalled();
  expect((await bounded(listTrash(drive.client, DRIVE))).map(({ name }) => name).sort()).toEqual([
    "data.ttl",
    "notes.md",
  ]);
}, 5_000);

it("continues queued Trash index updates after one update is refused", async () => {
  const { pod, transport } = await setup();
  let refused = false;
  transport.mockImplementation(async (input, init) => {
    if (!refused && String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT") {
      refused = true;
      return new Response(null, { status: 403 });
    }
    return pod.fetch(input, init);
  });
  const items = await Promise.all(
    ["notes.md", "data.ttl"].map((name) => drive.client.stat(`${DRIVE}${name}`)),
  );
  await act(async () => {
    await bounded(Promise.all(items.map((item) => actions.trash([item]))));
  });
  expect(refused).toBe(true);
  expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that");
  expect(pod.has(`${DRIVE}notes.md`)).toBe(true);
  expect((await bounded(listTrash(drive.client, DRIVE))).map(({ name }) => name)).toEqual([
    "data.ttl",
  ]);
}, 5_000);

it("runs upload, rename, move, copy, star, trash, restore, delete forever and empty Trash on the durable demo pod without hangs", async () => {
  const { pod, view } = await setup();
  await act(async () =>
    drive.uploads.enqueue(DRIVE, [
      new File(["uploaded bytes"], "uploaded.txt", { type: "text/plain" }),
    ]),
  );
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(drive.uploads.tasks[0]?.status).toBe("done");
    },
    { timeout: 2_000 },
  );
  const uploaded = `${DRIVE}uploaded.txt`;
  expect(await (await bounded(drive.client.read(uploaded))).text()).toBe("uploaded bytes");
  await act(async () => actions.toggleStar([await drive.client.stat(uploaded)]));
  expect(drive.prefs.starred).toEqual([uploaded]);
  expect(
    JSON.parse(localStorage.getItem(`suite.drive.prefs.${DEMO_WEBID}`) as string).starred,
  ).toEqual([uploaded]);

  const renamed = `${DRIVE}renamed.txt`;
  await act(async () =>
    expect(await bounded(actions.rename(await drive.client.stat(uploaded), "renamed.txt"))).toBe(
      renamed,
    ),
  );
  expect(pod.has(uploaded)).toBe(false);
  expect(pod.has(renamed)).toBe(true);
  expect(drive.prefs.starred).toEqual([renamed]);

  const moved = `${DRIVE}Archive/renamed.txt`;
  await act(async () => {
    const result = await bounded(
      actions.move([await drive.client.stat(renamed)], `${DRIVE}Archive/`, { undoable: false }),
    );
    expect(result?.failed).toEqual([]);
    expect(result?.done).toHaveLength(1);
  });
  expect(pod.has(renamed)).toBe(false);
  expect(drive.prefs.starred).toEqual([moved]);
  let copied = "";
  await act(async () => {
    copied = (await bounded(actions.makeCopy(await drive.client.stat(moved)))) as string;
    expect(copied).toBeTruthy();
  });
  expect(await (await bounded(drive.client.read(copied))).text()).toBe("uploaded bytes");
  expect(await (await bounded(drive.client.read(moved))).text()).toBe("uploaded bytes");

  await act(async () =>
    bounded(actions.trash(await Promise.all([moved, copied].map((url) => drive.client.stat(url))))),
  );
  const entries = await bounded(listTrash(drive.client, DRIVE));
  expect(entries).toHaveLength(2);
  const restore = entries.filter(({ original }) => original === moved);
  const destroy = entries.filter(({ original }) => original === copied);
  expect(restore).toHaveLength(1);
  expect(destroy).toHaveLength(1);
  expect(pod.has(moved)).toBe(false);
  expect(pod.has(copied)).toBe(false);
  await act(async () => {
    const result = await bounded(actions.restore(restore));
    expect(result?.failed).toEqual([]);
    expect(result?.done).toHaveLength(1);
  });
  expect(await (await bounded(drive.client.read(moved))).text()).toBe("uploaded bytes");
  await act(async () => {
    const result = await bounded(actions.removeForever(destroy));
    expect(result?.failed).toEqual([]);
    expect(result?.done).toHaveLength(1);
  });
  expect(pod.has(destroy[0]?.url as string)).toBe(false);
  expect(await bounded(listTrash(drive.client, DRIVE))).toEqual([]);

  await act(async () =>
    bounded(
      actions.trash(
        await Promise.all([moved, `${DRIVE}data.ttl`].map((url) => drive.client.stat(url))),
      ),
    ),
  );
  const emptying = await bounded(listTrash(drive.client, DRIVE));
  expect(emptying).toHaveLength(2);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelectorAll("tbody tr")).toHaveLength(2);
  });
  const empty = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Empty trash",
  );
  await click(empty as Element);
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("2 items");
  const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Empty trash",
  );
  await act(async () => {
    await click(confirm as Element);
    await vi.waitFor(
      () => {
        for (const entry of emptying) expect(pod.has(entry.url)).toBe(false);
        expect(toast.success).toHaveBeenLastCalledWith("Deleted for ever");
      },
      { timeout: 2_000 },
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toContain("Trash is empty");
  });
  expect(await bounded(listTrash(drive.client, DRIVE))).toEqual([]);
  expect(toast.error).not.toHaveBeenCalled();
}, 10_000);
