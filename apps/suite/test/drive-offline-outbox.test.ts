// AUTHORED-BY Claude Opus 5.5
// The real outbox with Drive's registered policy and delegate: what a user's offline
// Drive changes go through, end to end (sst-8xm.74.1).
import { createRequire } from "node:module";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, withOutbox } from "@jeswr/suite-sdk/offline";
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { DRIVE_TAG, driveGuardPolicy, textGuard } from "../src/apps/drive/lib/offline/guards";
import { driveReplayDelegate } from "../src/apps/drive/lib/offline/replay";
import { createFolder } from "../src/apps/drive/lib/operations/operations";
import { DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const FILE = `${PUBLIC}placeholder`;

async function setup() {
  const f = await wacPod();
  const network = { up: true };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!network.up) throw new TypeError("Failed to fetch");
    return f.fetch(input, init);
  };
  const outbox = createOutbox({ webId: OWNER, idb: new IDBFactory() });
  await outbox.ready;
  // The outbox's own client only bounds and canonicalises targets for guarded items.
  const storage = createMemoryStorage({ root: ROOT });
  outbox.registerGuardPolicy(DRIVE_TAG, driveGuardPolicy(DRIVE));
  outbox.registerDelegate(
    DRIVE_TAG,
    driveReplayDelegate()({ fetch, storageUrl: ROOT, webId: OWNER }),
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch, webId: OWNER });
  return { f, network, outbox, storage, queueing: withOutbox(storage, outbox), client };
}

it("queues a text save and a new folder offline, and replays both through Drive", async () => {
  const { f, network, outbox, storage, queueing, client } = await setup();
  const opened = await client.readVersion(FILE);
  network.up = false;
  const saved = await queueing.write(FILE, "edited offline", {
    contentType: "text/plain",
    ifMatch: opened.etag as string,
    offline: "queue",
    guard: textGuard(opened.discovery as NonNullable<typeof opened.discovery>),
  });
  expect(saved.queued).toBe(true);
  let queued = 0;
  // The real client fails inside its access discovery, not with a bare fetch error.
  const folder = await createFolder(client, PRIVATE, "Plans", {
    storage: queueing,
    onQueued: () => queued++,
  });
  expect([folder, queued]).toEqual([`${PRIVATE}Plans/`, 1]);
  expect(outbox.pending().map((item) => item.status)).toEqual(["waiting", "waiting"]);
  // A failed replay attempt while the pod is unreachable keeps both waiting, not failed.
  await outbox.replay(storage);
  expect(outbox.pending().map((item) => item.status)).toEqual(["waiting", "waiting"]);
  network.up = true;
  await outbox.replay(storage);
  expect(outbox.pending()).toEqual([]);
  expect(await (await f.pod.fetch(FILE)).text()).toBe("edited offline");
  expect((await f.pod.fetch(`${PRIVATE}Plans/`, { method: "HEAD" })).ok).toBe(true);
  expect((await f.anonymous(`${PRIVATE}Plans/`)).status).toBe(403);
  outbox.close();
});

it("inside Drive's root only Drive-guarded changes queue; elsewhere other apps are unaffected", async () => {
  const { outbox, queueing } = await setup();
  await expect(
    queueing.write(`${DRIVE}loose.txt`, "x", {
      contentType: "text/plain",
      ifMatch: "*",
      offline: "queue",
    }),
  ).rejects.toThrow(/guard required/);
  const elsewhere = await queueing.create(ROOT, "x", {
    name: "a.txt",
    contentType: "text/plain",
    offline: "queue",
  });
  expect(elsewhere.url).toBe(`${ROOT}a.txt`);
  outbox.close();
});

it("surfaces a changed file as a conflict that Keep both resolves with a copy", async () => {
  const { f, network, outbox, storage, queueing, client } = await setup();
  const opened = await client.readVersion(FILE);
  network.up = false;
  await queueing.write(FILE, "mine", {
    contentType: "text/plain",
    ifMatch: opened.etag as string,
    offline: "queue",
    guard: textGuard(opened.discovery as NonNullable<typeof opened.discovery>),
  });
  await f.pod.fetch(FILE, {
    method: "PUT",
    body: "theirs",
    headers: { "content-type": "text/plain" },
  });
  network.up = true;
  await outbox.replay(storage);
  const [conflict] = outbox.conflicts();
  expect(conflict).toBeDefined();
  await outbox.resolve((conflict as NonNullable<typeof conflict>).id, "both");
  expect(outbox.conflicts()).toEqual([]);
  expect(outbox.pending()).toEqual([]);
  expect(await (await f.pod.fetch(FILE)).text()).toBe("theirs");
  const listing = await (await f.pod.fetch(PUBLIC)).text();
  const copy = /<([^>]*placeholder[^>]+)>/.exec(
    listing.replaceAll(`<${FILE}>`, "").replaceAll("<placeholder>", ""),
  )?.[1];
  expect(copy).toBeDefined();
  expect(await (await f.pod.fetch(new URL(copy as string, PUBLIC).href)).text()).toBe("mine");
  outbox.close();
});

it("treats a queued folder that already exists as done", async () => {
  const { f, network, outbox, storage, queueing, client } = await setup();
  network.up = false;
  await createFolder(client, PRIVATE, "Twice", { storage: queueing, onQueued: () => {} });
  network.up = true;
  await f.pod.fetch(`${PRIVATE}Twice/`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
  });
  await outbox.replay(storage);
  expect(outbox.pending()).toEqual([]);
  expect(outbox.conflicts()).toEqual([]);
  outbox.close();
});
