// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { buildDocument, parseDocument, serializeTurtle } from "../src/apps/docs/lib/model";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  policyArchiveOf,
} from "../src/apps/drive/lib/client/client";
import { restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { serializeTrashIndex, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

const DOC = `${ROOT}docs/plan.ttl`;
const TREE = `${ROOT}docs/plan/`;
const TARGET = `${ROOT}docs/plan%20(restored).ttl`;
const MOVED = `${ROOT}docs/plan%20(restored)/`;
const INDEX = `${DRIVE}.trash/index.ttl`;

it.each([
  false,
  true,
])("serializes ACL archive receipts and continues after a failed receipt (%s)", async (denied) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  // Three items exercise success, a refused receipt, and continuation afterward.
  for (let index = 0; index < 2; index++)
    await client.write(
      `${PRIVATE}secret-${index}`,
      "secret contents",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    );
  f.audit();
  const items = await client.list(PRIVATE);
  let indexWrites = 0;
  f.intercept(async (url, init) => {
    if (url === INDEX && init?.method === "PUT" && ++indexWrites === 2 && denied)
      return new Response(null, { status: 503 });
    return undefined;
  });
  const trashed = await trashItems(client, DRIVE, items, { webId: OWNER });
  expect(trashed.failed).toHaveLength(denied ? 1 : 0);
  expect(trashed.done).toHaveLength(items.length - (denied ? 1 : 0));
  const current = await client.readRdf(INDEX);
  if (!current) throw new Error("Missing index");
  const index = trashIndexFrom(current.dataset);
  for (const entry of trashed.done) expect(index.record(entry.url).containerAcls).toBe("{}");
  const restored = await restoreItems(client, DRIVE, trashed.done);
  expect(restored.failed).toEqual([]);
  expect(restored.done.map(({ url }) => url)).toEqual(trashed.done.map(({ original }) => original));
  expect(await client.list(PRIVATE)).toHaveLength(items.length);
  expect(f.exposures).toEqual([]);
});

async function fixture() {
  const pod = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, webId: OWNER, fetch: pod.fetch });
  const data = buildDocument(DOC, {
    instanceId: "urn:uuid:00000000-0000-4000-8000-000000000007",
    title: "Private plan",
    body: `<img src="${TREE}assets/chart.png">`,
    assets: `${TREE}assets/`,
  });
  await client.write(
    DOC,
    await serializeTurtle(data),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  await client.write(
    `${TREE}assets/chart.png`,
    "secret contents",
    { contentType: "image/png" },
    { kind: "protect-ancestors" },
  );
  pod.policies.set(`${DOC}.policy`, await aclBody(DOC));
  pod.policies.set(`${TREE}.policy`, await aclBody(TREE));
  pod.audit();
  const trashed = await trashItems(
    client,
    DRIVE,
    [await client.stat(DOC), await client.stat(TREE)],
    {
      webId: OWNER,
    },
  );
  expect(trashed.failed).toEqual([]);
  expect(trashed.done).toHaveLength(2);
  return { ...pod, client, entries: trashed.done };
}

it("keeps a lone snapshot recoverable when rename planning cannot read its bytes", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, webId: OWNER, fetch: f.fetch });
  await client.write(
    DOC,
    await serializeTurtle(buildDocument(DOC, { title: "Private plan" })),
    {
      contentType: "text/turtle",
    },
    { kind: "protect-ancestors" },
  );
  f.policies.set(`${DOC}.policy`, await aclBody(DOC));
  const trashed = await trashItems(client, DRIVE, [await client.stat(DOC)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  await client.write(DOC, "occupant", { contentType: "text/plain" }, { kind: "protect-ancestors" });
  const interrupted = {
    ...client,
    readVersion: async () => {
      throw new TypeError("Snapshot read failed");
    },
  };
  const result = await restoreItems(interrupted, DRIVE, trashed.done);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(f.pod.has(trashed.done[0]?.url as string)).toBe(true);
  expect(f.pod.has(TARGET)).toBe(false);
  expect(await (await client.read(DOC)).text()).toBe("occupant");
});

it.each([
  "pending",
  "partial",
] as const)("a %s lease on either Docs half blocks the entire paired restore", async (status) => {
  for (const leased of [0, 1]) {
    const f = await fixture();
    const current = await f.client.readRdf(INDEX);
    if (!current?.etag) throw new Error("Missing index validator");
    const index = trashIndexFrom(current.dataset);
    const entry = f.entries[leased];
    if (!entry) throw new Error("Missing pair");
    const record = index.record(entry.url);
    record.status = status;
    record.leaseOwner = "urn:uuid:00000000-0000-4000-8000-000000000001";
    record.leaseUntil = new Date(Date.now() + 60_000);
    await f.client.write(
      INDEX,
      await serializeTrashIndex(index),
      {
        contentType: "text/turtle",
        ifMatch: current.etag,
      },
      { kind: "protect-ancestors" },
    );
    const result = await restoreItems(f.client, DRIVE, f.entries.slice(1 - leased, 2 - leased));
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(2);
    for (const failure of result.failed)
      expect(failure.error).toMatchObject({ kind: "trash-moving" });
    expect(f.pod.has(DOC)).toBe(false);
    expect(f.pod.has(TREE)).toBe(false);
    for (const item of f.entries) expect(f.pod.has(item.url)).toBe(true);
  }
});

