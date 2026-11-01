// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import {
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
} from "../src/apps/drive/lib/operations/trash-index";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT } from "./drive-wac-pod";

it.each(
  ["Upload", "Keep both", "unconditional creation"].flatMap((step) =>
    [true, false].map((hiddenLink) => ({ step, hiddenLink })),
  ),
)("round 68: $step discovers an orphan own ACL before sending confidential bytes (404 hides Link: $hiddenLink)", async ({
  step,
  hiddenLink,
}) => {
  const f = await rdfPod();
  const target = `${PRIVATE}report.txt`;
  const foreignPolicy = await aclBody(target, true);
  f.policies.set(`${target}.policy`, foreignPolicy);
  const writes: string[] = [];
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "PUT")
      writes.push(init.body instanceof Blob ? await init.body.text() : String(init.body));
    return undefined;
  });
  f.after(async (_url, _method, response) => {
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    return response;
  });
  f.audit();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await (step === "unconditional creation"
    ? client.write(
        target,
        "secret contents",
        { contentType: "text/plain" },
        { kind: "protect-ancestors" },
      )
    : uploadFile(
        client,
        PRIVATE,
        new Blob(["secret contents"], { type: "text/plain" }),
        "report.txt",
        step === "Keep both" ? "keep-both" : "fail",
      )
  ).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(result).toMatchObject({
    message: expect.stringContaining(
      hiddenLink ? "access policy changed" : "access policy already exists",
    ),
  });
  expect(f.exposures).toEqual([]);
  expect(writes).toEqual(hiddenLink ? [""] : []);
  expect(f.policies.get(`${target}.policy`)).toBe(foreignPolicy);
  expect(f.calls).not.toContainEqual({ url: `${target}.policy`, method: "PUT" });
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  expect(await (await f.pod.fetch(target)).text()).not.toContain("secret contents");
});

