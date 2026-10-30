// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
import { deletionControl } from "../src/apps/drive/lib/client/deletion";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { sourceOperation } from "../src/apps/drive/lib/client/source-operations";
import {
  deleteForever,
  listTrash,
  moveItems,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import { serializeTrashIndex, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { exclusiveLocks } from "./drive-locks";
import { DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("Trash and Restore remain compatible with clients without reservation support", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  delete client.exclusive;
  const source = `${PRIVATE}secret`;
  const trashed = await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  expect(trashed.done).toHaveLength(1);
  expect((await restoreItems(client, DRIVE, trashed.done)).failed).toEqual([]);
  expect(await (await client.read(source)).text()).toBe("secret contents");
});

it("overlapping refused DELETEs retire their own recovery guards in IndexedDB", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const source = "https://overlap.test/source";
  const releases: (() => void)[] = [];
  const http = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method !== "DELETE") return new Response(null, { headers: { etag: '"old"' } });
    await new Promise<void>((resolve) => releases.push(resolve));
    return new Response(null, { status: 412 });
  });
  const control = deletionControl(http, (status, url) => new DriveError("conflict", status, url));
  const results = Promise.allSettled([
    control.remove(source, '"old"', "https://overlap.test/recovery-a", {
      verifyHeaders: () => undefined,
    }),
    control.remove(source, '"old"', "https://overlap.test/recovery-b", {
      verifyHeaders: () => undefined,
    }),
  ]);
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  for (const release of releases) release();
  expect((await results).every(({ status }) => status === "rejected")).toBe(true);
  expect(await deletionLedger(http).keys()).toEqual([]);
  expect(await control.recheck("https://overlap.test/")).toEqual([]);
});

it("a second Trash is refused while the first source operation is in flight", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const item = await client.stat(source);
  let release!: () => void;
  let deletes = 0;
  let reached!: () => void;
  const deleting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  f.intercept(async (url, init) => {
    if (url !== source || init?.method !== "DELETE") return undefined;
    deletes += 1;
    if (deletes === 1) {
      reached();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return new Response(null, { status: 412 });
  });
  const first = trashItems(client, DRIVE, [item], { webId: OWNER });
  await deleting;
  try {
    const second = await trashItems(client, DRIVE, [item], { webId: OWNER });
    expect(second.failed[0]?.error).toMatchObject({ kind: "operation-in-progress" });
    expect(deletes).toBe(1);
  } finally {
    release();
    await first;
  }
  expect(await deletionLedger(f.fetch).keys()).toEqual([]);
  expect(await listTrash(client, DRIVE)).toHaveLength(1);
});

it.each([
  "move",
  "recursive delete",
])("a folder %s reserves every captured descendant before destructive requests", async (operation) => {
  const f = await wacPod();
  const source = `${PRIVATE}secret`;
  const destination = `${DRIVE}public/recovery/`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.intercept(async (url, init) => {
    if (
      (operation === "move" && url === `${destination}secret` && init?.method === "PUT") ||
      (operation === "recursive delete" && url === source && init?.method === "DELETE")
    ) {
      reached();
      await gate;
    }
    return undefined;
  });
  const first = (
    operation === "move"
      ? client.move(PRIVATE, destination, { kind: "preserve-source" })
      : client.remove(PRIVATE, { recursive: true })
  ).catch((error: unknown) => error);
  await waiting;
  try {
    await expect(client.remove(source)).rejects.toMatchObject({ kind: "operation-in-progress" });
    await expect(
      client.write(
        source,
        "new",
        { contentType: "text/plain", ifMatch: '"old"' },
        { kind: "protect-ancestors" },
      ),
    ).rejects.toMatchObject({ kind: "operation-in-progress" });
  } finally {
    release();
    expect(await first).not.toBeInstanceOf(Error);
  }
});

