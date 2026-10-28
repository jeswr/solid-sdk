// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient, policyArchiveOf } from "../src/apps/drive/lib/client/client";
import { sameGraph } from "../src/apps/drive/lib/client/rdf";
import { restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { serializeTrashIndex, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { moveWithValidator } from "../src/apps/drive/state/undo";
import {
  ACL,
  aclBody,
  DRIVE,
  OWNER,
  PRIVATE,
  ROOT,
  turtle,
  WacFields,
  wacPod,
} from "./drive-wac-pod";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture data");
  return value;
}

it("restoring a file after trashing its private parent never exposes names or later uploads", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const file = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], {
      webId: OWNER,
    })
  ).done[0];
  const folder = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(folder.failed).toEqual([]);
  if (!file) throw new Error("Missing trashed file");
  f.audit([PRIVATE]);
  expect((await restoreItems(client, DRIVE, [file])).failed).toEqual([]);
  await client.write(`${PRIVATE}another`, "secret contents", { contentType: "text/plain" });
  expect(f.exposures).toEqual([]);
  expect((await f.anonymous(PRIVATE)).status).toBe(403);
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
  expect((await f.anonymous(`${PRIVATE}another`)).status).toBe(403);
});

it("archives every container's own ACL in the index and restores folder grants and defaults", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const nested = `${PRIVATE}nested/`;
  await client.write(`${nested}secret`, "secret contents", { contentType: "text/plain" });
  const original = await parseRdf(await aclBody(nested), "text/turtle");
  const reader = new WacFields(`${nested}#reader`, original, DataFactory);
  reader.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  reader.iris(`${ACL}accessTo`).add(nested);
  reader.iris(`${ACL}default`).add(nested);
  reader.iris(`${ACL}agent`).add(`${ROOT}friend#me`);
  reader.iris(`${ACL}mode`).add(`${ACL}Read`);
  f.policies.set(`${nested}.policy`, await turtle(original));
  const folder = (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER }))
    .done[0];
  if (!folder) throw new Error("Missing folder");
  const saved = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  const archived = JSON.parse(
    trashIndexFrom(required(saved).dataset).record(folder.url).containerAcls as string,
  );
  expect(Object.keys(archived)).toEqual([PRIVATE, nested]);
  expect(sameGraph(await parseRdf(archived[nested].turtle, "text/turtle"), original)).toBe(true);
  f.audit([PRIVATE, nested]);
  expect((await restoreItems(client, DRIVE, [folder])).failed).toEqual([]);
  const restored = await accessControl(f.fetch, ROOT).read(`${nested}.policy`);
  expect(restored.status).toBe("known");
  if (restored.status === "known") expect(sameGraph(restored.policy.dataset, original)).toBe(true);
  await client.write(`${nested}another`, "secret contents", { contentType: "text/plain" });
  expect(f.exposures).toEqual([]);
});

it.each([
  "index",
  "legacy archive",
])("a recreated ancestor restores the %s ACL before its first child", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const nested = `${PRIVATE}nested/`;
  await client.write(`${nested}secret`, "secret contents", { contentType: "text/plain" });
  const original = await parseRdf(await aclBody(nested), "text/turtle");
  const friend = new WacFields(`${nested}#friend`, original, DataFactory);
  friend.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  friend.iris(`${ACL}accessTo`).add(nested);
  friend.iris(`${ACL}default`).add(nested);
  friend.iris(`${ACL}agent`).add(`${ROOT}friend#me`);
  friend.iris(`${ACL}mode`).add(`${ACL}Read`);
  f.policies.set(`${nested}.policy`, await turtle(original));
  const file = (
    await trashItems(client, DRIVE, [await client.stat(`${nested}secret`)], { webId: OWNER })
  ).done[0];
  const folder = (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER }))
    .done[0];
  if (!file || !folder) throw new Error("Missing trash entry");
  const saved = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  const index = trashIndexFrom(required(saved).dataset);
  if (mode === "legacy archive") index.record(folder.url).containerAcls = undefined;
  else await client.remove(required(policyArchiveOf(folder.url))); // The index alone must suffice.
  await client.write(`${DRIVE}.trash/index.ttl`, await serializeTrashIndex(index), {
    contentType: "text/turtle",
  });
  f.audit([PRIVATE, nested]);
  // A new client proves metadata is durable, rather than cached in the deleting tab.
  const onPrivateFolder = vi.fn();
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, onPrivateFolder });
  expect((await restoreItems(fresh, DRIVE, [file])).failed).toEqual([]);
  await fresh.write(`${nested}another`, "secret contents", { contentType: "text/plain" });
  expect(f.exposures).toEqual([]);
  expect(f.policies.has(`${PRIVATE}.policy`)).toBe(true);
  expect(f.policies.has(`${nested}.policy`)).toBe(true);
  expect(
    sameGraph(
      await parseRdf(required(f.policies.get(`${nested}.policy`)), "text/turtle"),
      original,
    ),
  ).toBe(true);
  expect(onPrivateFolder).not.toHaveBeenCalled();
});

it("unknown original ancestor access restores privately and reports the folder", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const file = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER })
  ).done[0];
  if (!file) throw new Error("Missing file");
  await client.remove(PRIVATE);
  const onPrivateFolder = vi.fn();
  const fresh = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    onPrivateFolder,
  });
  f.audit([PRIVATE]);
  expect((await restoreItems(fresh, DRIVE, [file])).failed).toEqual([]);
  await fresh.write(`${PRIVATE}another`, "secret contents", { contentType: "text/plain" });
  expect(onPrivateFolder).toHaveBeenCalledExactlyOnceWith(PRIVATE);
  expect(f.exposures).toEqual([]);
});