it.each([
  "archived",
  "legacy-own",
  "legacy-inherited",
])("renamed Docs pairs retain identity and private ACLs before payload writes (%s)", async (mode) => {
  const f = await fixture();
  const snapshot = f.entries[0];
  if (!snapshot) throw new Error("Missing snapshot");
  if (mode !== "archived") await f.client.remove(policyArchiveOf(snapshot.url) as string);
  if (mode === "legacy-inherited") f.policies.delete(`${snapshot.url}.policy`);
  await f.client.write(
    DOC,
    "occupant",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  const exposures: string[] = [];
  f.after(async (url, method, response) => {
    if (f.pod.has(TARGET)) {
      const body = await (await f.pod.fetch(TARGET)).text();
      if (body.includes("Private plan") && (await f.anonymous(TARGET)).status === 200)
        exposures.push(`${method} ${url}`);
    }
    return response;
  });
  const result = await restoreItems(f.client, DRIVE, [snapshot]);
  expect(result.failed).toEqual([]);
  expect(result.done.map(({ url }) => url)).toEqual([TARGET, MOVED]);
  const restored = await f.client.readRdf(TARGET);
  const data = restored && parseDocument(TARGET, restored.dataset);
  expect(data?.instanceId).toBe("urn:uuid:00000000-0000-4000-8000-000000000007");
  expect(data?.body).toContain(`${MOVED}assets/chart.png`);
  expect((await f.anonymous(TARGET)).status).toBe(403);
  expect((await f.anonymous(`${MOVED}assets/chart.png`)).status).toBe(403);
  expect(exposures).toEqual([]);
  expect(f.exposures).toEqual([]);
  for (const entry of f.entries)
    expect(f.pod.has(policyArchiveOf(entry.url) as string)).toBe(false);
});

it.each([
  false,
  true,
])("paired partial Docs restores establish the companion ACL before child payloads (denied: %s)", async (denied) => {
  const f = await fixture();
  const companion = f.entries[1];
  const current = await f.client.readRdf(INDEX);
  if (!companion || !current?.etag) throw new Error("Missing companion intent");
  const index = trashIndexFrom(current.dataset);
  index.record(companion.url).status = "partial";
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    {
      contentType: "text/turtle",
      ifMatch: current.etag,
    },
    { kind: "protect-ancestors" },
  );
  if (denied)
    f.intercept(async (url, init) =>
      url === `${TREE}.policy` && init?.method === "PUT"
        ? new Response(null, { status: 403 })
        : undefined,
    );
  const result = await restoreItems(f.client, DRIVE, [companion]);
  expect(f.exposures).toEqual([]);
  if (denied) {
    expect(result.failed).toHaveLength(1);
    expect(f.pod.has(`${TREE}assets/chart.png`)).toBe(false);
    expect(f.pod.has(TREE)).toBe(false);
    expect(f.pod.has(`${companion.url}assets/chart.png`)).toBe(true);
  } else {
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(2);
    expect((await f.anonymous(`${TREE}assets/chart.png`)).status).toBe(403);
  }
});

