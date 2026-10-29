// AUTHORED-BY Codex

import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, type DriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import {
  aclBody,
  DRIVE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
  wacPod,
} from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());

it("gate regression: late cancellation removes the payload's PUT version before prompting", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  let payloadEtag: string | null = null;
  const confirmAccess = vi.fn(async () => {
    expect(f.pod.has(to)).toBe(false);
    return "cancel" as const;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  f.after(async (url, method, response) => {
    if (
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      payloadEtag = response.headers.get("etag");
      f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
    }
    return response;
  });
  let deletedEtag: string | null = null;
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "DELETE")
      deletedEtag = new Headers(init.headers).get("if-match");
    return undefined;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow("cancelled");
  expect(payloadEtag).not.toBeNull();
  expect(deletedEtag).toBe(payloadEtag);
  expect(confirmAccess).toHaveBeenCalledOnce();
  expect(f.pod.has(from)).toBe(true);
});

it("gate regression: recursive Move accepts its own nested membership changes", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}tree/`;
  const to = `${PRIVATE}moved/`;
  await f.pod.fetch(`${from}nested/a`, { method: "PUT", body: "secret contents" });
  await f.pod.fetch(`${from}b`, { method: "PUT", body: "second file" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.move(
    from,
    to,
    { kind: "preserve-source" },
    { ifMatch: (await client.stat(from)).etag as string },
  );
  expect(f.pod.has(from)).toBe(false);
  expect(await (await f.pod.fetch(`${to}nested/a`)).text()).toBe("secret contents");
  expect((await f.anonymous(`${to}nested/a`)).status).toBe(403);
});

it("gate regression: failed nested Copy cleans up its own containers and can retry immediately", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}tree/`;
  const to = `${PRIVATE}copied/`;
  await f.pod.fetch(`${from}nested/a`, { method: "PUT", body: "secret contents" });
  await f.pod.fetch(`${from}z`, { method: "PUT", body: "second file" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${to}z` && init?.method === "PUT" && new Headers(init.headers).has("if-match")
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    status: 500,
  });
  expect(f.pod.has(to)).toBe(false);
  expect(f.pod.has(`${from}nested/a`)).toBe(true);
  expect(f.pod.has(`${from}z`)).toBe(true);
  f.intercept(undefined);
  await client.copy(from, to, { kind: "preserve-source" });
  expect(await (await f.pod.fetch(`${to}nested/a`)).text()).toBe("secret contents");
  expect((await f.anonymous(`${to}nested/a`)).status).toBe(403);
});

it("gate regression: partial Restore drains multiple recovery members with pinned ancestors", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}tree/`;
  await f.pod.fetch(`${from}a`, { method: "PUT", body: "secret contents" });
  await f.pod.fetch(`${from}b`, { method: "PUT", body: "second file" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${from}b` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  expect((await restoreItems(client, DRIVE, entries)).failed).toEqual([]);
  expect(await listTrash(client, DRIVE)).toEqual([]);
  expect(await (await f.pod.fetch(`${from}a`)).text()).toBe("secret contents");
  expect(await (await f.pod.fetch(`${from}b`)).text()).toBe("second file");
});

it("gate regression: metadata undo can remove added RDF while destination access is unknown", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  const data = new Store();
  new WacFields(from, data, DataFactory)
    .iris("https://example.test/note")
    .add(`${ROOT}confidential`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const merged = await client.mergeContainer(from, to, { kind: "preserve-source" });
  f.policies.set(`${to}.policy`, "invalid RDF");
  await expect(merged.recheck()).rejects.toThrow();
  expect(await (await f.pod.fetch(to)).text()).not.toContain("confidential");
  expect(f.pod.has(from)).toBe(true);
});

it("gate regression: metadata undo refuses to replay prior RDF under unreadable access", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  for (const [url, value] of [
    [from, "restored-confidential"],
    [to, "prior-confidential"],
  ]) {
    const data = new Store();
    new WacFields(url as string, data, DataFactory)
      .iris("https://example.test/note")
      .add(`${ROOT}${value}`);
    await f.pod.fetch(url as string, { method: "PUT", body: await turtle(data) });
  }
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const merged = await client.mergeContainer(from, to, { kind: "preserve-source" });
  f.policies.set(`${to}.policy`, "invalid RDF");
  f.calls.length = 0;
  await expect(merged.recheck()).rejects.toThrow();
  expect(f.calls).not.toContainEqual({ url: to, method: "PUT" });
  expect(f.pod.has(from)).toBe(true);
});

it("gate regression: an older merge client without a container receipt retains recovery after child restoration", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}tree/`;
  await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${from}child` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  const merge = client.mergeContainer;
  vi.spyOn(client, "mergeContainer").mockImplementation(async function (
    this: DriveClient,
    ...args
  ) {
    const { recheck, disarm, destination } = await merge.apply(this, args);
    return { recheck, disarm, destination };
  });
  expect((await restoreItems(client, DRIVE, entries)).failed).toHaveLength(1);
  expect(f.pod.has(entries[0]?.url as string)).toBe(true);
  expect(f.pod.has(`${entries[0]?.url}child`)).toBe(false);
  expect(await (await f.pod.fetch(`${from}child`)).text()).toBe("secret contents");
});

it("gate regression: Move never adopts a replaced populated destination as its Undo receipt", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`;
  const to = `${PRIVATE}moved/`;
  await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let replaced = false;
  await expect(
    client.move(
      from,
      to,
      { kind: "preserve-source" },
      {
        beforeDelete: async () => {
          if (replaced) return;
          replaced = true;
          await f.pod.fetch(to, { method: "PUT", body: "" });
        },
      },
    ),
  ).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(f.pod.has(`${from}child`)).toBe(true);
  expect(f.pod.has(`${to}child`)).toBe(true);
  expect(f.calls.filter(({ url, method }) => url.startsWith(from) && method === "DELETE")).toEqual(
    [],
  );
});

it("gate regression: Move checks approved external ancestors after the final destination identity proof", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}moved`;
  let destinationProofs = 0;
  let replaced = false;
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (
      String(input) === to &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match") &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents" &&
      ++destinationProofs === 2
    ) {
      replaced = true;
      await f.pod.fetch(PRIVATE, { method: "PUT", body: "" });
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const ancestorEtag = (await client.stat(PRIVATE)).etag as string;
  await expect(
    client.move(
      from,
      to,
      { kind: "preserve-source" },
      {
        sourceGuards: [{ url: PRIVATE, etag: ancestorEtag }],
      },
    ),
  ).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: from, method: "DELETE" });
});