it.each([
  "Upload",
  "Keep both",
  "unconditional creation",
  "owner-only creation",
  "Copy",
  "Move",
  "Rename",
  "Restore",
])("round 68: %s verifies an empty placeholder before its conditional payload PUT", async (step) => {
  const f = await rdfPod();
  const target = `${PRIVATE}report.txt`;
  const writes: {
    body: string;
    match: string | null;
    none: string | null;
    receipt: string | null;
  }[] = [];
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (String(input) === target && init?.method === "PUT") {
      const headers = new Headers(init.headers);
      writes.push({
        body: init.body instanceof Blob ? await init.body.text() : String(init.body),
        match: headers.get("if-match"),
        none: headers.get("if-none-match"),
        receipt: response.headers.get("etag"),
      });
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  let restore: (() => Promise<unknown>) | undefined;
  if (step === "Restore") {
    await f.pod.fetch(target, { method: "PUT", body: "secret contents" });
    expect(
      (await trashItems(client, DRIVE, [await client.stat(target)], { webId: OWNER })).failed,
    ).toEqual([]);
    const entries = await listTrash(client, DRIVE);
    restore = async () => expect((await restoreItems(client, DRIVE, entries)).failed).toEqual([]);
  }
  f.after(async (_url, _method, response) => {
    if (response.status === 404) response.headers.delete("link");
    return response;
  });
  f.audit();
  if (restore) await restore();
  else if (step === "Copy" || step === "Move" || step === "Rename") {
    const source = await client.stat(`${PRIVATE}secret`);
    if (step === "Rename") await renameItem(client, source, "report.txt");
    else
      await client[step === "Copy" ? "copy" : "move"](
        source.url,
        target,
        { kind: "preserve-source" },
        confirmationOptions(source),
      );
  } else if (step.endsWith("creation"))
    await client.write(
      target,
      "secret contents",
      { contentType: "text/plain" },
      { kind: step === "owner-only creation" ? "owner-only" : "protect-ancestors" },
    );
  else
    await uploadFile(
      client,
      PRIVATE,
      new Blob(["secret contents"], { type: "text/plain" }),
      "report.txt",
      step === "Keep both" ? "keep-both" : "fail",
    );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({ body: "", none: "*", match: null });
  expect(writes[0]?.receipt).toBeTruthy();
  expect(writes[1]).toMatchObject({
    body: "secret contents",
    none: null,
    match: writes[0]?.receipt,
  });
  expect((await f.anonymous(target)).status).toBe(403);
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(f.exposures).toEqual([]);
});

it.each([
  "file",
  "folder",
])("round 68: shared %s partial Restore compares archived grants after refused Trash DELETE", async (kind) => {
  const f = await rdfPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared contents" });
  const originalPolicy = await aclBody(source, true);
  f.policies.set(`${source}.policy`, originalPolicy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (!entry) throw new Error("Missing recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await f.anonymous(content)).status).toBe(200);
  const result = await restoreItems(client, DRIVE, entries);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.policies.get(`${source}.policy`)).toBe(originalPolicy);
  expect(await (await f.anonymous(content)).text()).toBe("shared contents");
});

it("round 68: a new upload retains the legacy archived file policy installed on its placeholder", async () => {
  const f = await rdfPod();
  const folder = `${PUBLIC}historical/`;
  const target = `${folder}report.txt`;
  await f.pod.fetch(folder, { method: "PUT", body: "" });
  const recovery = `${DRIVE}.trash/00000000-0000-4000-8000-000000000001/historical/`;
  const index = emptyTrashIndex();
  addTrashRecord(index, {
    url: recovery,
    original: folder,
    name: "historical",
    trashedAt: new Date(),
  });
  // Older Trash records predate containerAcls and recover individual own grants
  // from the slot archive. The recreated parent now has public inheritance.
  await f.pod.fetch(`${DRIVE}.trash/index.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serializeTrashIndex(index),
  });
  await f.pod.fetch(new URL("../.access.json", recovery).href, {
    method: "PUT",
    body: JSON.stringify({
      [`${recovery}report.txt`]: {
        resource: target,
        acl: `${target}.policy`,
        turtle: await aclBody(target),
      },
    }),
  });
  f.audit();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await uploadFile(client, folder, new Blob(["secret contents"]), "report.txt");
  expect((await f.anonymous(target)).status).toBe(403);
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(f.exposures).toEqual([]);
});

it.each([
  null,
  'W/"placeholder"',
])("round 68: a placeholder receipt of %s cannot be replaced by a later validator", async (receipt) => {
  const f = await rdfPod();
  const target = `${PRIVATE}report.txt`;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok) {
      if (receipt === null) response.headers.delete("etag");
      else response.headers.set("etag", receipt);
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({
    kind: "missing-validator",
  });
  expect(f.calls.filter(({ url, method }) => url === target && method === "PUT")).toHaveLength(1);
  expect(await (await f.pod.fetch(target)).text()).toBe("");
});

it("round 68: a scoped source change during placeholder creation stops bytes and conditionally removes the empty receipt", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const target = `${PRIVATE}report.txt`;
  const changed = await aclBody(source, true);
  const writes: string[] = [];
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "PUT")
      writes.push(init.body instanceof Blob ? await init.body.text() : String(init.body));
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok)
      f.policies.set(`${source}.policy`, changed);
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.exclusive?.([source, target], async (scoped) => {
      await scoped.bindAccess?.(source, target);
      await uploadFile(scoped, PRIVATE, new Blob(["secret contents"]), "report.txt");
    }),
  ).rejects.toThrow("access policy changed");
  expect(writes).toEqual([""]);
  expect(f.pod.has(target)).toBe(false);
  expect(f.policies.get(`${source}.policy`)).toBe(changed);
});

it("round 68: guarded creation hydrates a Trash index archive before publishing its own placeholder flight", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.prepareTrash(`${DRIVE}.trash/`, { kind: "owner-only", webId: OWNER });
  const target = `${DRIVE}.trash/index.ttl`;
  const index = emptyTrashIndex();
  await client.write(
    target,
    await serializeTrashIndex(index),
    { contentType: "text/turtle", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(await client.readRdf(target)).toBeDefined();
  expect((await f.anonymous(target)).status).toBe(403);
});

it("round 68: placeholder provisioning never replaces an approved If-Match when both preconditions were supplied", async () => {
  const f = await rdfPod();
  const target = `${PRIVATE}report.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      target,
      "secret contents",
      { contentType: "text/plain", ifNoneMatch: "*", ifMatch: '"approved-old-version"' },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ status: 412 });
  expect(f.calls).not.toContainEqual({ url: target, method: "PUT" });
  expect(f.pod.has(target)).toBe(false);
});

it.each([
  "Upload",
  "recovery clearing",
])("round 68: %s hydrates creation receipts before collecting final own-ACL absence guards", async (step) => {
  const f = await rdfPod();
  const target = step === "Upload" ? `${PRIVATE}report.txt` : `${PRIVATE}secret`;
  let placeholder = false;
  let changed = false;
  let replaced = false;
  let cleared = false;
  const backups: string[] = [];
  let foreignEndpoint: string | undefined;
  let foreignPolicy: string | undefined;
  f.after(async (_url, _method, response) => {
    if (response.status === 404) response.headers.delete("link");
    return response;
  });
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (
      !changed &&
      init?.method === "HEAD" &&
      (headers.has("if-match") || headers.has("if-none-match")) &&
      (step === "Upload"
        ? placeholder
        : backups.length === 2 && url === `${new URL(".", backups[0]).href}.policy`)
    ) {
      changed = true;
      const resource = step === "Upload" ? target : (backups[0] as string);
      foreignEndpoint = `${resource}.policy`;
      foreignPolicy = await aclBody(resource, true);
      f.policies.set(foreignEndpoint, foreignPolicy);
    }
    const response = await f.fetch(input, init);
    if (init?.method === "PUT" && response.ok) {
      if (url === target) {
        if (init.body === "") {
          if (step === "Upload") placeholder = true;
          else cleared = true;
        } else if (step === "recovery clearing" && !replaced) {
          replaced = true;
          f.policies.set(`${target}.policy`, await aclBody(target, true));
        }
      }
      if (url.includes("/.drive-recovery-") && /\/[01]-secret$/.test(url) && init.body !== "")
        backups.push(url);
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const selected = step === "recovery clearing" ? await client.stat(target) : undefined;
  if (step === "Upload") f.audit();
  const result = await uploadFile(
    client,
    PRIVATE,
    new Blob([step === "Upload" ? "secret contents" : "replacement"]),
    step === "Upload" ? "report.txt" : "secret",
    step === "Upload" ? "fail" : "replace",
    selected,
  ).catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(result).toBeInstanceOf(Error);
  expect(foreignEndpoint).toBeDefined();
  expect(f.policies.get(foreignEndpoint as string)).toBe(foreignPolicy);
  expect(f.calls).not.toContainEqual({ url: foreignEndpoint, method: "PUT" });
  if (step === "Upload") {
    expect(f.exposures).toEqual([]);
    expect(await (await f.pod.fetch(target)).text()).toBe("");
  } else {
    expect(cleared).toBe(false);
    expect(await (await f.pod.fetch(target)).text()).toBe("replacement");
    expect(result).toMatchObject({ retainedDestinations: expect.arrayContaining(backups) });
    for (const backup of backups) expect(f.pod.has(backup)).toBe(true);
  }
});

it.each(
  [
    "Copy",
    "Move",
    "Rename",
    "Restore",
    "owner-only creation",
    "New folder",
    "folder Copy",
    "folder Move",
  ].flatMap((step) => [true, false].map((hiddenLink) => ({ step, hiddenLink }))),
)("round 68: $step preserves an orphan ACL without publishing bytes or children (404 hides Link: $hiddenLink)", async ({
  step,
  hiddenLink,
}) => {
  const f = await rdfPod();
  const folder = step === "New folder" || step.startsWith("folder");
  const target = `${PRIVATE}report${folder ? "/" : ".txt"}`;
  let source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let restore: (() => Promise<unknown>) | undefined;
  if (step === "Restore") {
    await f.pod.fetch(target, { method: "PUT", body: "secret contents" });
    const trashed = await trashItems(client, DRIVE, [await client.stat(target)], { webId: OWNER });
    expect(trashed.failed).toEqual([]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing recovery");
    source = entry.url;
    restore = async () => {
      const result = await restoreItems(client, DRIVE, entries);
      expect(result.done).toEqual([]);
      return result.failed[0]?.error;
    };
  } else if (folder && step !== "New folder") {
    source = `${PRIVATE}tree/`;
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "secret contents" });
  }
  f.calls.length = 0;
  const foreign = await aclBody(target, true);
  f.policies.set(`${target}.policy`, foreign);
  const writes: string[] = [];
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "PUT")
      writes.push(init.body instanceof Blob ? await init.body.text() : String(init.body));
    return undefined;
  });
  f.after(async (_url, _method, response) => {
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    return response;
  });
  f.audit(folder ? [target] : []);
  const result = await (async () => {
    if (restore) return restore();
    if (step === "New folder") return client.createFolder(target, { kind: "inherit-verified" });
    if (step === "owner-only creation")
      return client.write(
        target,
        "secret contents",
        { contentType: "text/plain", ifNoneMatch: "*" },
        { kind: "owner-only" },
      );
    const selected = await client.stat(source);
    if (step === "Rename") return renameItem(client, selected, "report.txt");
    return client[step.endsWith("Copy") ? "copy" : "move"](
      source,
      target,
      { kind: "preserve-source" },
      confirmationOptions(selected),
    );
  })().catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(writes.every((body) => body === "")).toBe(true);
  expect(f.exposures).toEqual([]);
  expect(f.policies.get(`${target}.policy`)).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: `${target}.policy`, method: "PUT" });
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  expect(f.pod.has(source)).toBe(true);
});