it.each([
  "policy-denied",
  "payload-denied",
  "cleanup-denied",
  "cleanup-pending",
  "missing-payload-validator",
  "destination-check-failed",
  "missing-placeholder-validator",
  "source-changed",
  "unknown-access",
  "policy-changed",
  "policy-forged-validator",
  "source-policy-changed",
  "policy-unreadable",
  "lost-payload-ack",
])("rewritten restore safely handles %s", async (mode) => {
  const f = await fixture();
  const snapshot = f.entries[0];
  if (!snapshot) throw new Error("Missing snapshot");
  await f.client.write(
    DOC,
    "occupant",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  if (mode === "unknown-access") {
    await f.client.remove(policyArchiveOf(snapshot.url) as string);
    f.policies.delete(`${snapshot.url}.policy`);
  }
  let reads = 0;
  let lost = false;
  let written = false;
  let originalPolicy: string | undefined;
  let archiveRead = false;
  f.intercept(async (url, init) => {
    const method = init?.method ?? "GET";
    if (
      mode === "destination-check-failed" &&
      archiveRead &&
      url === TARGET &&
      method === "HEAD" &&
      init?.cache !== "no-store"
    )
      return new Response(null, { status: 503 });
    if (mode === "cleanup-pending" && url === TARGET && method === "DELETE")
      return new Response(null, { status: 202 });
    if (mode === "policy-unreadable" && written && url === `${TARGET}.policy` && method === "GET")
      return new Response(null, { status: 403 });
    if (
      mode === "unknown-access" &&
      url === `${new URL(".", snapshot.url).href}.policy` &&
      method === "GET"
    )
      return new Response(null, { status: 403 });
    if (
      ["policy-denied", "cleanup-denied"].includes(mode) &&
      url === `${TARGET}.policy` &&
      method === "PUT"
    )
      return new Response(null, { status: 403 });
    if (mode === "cleanup-denied" && url === TARGET && method === "DELETE")
      return new Response(null, { status: 403 });
    if (
      ["payload-denied", "cleanup-pending"].includes(mode) &&
      url === TARGET &&
      method === "PUT" &&
      init?.body
    )
      return new Response(null, { status: 503 });
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === policyArchiveOf(snapshot.url) && method === "GET") archiveRead = true;
    if (url === TARGET && method === "PUT" && response.ok) {
      written = (await (await f.pod.fetch(TARGET)).text()).includes("Private plan");
      if (written && mode === "missing-payload-validator") {
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(response.body, { status: response.status, headers });
      }
      if (written && ["policy-changed", "policy-forged-validator"].includes(mode)) {
        originalPolicy = f.policies.get(`${TARGET}.policy`);
        f.policies.set(`${TARGET}.policy`, await aclBody(TARGET, true));
      }
      if (written && mode === "source-policy-changed")
        f.policies.set(`${snapshot.url}.policy`, await aclBody(snapshot.url, true));
    }
    if (
      mode === "policy-forged-validator" &&
      written &&
      url === `${TARGET}.policy` &&
      method === "GET"
    ) {
      const headers = new Headers(response.headers);
      headers.set("etag", JSON.stringify(originalPolicy));
      return new Response(response.body, { status: response.status, headers });
    }
    if (mode === "source-changed" && url === snapshot.url && method === "GET" && ++reads === 2) {
      const headers = new Headers(response.headers);
      headers.set("etag", '"changed"');
      return new Response(response.body, { status: response.status, headers });
    }
    if (mode === "missing-placeholder-validator" && url === TARGET && method === "PUT") {
      const headers = new Headers(response.headers);
      headers.delete("etag");
      return new Response(response.body, { status: response.status, headers });
    }
    if (mode === "lost-payload-ack" && url === TARGET && method === "PUT" && response.ok) {
      const body = await (await f.pod.fetch(TARGET)).text();
      if (!lost && body.includes("Private plan")) {
        lost = true;
        throw new TypeError("Response lost after durable payload");
      }
    }
    return response;
  });
  const result = await restoreItems(f.client, DRIVE, [snapshot]);
  if (mode === "lost-payload-ack") {
    expect(lost).toBe(true);
    expect(result.failed).toEqual([]);
    expect(f.pod.has(snapshot.url)).toBe(false);
    expect((await f.anonymous(TARGET)).status).toBe(403);
  } else {
    expect(result.failed).toHaveLength(1);
    expect(f.pod.has(snapshot.url)).toBe(true);
    if (mode === "destination-check-failed")
      expect(result.failed[0]?.error).toMatchObject({
        cause: "Restore destination could not be checked",
      });
    if (["policy-denied", "payload-denied", "source-changed", "unknown-access"].includes(mode))
      expect(f.pod.has(TARGET)).toBe(false);
  }
  expect(f.exposures).toEqual([]);
  expect(await (await f.client.read(DOC)).text()).toBe("occupant");
});

it.each([
  "unchanged",
  "widened destination",
  "source changed after byte reconciliation",
])("binds an already-written Docs snapshot through retry and source deletion (%s)", async (mode) => {
  const f = await fixture();
  const snapshot = f.entries[0];
  if (!snapshot) throw new Error("Missing snapshot");
  await f.client.write(
    DOC,
    "occupant",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  const interrupted = {
    ...f.client,
    async remove(this: DriveClient, ...args: Parameters<DriveClient["remove"]>) {
      if (args[0] === snapshot.url) throw new DriveError("failed", 503, snapshot.url);
      return f.client.remove.apply(this, args);
    },
  };
  const first = await restoreItems(interrupted, DRIVE, [snapshot]);
  expect(first.failed).toHaveLength(1);
  expect(f.pod.has(snapshot.url)).toBe(true);
  expect(f.pod.has(TARGET)).toBe(true);
  if (mode === "widened destination")
    f.policies.set(`${TARGET}.policy`, await aclBody(TARGET, true));
  let reconciled = false;
  f.after(async (url, method, response) => {
    if (url === TARGET && method === "GET") {
      reconciled = true;
      if (mode === "source changed after byte reconciliation")
        f.policies.set(`${snapshot.url}.policy`, await aclBody(snapshot.url, true));
    }
    return response;
  });
  const retried = await restoreItems(f.client, DRIVE, [snapshot]);
  if (mode === "unchanged") {
    expect(reconciled).toBe(true);
    expect(retried.failed).toEqual([]);
    expect(f.pod.has(snapshot.url)).toBe(false);
    expect((await f.anonymous(TARGET)).status).toBe(403);
  } else {
    expect(retried.failed).toHaveLength(1);
    expect(retried.failed[0]?.error).toMatchObject({ kind: "private-access-unavailable" });
    expect(reconciled).toBe(mode === "source changed after byte reconciliation");
    expect(f.pod.has(snapshot.url)).toBe(true);
  }
  expect(await (await f.client.read(DOC)).text()).toBe("occupant");
});
