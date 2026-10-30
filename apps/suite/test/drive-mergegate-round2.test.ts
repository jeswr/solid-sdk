// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { moveWithValidator } from "../src/apps/drive/state/undo";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

it("private file moved to public folder prompts; Cancel leaves source untouched", async () => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
  await expect(
    client.move(`${PRIVATE}secret`, `${PUBLIC}secret`, { kind: "confirm-move" }),
  ).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({ gains: ["Everyone (public)"] }),
  );
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
  expect(f.pod.has(`${PUBLIC}secret`)).toBe(false);
});
it("Move and keep current access installs inherited policy before destination secret bytes", async () => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "keep" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  f.audit();
  await client.move(`${PRIVATE}secret`, `${PUBLIC}secret`, { kind: "confirm-move" });
  expect(confirmAccess).toHaveBeenCalledOnce();
  expect((await f.anonymous(`${PUBLIC}secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
  expect(await (await client.read(`${PUBLIC}secret`)).text()).toBe("secret contents");
});
it.each([
  false,
  true,
])("partial Restore protects children after lost folder DELETE response (ACL failure: %s)", async (fail) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.audit();
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "DELETE" && response.ok)
      throw new Error("Lost DELETE response");
    return response;
  });
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(trashed.failed).toHaveLength(1);
  expect(f.pod.has(PRIVATE)).toBe(false);
  f.after(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.status).toBe("partial");
  if (fail)
    f.intercept(async (url, init) =>
      url === `${PRIVATE}.policy` && init?.method === "PUT"
        ? new Response(null, { status: 403 })
        : undefined,
    );
  const restored = await restoreItems(client, DRIVE, entries);
  expect(f.exposures).toEqual([]);
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(fail ? 404 : 403);
  if (fail) {
    expect(restored.failed).toHaveLength(1);
    expect(f.pod.has(`${PRIVATE}secret`)).toBe(false);
    expect(f.pod.has(PRIVATE)).toBe(false);
  } else {
    expect(restored.failed).toEqual([]);
    expect(await (await client.read(`${PRIVATE}secret`)).text()).toBe("secret contents");
  }
});
it("folder move then Undo succeeds with descendant advertised ACL auxiliaries", async () => {
  const f = await wacPod();
  f.policies.set(`${PRIVATE}secret.policy`, await aclBody(`${PRIVATE}secret`));
  const options = { storageUrl: ROOT, fetch: f.fetch };
  const client = createSolidDriveClient(options);
  const moved = await client.move(PRIVATE, `${PUBLIC}private/`, { kind: "confirm-move" });
  await moveWithValidator(
    options,
    moved.url,
    PRIVATE,
    moved.etag as string,
    moved.tree,
    moved.verifyHeaders,
  );
  expect(await (await client.read(`${PRIVATE}secret`)).text()).toBe("secret contents");
  expect(f.pod.has(moved.url)).toBe(false);
});

it.each([
  "unverified",
  "cleanup-denied",
])("Restore stops before payloads if the folder policy cannot be verified (%s)", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const entry = trashed.done[0];
  if (!entry) throw new Error("Missing trash entry");
  const { trashIndexFrom, serializeTrashIndex } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const url = `${DRIVE}.trash/index.ttl`;
  const saved = await client.readRdf(url);
  if (!saved) throw new Error("Missing index");
  const index = trashIndexFrom(saved.dataset);
  index.record(entry.url).status = "partial";
  await client.write(
    url,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  f.audit();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      if (mode === "cleanup-denied") return new Response(null, { status: 403 });
      f.policies.set(url, await aclBody(PRIVATE, true));
      return new Response(null, { status: 201 });
    }
    if (mode === "cleanup-denied" && url === PRIVATE && init?.method === "DELETE")
      return new Response(null, { status: 403 });
    return undefined;
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.exposures).toEqual([]);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(false);
  expect(f.pod.has(`${entry.url}secret`)).toBe(true);
});

it.each([
  false,
  true,
])("legacy null archive entries retain private recovery access (own ACL absent: %s)", async (absent) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const result = await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], {
    webId: OWNER,
  });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing trash entry");
  const { policyArchiveOf } = await import("../src/apps/drive/lib/client/client");
  await client.write(
    policyArchiveOf(entry.url) as string,
    JSON.stringify({ [entry.url]: null }),
    {
      contentType: "application/json",
    },
    { kind: "protect-ancestors" },
  );
  if (absent) f.policies.delete(`${entry.url}.policy`);
  f.policies.delete(`${PRIVATE}.policy`);
  f.audit();
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});
it("failed partial recovery never deletes an existing target container", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const result = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing trash entry");
  await client.createFolder(PRIVATE, { kind: "inherit-verified" });
  const { trashIndexFrom, serializeTrashIndex } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const indexUrl = `${DRIVE}.trash/index.ttl`;
  const saved = await client.readRdf(indexUrl);
  if (!saved) throw new Error("Missing index");
  const index = trashIndexFrom(saved.dataset);
  index.record(entry.url).status = "partial";
  await client.write(
    indexUrl,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  vi.spyOn(client, "mergeContainer").mockRejectedValue(new Error("Cannot merge safely"));
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.pod.has(PRIVATE)).toBe(true);
  // The only DELETE of this URL belongs to the earlier Trash operation.
  expect(f.calls.filter((call) => call.url === PRIVATE && call.method === "DELETE")).toHaveLength(
    1,
  );
});

it("partial Restore into a surviving public folder stops before merging restricted metadata or children", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const result = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing trash entry");
  // An external writer recreated a public survivor; Drive's provisioner now
  // preserves the archived audience when it creates this URL itself.
  await f.pod.fetch(PRIVATE, { method: "PUT" });
  const { trashIndexFrom, serializeTrashIndex } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const indexUrl = `${DRIVE}.trash/index.ttl`;
  const saved = await client.readRdf(indexUrl);
  if (!saved) throw new Error("Missing index");
  const index = trashIndexFrom(saved.dataset);
  index.record(entry.url).status = "partial";
  await client.write(
    indexUrl,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  f.audit();
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.exposures).toEqual([]);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(false);
  expect(f.pod.has(`${entry.url}secret`)).toBe(true);
});

it.each([
  false,
  true,
])("Restore retains privacy if both its archive and top own policy disappeared (partial: %s)", async (partial) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const result = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing trash entry");
  const { policyArchiveOf } = await import("../src/apps/drive/lib/client/client");
  await client.remove(policyArchiveOf(entry.url) as string);
  f.policies.delete(`${entry.url}.policy`);
  if (partial) {
    const { trashIndexFrom, serializeTrashIndex } = await import(
      "../src/apps/drive/lib/operations/trash-index"
    );
    const url = `${DRIVE}.trash/index.ttl`;
    const saved = await client.readRdf(url);
    if (!saved) throw new Error("Missing index");
    const index = trashIndexFrom(saved.dataset);
    index.record(entry.url).status = "partial";
    await client.write(
      url,
      await serializeTrashIndex(index),
      { contentType: "text/turtle" },
      { kind: "protect-ancestors" },
    );
  }
  f.audit();
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});