const outcomes = [204, 412, 202, 503, "network"] as const;
const cases = outcomes.flatMap((a) =>
  outcomes.flatMap((b) => [
    { outcomes: [a, b], order: [0, 1] },
    { outcomes: [a, b], order: [1, 0] },
    ...outcomes.flatMap((c) => [
      { outcomes: [a, b, c], order: [0, 1, 2] },
      { outcomes: [a, b, c], order: [2, 1, 0] },
      { outcomes: [a, b, c], order: [1, 2, 0] },
    ]),
  ]),
);

it.each(
  cases,
)("independent DELETE guards survive outcomes $outcomes settled in order $order", async (scenario) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const root = "https://interleave.test/";
  const source = `${root}source`;
  let changed = false;
  const releases: (() => void)[] = [];
  const copies = new Set(scenario.outcomes.map((_, index) => `${root}recovery-${index}`));
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) !== source) {
      if (init?.method === "DELETE") {
        copies.delete(String(url));
        return new Response(null, { status: 204 });
      }
      return new Response(null, { headers: { etag: '"copy"' } });
    }
    if (init?.method !== "DELETE")
      return new Response(null, { headers: { etag: changed ? '"replacement"' : '"old"' } });
    const index = releases.length;
    await new Promise<void>((resolve) => releases.push(resolve));
    const outcome = scenario.outcomes[index];
    if (outcome === undefined) throw new Error("Unexpected DELETE");
    if (outcome === "network") throw new TypeError("Response lost");
    return new Response(null, { status: outcome });
  });
  const control = deletionControl(http, (status, url) => new DriveError("conflict", status, url));
  const recoveries = scenario.outcomes.map((_, index) => `${root}recovery-${index}`);
  const attempts = recoveries.map((recovery) =>
    control.remove(source, '"old"', recovery, { verifyHeaders: () => undefined }).then(
      () => undefined,
      (error: unknown) => error,
    ),
  );
  try {
    await vi.waitFor(() => expect(releases).toHaveLength(recoveries.length));
    const ledger = deletionLedger(http);
    const before = await ledger.records();
    expect(new Set(before.map(({ id }) => id)).size).toBe(recoveries.length);
    expect(before).toEqual(
      expect.arrayContaining(
        recoveries.map((recovery) => ({
          id: expect.any(String),
          source,
          etag: '"old"',
          recovery,
        })),
      ),
    );
    const retired = new Set<string>();
    for (const index of scenario.order) {
      releases[index]?.();
      await attempts[index];
      const recovery = recoveries[index] as string;
      const outcome = scenario.outcomes[index];
      if (outcome === 204 || outcome === 412) retired.add(recovery);
      const remaining = await ledger.records();
      expect(remaining).toEqual(before.filter((record) => !retired.has(record.recovery as string)));
      for (const copy of recoveries) {
        if (retired.has(copy)) await control.guard(copy);
        else await expect(control.guard(copy)).rejects.toMatchObject({ kind: "delete-pending" });
      }
    }
    // Retry through a recreated transport, as after reload. No extra DELETE is needed.
    const freshTransport: typeof fetch = (input, init) => http(input, init);
    const fresh = deletionControl(freshTransport, (status) => new Error(String(status)));
    const unresolved = recoveries.length - retired.size;
    expect(await fresh.recheck(root)).toEqual(unresolved ? [source] : []);
    changed = true;
    expect(await fresh.recheck(root)).toEqual([]);
    expect(await deletionLedger(freshTransport).records()).toEqual([]);
    for (const recovery of recoveries)
      await fresh.remove(recovery, '"copy"', undefined, { verifyHeaders: () => undefined });
    expect(copies.size).toBe(0);
    expect(await deletionLedger(freshTransport).records()).toEqual([]);
    expect(
      http.mock.calls.filter(([url, init]) => String(url) === source && init?.method === "DELETE"),
    ).toHaveLength(recoveries.length);
  } finally {
    for (const release of releases) release();
    await Promise.all(attempts);
  }
});

