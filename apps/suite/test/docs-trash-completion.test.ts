// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { buildDocument, docContainerUrls, serializeTurtle } from "../src/apps/docs/lib/model";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  deleteForever,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import { trashEntries, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { exclusiveLocks } from "./drive-locks";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast }));

import { trashDocumentWithUndo } from "../src/apps/docs/components/trash-actions";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const ROOT = DEMO_ROOT;
const DRIVE = `${ROOT}drive/`;
const DOC = `${ROOT}docs/plan.ttl`;
const layout = docContainerUrls(DOC);

beforeEach(() => {
  vi.stubGlobal("navigator", { locks: exclusiveLocks(500) });
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function fixture() {
  const doc = new Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  doc.getText("body").insert(0, "Plan");
  doc.getText("body").insert(4, " for launch");
  doc.destroy();
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      {
        path: "docs/plan.ttl",
        body: await serializeTurtle(
          buildDocument(DOC, { title: "Plan", updateLog: layout.updateLog }),
        ),
        contentType: "text/turtle",
      },
      ...updates.map((body, index) => ({
        path: `docs/plan/updates/${index}`,
        body,
        contentType: "application/octet-stream",
      })),
      { path: "docs/plan/versions/one.ttl", body: "version", contentType: "text/turtle" },
      { path: "docs/plan/assets/image.png", body: "image", contentType: "image/png" },
      { path: "drive/folder/nested/file", body: "payload", contentType: "text/plain" },
    ],
  });
  const deleted = new Set<string>();
  const confirmationReads: string[] = [];
  const http = vi.fn<typeof fetch>(async (input, init) => {
    // A completed DELETE must not depend on a later confirmation read. Model
    // the read endpoint being unavailable after the demo's definitive 205.
    if (init?.method === "HEAD" && init.cache === "no-store" && deleted.has(String(input))) {
      confirmationReads.push(String(input));
      return new Response(null, { status: 503 });
    }
    const response = await pod.fetch(input, init);
    if (init?.method === "DELETE" && response.status === 205) deleted.add(String(input));
    return response;
  });
  const session: PodSession = {
    mode: "demo",
    storageUrl: ROOT,
    webId: `${ROOT}profile#me`,
    displayName: "Owner",
    fetch: http,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  return { pod, http, client, session, confirmationReads };
}

it("Docs dialog trash completes its whole pair on DELETE 205 without waiting for confirmation reads under strict Web Locks", async () => {
  const { pod, client, session, http, confirmationReads } = await fixture();
  expect(await trashDocumentWithUndo(DOC, session, vi.fn())).toBe(true);
  expect(toast).toHaveBeenCalledWith("Moved to trash", expect.any(Object));
  expect(toast.error).not.toHaveBeenCalled();
  expect(confirmationReads).toEqual([]);
  const current = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  if (!current) throw new Error("Missing trash index");
  const index = trashIndexFrom(current.dataset);
  const entries = trashEntries(index);
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect(pod.has(entry.original)).toBe(false);
    expect(pod.has(entry.url)).toBe(true);
    expect(index.record(entry.url).status).toBe("complete");
    expect(index.record(entry.url).pairedWith).toBe(entries.find((other) => other !== entry)?.url);
    expect(await deletionLedger(http).get(entry.original)).toBeUndefined();
    expect(await deletionLedger(http).get(entry.url)).toBeUndefined();
  }
}, 2_000);

it("Drive folder trash completes nested DELETE 205 responses without waiting for confirmation reads under strict Web Locks", async () => {
  const { pod, client, session, http, confirmationReads } = await fixture();
  const source = `${DRIVE}folder/`;
  const result = await trashItems(client, DRIVE, [await client.stat(source)], {
    webId: session.webId,
  });
  expect(result.failed).toEqual([]);
  expect(confirmationReads).toEqual([]);
  expect(result.done).toHaveLength(1);
  const entry = result.done[0];
  if (!entry) throw new Error("Missing folder record");
  expect(pod.has(source)).toBe(false);
  expect(await (await client.read(`${entry.url}nested/file`)).text()).toBe("payload");
  expect(await deletionLedger(http).get(source)).toBeUndefined();
  expect(await deletionLedger(http).get(entry.url)).toBeUndefined();
}, 2_000);