it.each([
  "upload",
  "move",
  "undo",
  "new folder",
])("%s into missing ancestors establishes private defaults before any child", async (operation) => {
  const f = await wacPod();
  const onPrivateFolder = vi.fn();
  const options = { storageUrl: ROOT, fetch: f.fetch, webId: OWNER, onPrivateFolder };
  const client = createSolidDriveClient(options);
  const missing = `${DRIVE}missing/`,
    nested = `${missing}nested/`;
  f.audit([missing, nested]);
  if (operation === "upload")
    await client.write(`${nested}secret`, "secret contents", { contentType: "text/plain" });
  else if (operation === "new folder") {
    await client.createFolder(`${nested}new/`);
    await client.write(`${nested}new/secret`, "secret contents", { contentType: "text/plain" });
  } else if (operation === "move") await client.move(`${PRIVATE}secret`, `${nested}secret`);
  else {
    const etag = required((await client.stat(`${PRIVATE}secret`)).etag);
    await moveWithValidator(options, `${PRIVATE}secret`, `${nested}secret`, etag);
  }
  await client.write(`${nested}another`, "secret contents", { contentType: "text/plain" });
  expect(onPrivateFolder.mock.calls).toEqual([[missing], [nested]]);
  expect(f.exposures).toEqual([]);
});

it.each([
  "unreadable index",
  "malformed index archive",
  "absent legacy archive",
  "null legacy policy",
  "malformed legacy policy",
  "no own ACL",
])("unknown ancestor metadata uses verified private defaults: %s", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const file = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER })
  ).done[0];
  const folder = (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER }))
    .done[0];
  if (!file || !folder) throw new Error("Missing entry");
  const saved = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  const index = trashIndexFrom(required(saved).dataset);
  const record = index.record(folder.url);
  if (mode === "malformed index archive") record.containerAcls = "invalid JSON";
  else if (mode === "no own ACL") record.containerAcls = "{}";
  else record.containerAcls = undefined;
  await client.write(`${DRIVE}.trash/index.ttl`, await serializeTrashIndex(index), {
    contentType: "text/turtle",
  });
  if (mode === "absent legacy archive") await client.remove(required(policyArchiveOf(folder.url)));
  if (mode === "null legacy policy" || mode === "malformed legacy policy")
    await client.write(
      required(policyArchiveOf(folder.url)),
      JSON.stringify({
        [folder.url]:
          mode === "null legacy policy"
            ? null
            : { resource: PRIVATE, acl: `${PRIVATE}.policy`, turtle: "invalid RDF" },
      }),
      { contentType: "application/json" },
    );
  if (mode === "unreadable index")
    f.intercept(async (url) =>
      url === `${DRIVE}.trash/index.ttl` ? new Response(null, { status: 403 }) : undefined,
    );
  const onPrivateFolder = vi.fn();
  const fresh = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    onPrivateFolder,
  });
  f.audit([PRIVATE]);
  // A raw upload exercises fallback even when the index itself cannot be read.
  await fresh.write(`${PRIVATE}secret`, "secret contents", { contentType: "text/plain" });
  expect(onPrivateFolder).toHaveBeenCalledExactlyOnceWith(PRIVATE);
  expect(f.exposures).toEqual([]);
});

it.each([
  "denied",
  "unverified",
  "cleanup offline",
  "missing creation validator",
  "raced creation",
])("unverified ancestor ACL stops before children (%s)", async (mode) => {
  const f = await wacPod();
  const missing = `${DRIVE}missing/`;
  const onPrivateFolder = vi.fn();
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    onPrivateFolder,
  });
  f.audit([missing]);
  f.intercept(async (url, init) => {
    if (url === missing && init?.method === "PUT" && mode === "raced creation")
      return new Response(null, { status: 412 });
    if (url === `${missing}.policy` && init?.method === "PUT") {
      if (mode === "unverified") {
        f.policies.set(url, await aclBody(missing, true));
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 403 });
    }
    if (url === missing && init?.method === "DELETE" && mode === "cleanup offline")
      throw new Error("Offline");
    return undefined;
  });
  if (mode === "missing creation validator")
    f.after(async (url, method, response) => {
      if (url === missing && method === "PUT") response.headers.delete("etag");
      return response;
    });
  await expect(
    client.write(`${missing}secret`, "secret contents", { contentType: "text/plain" }),
  ).rejects.toThrow();
  expect(f.pod.has(`${missing}secret`)).toBe(false);
  expect(onPrivateFolder).not.toHaveBeenCalled();
  expect(f.exposures).toEqual([]);
});

it.each([
  "missing owner",
  "denied parent",
  "missing storage root",
  "foreign destination",
])("ancestor provisioning fails before creation: %s", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  if (mode === "denied parent" || mode === "missing storage root")
    f.intercept(async (_url, init) =>
      init?.method === "HEAD"
        ? new Response(null, { status: mode === "denied parent" ? 403 : 404 })
        : undefined,
    );
  const url =
    mode === "foreign destination" ? "https://other.test/secret" : `${DRIVE}missing/nested/secret`;
  await expect(
    client.write(url, "secret contents", { contentType: "text/plain" }),
  ).rejects.toThrow();
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
});