it.each([
  "move",
  "delete",
  "replace",
  "trash",
  "move batch",
  "restore",
  "delete forever",
  "empty trash",
])("%s refuses an owned URL before issuing any request", async (operation) => {
  const f = await wacPod();
  const source = `${PRIVATE}secret`;
  const recovery = `${DRIVE}.trash/${crypto.randomUUID()}/secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const fresh = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: (input, init) => f.fetch(input, init),
  });
  const item = await client.stat(source);
  const entry = { url: recovery, original: source, name: "secret", trashedAt: new Date() };
  await client.exclusive?.([source, recovery], async (scoped) => {
    const count = f.calls.length;
    const result =
      operation === "move"
        ? fresh.move(source, `${PRIVATE}renamed`, { kind: "preserve-source" })
        : operation === "delete"
          ? fresh.remove(source)
          : operation === "replace"
            ? fresh.write(
                source,
                "new",
                { contentType: "text/plain", ifMatch: item.etag as string },
                { kind: "protect-ancestors" },
              )
            : operation === "trash"
              ? trashItems(fresh, DRIVE, [item], { webId: OWNER })
              : operation === "move batch"
                ? moveItems(fresh, [source], `${DRIVE}public/`)
                : operation === "restore"
                  ? restoreItems(fresh, DRIVE, [entry])
                  : deleteForever(fresh, DRIVE, [entry]);
    if (["move", "delete", "replace"].includes(operation))
      await expect(result).rejects.toMatchObject({
        kind: "operation-in-progress",
        message: expect.stringContaining("already in progress"),
      });
    else
      expect(await result).toMatchObject({
        done: [],
        failed: [
          expect.objectContaining({
            error: expect.objectContaining({ kind: "operation-in-progress" }),
          }),
        ],
      });
    expect(f.calls).toHaveLength(count);
    // The scoped client can perform its own cleanup without waiting on its source lock.
    await scoped.remove(source);
  });
  expect(f.pod.has(source)).toBe(false);
});

it("Web Locks refuse a different tab and release earlier URL reservations after refusal", async () => {
  const locks = exclusiveLocks();
  vi.stubGlobal("navigator", { locks });
  let release!: () => void;
  const other = locks.request(
    "solid-drive:source:https://locks.test/b",
    async () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  try {
    await expect(
      sourceOperation(["https://locks.test/b", "https://locks.test/a"], async () => 1),
    ).rejects.toMatchObject({ kind: "operation-in-progress" });
    expect(await sourceOperation(["https://locks.test/a"], async () => 2)).toBe(2);
  } finally {
    release();
    await other;
  }
});

it("same-tab reservations work without Web Locks and survive callback failure", async () => {
  vi.stubGlobal("navigator", {});
  await expect(
    sourceOperation(["url"], async (held) => {
      expect(await sourceOperation(["url", "url"], async () => 1, held)).toBe(1);
      await expect(sourceOperation(["url"], async () => 2)).rejects.toMatchObject({
        kind: "operation-in-progress",
      });
      throw new Error("Failed operation");
    }),
  ).rejects.toThrow("Failed operation");
  expect(await sourceOperation(["url"], async () => 3)).toBe(3);
});

it("recovery guards use each request's validator and block only their own unknown references", async () => {
  const http = vi.fn<typeof fetch>(async () => new Response(null, { headers: { etag: '"new"' } }));
  const ledger = deletionLedger(http);
  const source = "https://validators.test/source";
  const recovery = "https://validators.test/shared";
  const settled = { id: "settled", source, recovery, etag: '"old"' };
  const unknown = { id: "unknown", source, recovery, etag: '"new"' };
  const independent = {
    id: "independent",
    source,
    recovery: "https://validators.test/independent",
    etag: '"old"',
  };
  await ledger.add(unknown);
  await ledger.add(settled);
  await ledger.add(independent);
  const control = deletionControl(http, () => new Error());
  await expect(control.guard(recovery)).rejects.toMatchObject({ kind: "delete-pending" });
  expect(await ledger.records()).toEqual([unknown, independent]);
  await control.guard(independent.recovery);
  expect(await ledger.records()).toEqual([unknown]);
  expect(await control.recheck("https://validators.test/")).toEqual([source]);
  await ledger.retire(unknown);
  await control.guard(recovery);
});

it("legacy migration retries a failed commit without losing a previously captured source validator", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", {});
  const http: typeof fetch = async () => new Response(null, { status: 404 });
  const source = "https://migration.test/source";
  const recovery = "https://migration.test/recovery";
  const ledger = deletionLedger(http);
  await ledger.set(source, { sources: [source], etag: '"old"', recovery });
  await ledger.set(recovery, { sources: [source] });
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  put.mockImplementationOnce(() => {
    throw new Error("Commit failed");
  });
  await expect(ledger.records()).rejects.toThrow("Enable browser storage");
  const [captured] = await ledger.records();
  expect(captured).toMatchObject({ source, etag: '"old"', recovery });
  // Simulate reload after the old source key was cleared but its old guard survived.
  await ledger.set(recovery, { sources: [source] });
  expect(await ledger.records()).toEqual([captured]);
  await deletionControl(http, () => new Error()).guard(recovery);
  expect(await ledger.records()).toEqual([]);
});

it.each([
  "legacy",
  "request",
])("reload tolerates another tab retiring a %s record between enumeration and lookup", async (kind) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const http = vi.fn<typeof fetch>();
  const ledger = deletionLedger(http);
  if (kind === "legacy")
    await ledger.set("https://race.test/source", { sources: ["https://race.test/source"] });
  else
    await ledger.add({
      id: "retired-by-other-tab",
      source: "https://race.test/source",
      etag: '"old"',
    });
  const keys = IDBObjectStore.prototype.getAllKeys;
  let reads = 0;
  vi.spyOn(IDBObjectStore.prototype, "getAllKeys").mockImplementation(function (
    this: IDBObjectStore,
  ) {
    const request = keys.call(this);
    if (++reads === 2)
      request.addEventListener("success", () => {
        const tx = this.transaction.db.transaction("requirements", "readwrite");
        tx.objectStore("requirements").delete(
          kind === "legacy"
            ? "delete:https://race.test/source"
            : "delete-request:retired-by-other-tab",
        );
      });
    return request;
  });
  expect(await deletionControl(http, () => new Error()).recheck("https://race.test/")).toEqual([]);
  expect(http).not.toHaveBeenCalled();
});

it.each([
  "restore",
  "delete",
])("%s preserves a foreign tab's pending recovery after reload", async (operation) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const {
    done: [entry],
  } = await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  if (!entry) throw new Error("Missing Trash entry");
  await client.copy(entry.url, source, { kind: "preserve-source" });
  const indexUrl = `${DRIVE}.trash/index.ttl`;
  for (const leaseUntil of [new Date(Date.now() + 60_000), new Date(0)]) {
    const current = await client.readRdf(indexUrl);
    if (!current) throw new Error("Missing Trash index");
    const index = trashIndexFrom(current.dataset);
    const record = index.record(entry.url);
    record.status = "pending";
    record.leaseOwner = "urn:uuid:foreign-tab";
    record.leaseUntil = leaseUntil;
    await client.write(
      indexUrl,
      await serializeTrashIndex(index),
      { contentType: "text/turtle", ifMatch: current.etag as string },
      { kind: "protect-ancestors" },
    );
    const fresh = createSolidDriveClient({
      storageUrl: ROOT,
      fetch: (input, init) => f.fetch(input, init),
    });
    const result =
      operation === "restore"
        ? await restoreItems(fresh, DRIVE, [entry])
        : await deleteForever(fresh, DRIVE, [entry]);
    expect(result).toMatchObject({ done: [], failed: [{ error: { kind: "trash-moving" } }] });
    expect(f.pod.has(entry.url)).toBe(true);
    expect(await (await fresh.read(source)).text()).toBe("secret contents");
  }
});