it.each([
  true,
  false,
])("Docs loss-ack reconciliation retains Drive's pending guard when confirmation reads fail (recheck API: %s)", async (canRecheck) => {
  const { pod, client, http } = await fixture();
  const trashed = await trashItems(client, DRIVE, [await client.stat(DOC)]);
  expect(trashed.failed).toEqual([]);
  const entry = trashed.done[0];
  if (!entry) throw new Error("Missing snapshot record");
  const forward = http.getMockImplementation();
  if (!forward) throw new Error("Missing transport");
  http.mockImplementation(async (input, init) => {
    const response = await forward(input, init);
    if (String(input) === entry.url && init?.method === "DELETE")
      throw new TypeError("DELETE acknowledgement lost");
    return response;
  });
  const { recheckDeletions: _recheck, ...withoutRecheck } = client;
  const result = await deleteForever(canRecheck ? client : withoutRecheck, DRIVE, [entry]);
  expect(result.done).toEqual([]);
  expect(result.failed).toMatchObject([{ url: entry.url, error: { kind: "delete-pending" } }]);
  expect(pod.has(entry.url)).toBe(false);
  expect(await deletionLedger(http).get(entry.url)).toBeDefined();
  const current = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  if (!current) throw new Error("Missing trash index");
  expect(trashEntries(trashIndexFrom(current.dataset))).toMatchObject([{ url: entry.url }]);
});

it("a rewritten Docs restore refuses a source replaced after its validator was captured", async () => {
  const { pod, client, http } = await fixture();
  const captured = await client.stat(DOC);
  const target = `${ROOT}docs/plan%20(restored).ttl`;
  await pod.fetch(DOC, { method: "PUT", body: "another document incarnation" });
  http.mockClear();
  await expect(
    client.write(
      target,
      "relocated snapshot",
      {
        contentType: "text/turtle",
        ifNoneMatch: "*",
        restoreFrom: { url: DOC, etag: captured.etag as string },
      },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "conflict", status: 412, url: DOC });
  expect(http.mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([]);
  expect(pod.has(target)).toBe(false);
  expect(await (await client.read(DOC)).text()).toBe("another document incarnation");
});

it.each([
  "snapshot",
  "companion",
])("restoring only the %s reserves the discovered pair through snapshot and index settlement", async (selection) => {
  const { pod, client, session, http } = await fixture();
  const trashed = await trashItems(
    client,
    DRIVE,
    await Promise.all([client.stat(DOC), client.stat(layout.container)]),
    { webId: session.webId },
  );
  expect(trashed.failed).toEqual([]);
  const [snapshot, companion] = trashed.done;
  if (!snapshot || !companion) throw new Error("Missing document pair");
  await pod.fetch(DOC, { method: "PUT", body: "another document incarnation" });
  const target = `${ROOT}docs/plan%20(restored).ttl`;
  let reached!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  http.mockImplementation(async (input, init) => {
    if (String(input) === target && init?.method === "PUT") {
      reached();
      await gate;
    }
    return pod.fetch(input, init);
  });
  const restoring = restoreItems(client, DRIVE, [selection === "snapshot" ? snapshot : companion]);
  try {
    await Promise.race([
      writing,
      restoring.then(() => {
        throw new Error("Restore settled before writing its renamed snapshot");
      }),
    ]);
    for (const entry of [snapshot, companion]) {
      await expect(client.remove(entry.original)).rejects.toMatchObject({
        kind: "operation-in-progress",
      });
      await expect(client.remove(entry.url)).rejects.toMatchObject({
        kind: "operation-in-progress",
      });
    }
    // Folder restoration has finished, but the snapshot is not advertised yet.
    expect(pod.has(docContainerUrls(target).container)).toBe(true);
    expect(pod.has(target)).toBe(false);
  } finally {
    release();
    const result = await restoring;
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(2);
  }
  expect(await (await client.read(DOC)).text()).toBe("another document incarnation");
  expect(pod.has(target)).toBe(true);
});

it("Docs dialog completes against the durable browser demo pod under strict Web Locks", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const { pod, session } = await fixture();
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("solid-suite-demo", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pods");
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction("pods", "readwrite");
    tx.objectStore("pods").put({ revision: "trash-test", snapshot: pod.snapshot() }, ROOT);
    tx.oncomplete = () => resolve();
  });
  db.close();
  const { getDemoPod, resetDemoPod } = await import("../src/lib/demo-pod/browser");
  const browser = await getDemoPod();
  try {
    expect(await trashDocumentWithUndo(DOC, { ...session, fetch: browser.fetch }, vi.fn())).toBe(
      true,
    );
    expect(toast).toHaveBeenCalledWith("Moved to trash", expect.any(Object));
  } finally {
    await resetDemoPod();
  }
}, 15_000);
