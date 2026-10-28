// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { buildDocument, docContainerUrls, serializeTurtle } from "../src/apps/docs/lib/model";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import {
  OWNER,
  PRIVATE,
  PUBLIC,
  DRIVE as WAC_DRIVE,
  ROOT as WAC_ROOT,
  wacPod,
} from "./drive-wac-pod";
import { exclusiveWebLocks } from "./web-locks";

const ROOT = "https://locks.test/";
const DRIVE = `${ROOT}drive/`;
const DOC = `${ROOT}docs/plan.ttl`;
const layout = docContainerUrls(DOC);
afterEach(() => vi.unstubAllGlobals());

it("folder provisioning never requests another flight while holding its resource lock", async () => {
  const locks = exclusiveWebLocks();
  vi.stubGlobal("navigator", { locks });
  const { client } = await fixture();
  await client.copy(`${DRIVE}folder/`, `${DRIVE}copy/`, { kind: "preserve-source" });
  expect(
    locks.nested.filter(({ held }) =>
      held.some((name) => name.startsWith("solid-drive:ancestor:")),
    ),
  ).toEqual([]);
}, 3_000);

it("a history read cannot hold a folder flight needed by a pending file restore", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: WAC_ROOT, fetch: f.fetch, webId: OWNER });
  const trash = `${WAC_DRIVE}.trash/`;
  const index = `${trash}index.ttl`;
  await f.pod.fetch(trash, { method: "PUT", body: "" });
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let paused = false;
  f.intercept(async (url, init) => {
    if (url === index && init?.method === "HEAD" && !paused) {
      paused = true;
      reached.resolve();
      await release.promise;
    }
    return undefined;
  });
  const source = `${PRIVATE}secret`;
  const restoring = client.write(
    index,
    "private metadata",
    {
      contentType: "text/plain",
      restoreFrom: { url: source, etag: (await client.stat(source)).etag as string },
    },
    { kind: "protect-ancestors" },
  );
  await reached.promise;
  // A concurrent deletion invalidates the restore's already-checked ancestor.
  expect((await f.pod.fetch(trash, { method: "DELETE" })).ok).toBe(true);
  const recreating = client.createFolder(trash, { kind: "inherit-verified" });
  // Drain the in-memory transport's current work before unblocking the restore.
  await new Promise<void>((resolve) => setImmediate(resolve));
  release.resolve();
  const results = await Promise.allSettled([restoring, recreating]);
  expect(results[0]?.status).toBe("fulfilled");
  expect(results[1]).toMatchObject({ status: "rejected", reason: { kind: "conflict" } });
  expect(await (await client.read(index)).text()).toBe("private metadata");
  expect((await f.anonymous(index)).status).toBe(403);
}, 3_000);

it.each([
  "inherited",
  "archived",
])("%s folder history is read before acquiring its provisioning lock", async (policy) => {
  const locks = exclusiveWebLocks();
  vi.stubGlobal("navigator", { locks });
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: WAC_ROOT, fetch: f.fetch, webId: OWNER });
  f.audit();
  if (policy === "inherited")
    await client.createFolder(`${PUBLIC}new/`, { kind: "inherit-verified" });
  else await client.copy(PRIVATE, `${WAC_DRIVE}copy/`, { kind: "preserve-source" });
  // Source reservations intentionally contain provisioning. Provisioning
  // itself must never enter a second flight while holding an ancestor lock.
  expect(
    locks.nested.filter(({ held }) =>
      held.some((name) => name.startsWith("solid-drive:ancestor:")),
    ),
  ).toEqual([]);
  expect(f.exposures).toEqual([]);
}, 3_000);

it("demo writes use the explicit no-access-control response without rechecking every ancestor", async () => {
  const { pod } = await fixture();
  const fetch = vi.fn<typeof globalThis.fetch>(pod.fetch);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch });
  await client.write(
    `${DRIVE}folder/nested/file`,
    "changed",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
    [`${DRIVE}folder/nested/`, "HEAD"],
    [`${DRIVE}folder/nested/file`, "PUT"],
  ]);
}, 3_000);

async function fixture() {
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      {
        path: "docs/plan.ttl",
        contentType: "text/turtle",
        body: await serializeTurtle(buildDocument(DOC, { title: "Plan" })),
      },
      { path: "docs/plan/updates/one", body: "update", contentType: "application/octet-stream" },
      { path: "drive/folder/nested/file", body: "payload", contentType: "text/plain" },
    ],
  });
  const session: PodSession = {
    mode: "demo",
    storageUrl: ROOT,
    webId: `${ROOT}profile#me`,
    displayName: "Owner",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
  return { pod, session, client };
}

it("Docs trash completes both halves and records their reciprocal pair under Web Locks", async () => {
  const { pod, session, client } = await fixture();
  const result = await deleteDocument(DOC, session);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(2);
  const current = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  if (!current) throw new Error("Missing trash index");
  const index = trashIndexFrom(current.dataset);
  for (const entry of result.done) {
    expect(pod.has(entry.original)).toBe(false);
    expect(pod.has(entry.url)).toBe(true);
    expect(index.record(entry.url).pairedWith).toBe(
      result.done.find((other) => other !== entry)?.url,
    );
  }
}, 3_000);

it("Docs restore completes both halves through a fresh client under Web Locks", async () => {
  const { pod, session } = await fixture();
  const trashed = await deleteDocument(DOC, session);
  expect(trashed.failed).toEqual([]);
  const restored = await restoreDocument(trashed.done, session);
  expect(restored.failed).toEqual([]);
  expect(restored.done).toHaveLength(2);
  expect(pod.has(DOC)).toBe(true);
  expect(pod.has(`${layout.updateLog}one`)).toBe(true);
}, 3_000);

it.each([
  "trash/restore",
  "move",
  "copy",
] as const)("Drive folder %s completes recursively under Web Locks", async (operation) => {
  const { pod, client, session } = await fixture();
  const source = `${DRIVE}folder/`;
  const target = `${DRIVE}destination/folder/`;
  if (operation === "trash/restore") {
    const trashed = await trashItems(client, DRIVE, [await client.stat(source)], {
      webId: session.webId,
    });
    expect(trashed.failed).toEqual([]);
    expect(trashed.done).toHaveLength(1);
    expect(pod.has(source)).toBe(false);
    const restored = await restoreItems(client, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(restored.done).toHaveLength(1);
    expect(await (await client.read(`${source}nested/file`)).text()).toBe("payload");
  } else {
    if (operation === "move") await client.move(source, target, { kind: "confirm-move" });
    else await client.copy(source, target, { kind: "preserve-source" });
    expect(pod.has(source)).toBe(operation === "copy");
    expect(await (await client.read(`${target}nested/file`)).text()).toBe("payload");
  }
}, 3_000);
