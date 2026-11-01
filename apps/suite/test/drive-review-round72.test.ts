// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { accessControl, accessLabel } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { customAclPod } from "./drive-custom-acl-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT } from "./drive-wac-pod";

it("round 72 fixture: creating the absent custom sibling ACL revokes owner Read and Control", async () => {
  const f = await customAclPod();
  const secret = `${PRIVATE}secret`;
  const endpoint = `${PRIVATE}secret-policy.ttl`;
  f.endpoints.set(secret, endpoint);
  expect((await f.fetch(secret)).status).toBe(200);
  expect(
    (await f.fetch(endpoint, { method: "PUT", headers: { "if-none-match": "*" }, body: "" }))
      .status,
  ).toBe(201);
  expect((await f.fetch(secret)).status).toBe(403);
  expect((await f.fetch(endpoint)).status).toBe(403);
});

it.each(
  [
    "Upload",
    "Keep both",
    "write",
    "owner-only write",
    "unconditional write",
    "prepareTrash",
    "mergeContainer",
    "Copy",
    "Rename",
    "folder",
    "nested write",
    "tree Copy",
    "tree Move",
  ].flatMap((step) => [false, true].map((hiddenLink) => ({ step, hiddenLink }))),
)("round 72/73: $step discovers absent custom sibling ACLs before any content mutation (hidden Link: $hiddenLink)", async ({
  step,
  hiddenLink,
}) => {
  const f = await customAclPod();
  const secret = `${PRIVATE}secret`;
  const targetFolder = step.startsWith("tree") ? `${PRIVATE}target/` : PRIVATE;
  const folderTarget = ["folder", "prepareTrash", "mergeContainer"].includes(step);
  const endpoint = `${targetFolder}secret-policy.ttl${folderTarget ? "/" : ""}`;
  f.endpoints.set(secret, endpoint);
  if (hiddenLink)
    f.after(async (url, method, response) => {
      if (url === secret && method === "HEAD") response.headers.delete("link");
      return response;
    });
  const source = `${PRIVATE}notes.ttl`;
  await f.pod.fetch(source, { method: "PUT", body: "" });
  if (step === "mergeContainer") await f.pod.fetch(`${PRIVATE}merge/`, { method: "PUT", body: "" });
  if (step.startsWith("tree"))
    await f.pod.fetch(`${PRIVATE}source/secret-policy.ttl`, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.list(PRIVATE);
  const selected = await client.stat(source);
  f.calls.length = 0;
  const run = () => {
    if (step === "Upload" || step === "Keep both")
      return uploadFile(
        client,
        PRIVATE,
        new Blob([""], { type: "text/turtle" }),
        "secret-policy.ttl",
        step === "Upload" ? "fail" : "keep-both",
      );
    if (step === "Copy") return client.copy(source, endpoint, { kind: "preserve-source" });
    if (step === "Rename") return renameItem(client, selected, "secret-policy.ttl");
    if (step === "folder") return client.createFolder(endpoint, { kind: "inherit-verified" });
    if (step === "prepareTrash")
      return client.prepareTrash(endpoint, { kind: "owner-only", webId: OWNER });
    if (step === "mergeContainer")
      return client.mergeContainer(`${PRIVATE}merge/`, endpoint, { kind: "preserve-source" });
    if (step === "tree Copy")
      return client.copy(`${PRIVATE}source/`, targetFolder, { kind: "preserve-source" });
    if (step === "tree Move")
      return client.move(`${PRIVATE}source/`, targetFolder, { kind: "preserve-source" });
    return client.write(
      step === "nested write" ? `${endpoint}/child` : endpoint,
      "",
      {
        contentType: "text/turtle",
        ...(step === "unconditional write" ? {} : { ifNoneMatch: "*" as const }),
      },
      step === "owner-only write"
        ? { kind: "owner-only", webId: OWNER }
        : { kind: "protect-ancestors" },
    );
  };
  await expect(run()).rejects.toThrow(
    hiddenLink ? "Drive could not discover" : "access-control resource",
  );
  expect(f.calls.filter(({ method }) => ["PUT", "PATCH", "DELETE"].includes(method))).toEqual([]);
  expect((await f.fetch(secret)).status).toBe(200);
  expect((await f.fetch(endpoint)).status).toBe(404);
  expect(await (await f.fetch(secret)).text()).toBe("secret contents");
});

it.each([
  "Replace",
  "owner-only Replace",
  "Delete",
  "Move",
])("round 72: %s discovers an existing custom ACL without opening its protected resource", async (step) => {
  const f = await customAclPod();
  const secret = `${PRIVATE}secret`;
  const endpoint = `${PRIVATE}secret-policy.ttl`;
  f.endpoints.set(secret, endpoint);
  const original = await aclBody(secret);
  f.policies.set(`${secret}.policy`, original);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(endpoint);
  f.calls.length = 0;
  const run = () =>
    step.endsWith("Replace")
      ? client.write(
          endpoint,
          "",
          { contentType: "text/turtle", ...confirmationOptions(selected) },
          step === "owner-only Replace"
            ? { kind: "owner-only", webId: OWNER }
            : { kind: "protect-ancestors" },
        )
      : step === "Delete"
        ? client.remove(endpoint, confirmationOptions(selected))
        : client.move(
            endpoint,
            `${PRIVATE}other.ttl`,
            { kind: "preserve-source" },
            confirmationOptions(selected),
          );
  await expect(run()).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.policies.get(`${secret}.policy`)).toBe(original);
});

it.each([
  "WAC",
  "ACP",
])("round 72: namespace discovery blocks an encoded custom %s endpoint advertised from another subtree", async (model) => {
  const f = await customAclPod();
  const protectedUrl = `${ROOT}elsewhere/deep/secret`;
  const endpoint = `${PRIVATE}hidden-policy.ttl`;
  await f.pod.fetch(protectedUrl, { method: "PUT", body: "other contents" });
  f.endpoints.set(protectedUrl, endpoint);
  if (model === "ACP")
    f.after(async (url, method, response) => {
      if (url === protectedUrl && method === "HEAD")
        response.headers.set(
          "link",
          `<${endpoint}>; rel="http://www.w3.org/ns/solid/acp#accessControl"`,
        );
      return response;
    });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      `${PRIVATE}%68idden-policy.ttl`,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect((await f.fetch(protectedUrl)).status).toBe(200);
});

it.each([
  "root denied",
  "listing denied",
  "child denied",
  "child vanished",
  "pagination",
  "unquoted pagination",
  "multiple relations",
  "ambiguous discovery",
])("round 72: incomplete namespace discovery (%s) stops all content mutation", async (failure) => {
  const f = await customAclPod();
  f.intercept(async (url, init) => {
    if (failure === "root denied" && url === ROOT && init?.method === "HEAD")
      return new Response(null, { status: 403 });
    if (failure === "listing denied" && url === PRIVATE && !init?.method)
      return new Response(null, { status: 403 });
    if (
      ["child denied", "child vanished"].includes(failure) &&
      url === `${PRIVATE}secret` &&
      init?.method === "HEAD"
    )
      return new Response(null, { status: failure === "child vanished" ? 404 : 403 });
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (
      ["pagination", "unquoted pagination", "multiple relations"].includes(failure) &&
      url === ROOT &&
      method === "GET"
    )
      response.headers.append(
        "link",
        `<${ROOT}?page=2>; rel=${failure === "unquoted pagination" ? "next" : failure === "multiple relations" ? '"prev next"' : '"next"'}`,
      );
    if (failure === "ambiguous discovery" && url === `${PRIVATE}secret` && method === "HEAD")
      response.headers.append("link", `<${ROOT}second>; rel="acl"`);
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      `${PRIVATE}safe.txt`,
      "safe",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("Drive could not discover");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
});

it("round 72: a completed prior write cannot cache away a newly advertised custom ACL", async () => {
  const f = await customAclPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.after(async (url, method, response) => {
    if (url === ROOT && method === "GET") response.headers.append("link", `<${ROOT}unrelated>`);
    return response;
  });
  await client.write(
    `${PRIVATE}first.txt`,
    "first",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  const endpoint = `${PRIVATE}later-policy.ttl`;
  f.endpoints.set(`${PRIVATE}secret`, endpoint);
  f.calls.length = 0;
  await expect(
    client.write(
      endpoint,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
});

it.each([
  "overwrite",
  "remove",
  "move",
])("round 72: namespace hydration cannot replace the confirmed %s validator", async (step) => {
  const f = await customAclPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const source = `${PRIVATE}secret`;
  const selected = await client.stat(source);
  let replaced = false;
  f.after(async (url, method, response) => {
    if (url === ROOT && method === "GET" && !replaced) {
      replaced = true;
      await f.pod.fetch(source, { method: "PUT", body: "another client's contents" });
    }
    return response;
  });
  const run = () =>
    step === "overwrite"
      ? client.write(
          source,
          "replacement",
          { contentType: "text/plain", ...confirmationOptions(selected) },
          { kind: "protect-ancestors" },
        )
      : step === "remove"
        ? client.remove(source, confirmationOptions(selected))
        : client.move(
            source,
            `${PRIVATE}moved`,
            { kind: "preserve-source" },
            confirmationOptions(selected),
          );
  await expect(run()).rejects.toThrow("conflict");
  expect(replaced).toBe(true);
  expect(await (await f.pod.fetch(source)).text()).toBe("another client's contents");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
});

it.each(
  ["file", "folder"].flatMap((kind) => [403, 412].map((status) => ({ kind, status }))),
)("round 72: partial Restore compares the archived shared original ($kind, Trash DELETE $status)", async ({
  kind,
  status,
}) => {
  const f = await customAclPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared contents" });
  const original = await aclBody(PRIVATE, true);
  f.policies.set(`${PRIVATE}.policy`, original);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (!entry) throw new Error("Missing private recovery");
  expect(entry.status).toBe("partial");
  const access = accessControl(f.fetch, ROOT);
  expect(accessLabel(await access.effective(entry.url), entry.url, OWNER)).toBe("Only you");
  const result = await restoreItems(client, DRIVE, entries);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.policies.get(`${PRIVATE}.policy`)).toBe(original);
  expect(accessLabel(await access.effective(source), source, OWNER)).toBe("Anyone with the link");
  expect(await (await client.read(content)).text()).toBe("shared contents");
});

it("round 72: bootstrap cannot mint the Drive root at another resource's absent custom ACL", async () => {
  const f = await customAclPod();
  const secret = `${ROOT}bootstrap-secret`;
  await f.pod.fetch(secret, { method: "PUT", body: "bootstrap secret" });
  const index = `${ROOT}index.ttl`;
  await f.pod.fetch(index, { method: "PUT", headers: { "content-type": "text/turtle" }, body: "" });
  f.endpoints.set(secret, `${ROOT}drive/`);
  const { ensureDriveRoot } = await import("../src/apps/drive/lib/model/root");
  await ensureDriveRoot(f.fetch, { storageUrl: ROOT, typeIndexUrl: index }).catch(() => undefined);
  expect(f.calls.filter(({ method }) => ["PUT", "PATCH", "DELETE"].includes(method))).toEqual([]);
  expect((await f.fetch(secret)).status).toBe(200);
});

it("round 72: bootstrap resume discovers a newly advertised custom ACL before recreating its root", async () => {
  const f = await customAclPod();
  // Start with an empty storage namespace, retaining the real owner-enforcing WAC.
  for (const [url] of f.pod.snapshot().resources) await f.pod.fetch(url, { method: "DELETE" });
  for (const [url] of [...f.pod.snapshot().containers].sort(([a], [b]) => b.length - a.length))
    if (url !== ROOT) await f.pod.fetch(url, { method: "DELETE" });
  const secret = `${ROOT}resume-secret`;
  await f.pod.fetch(secret, { method: "PUT", body: "resume secret" });
  const index = `${ROOT}index.ttl`;
  await f.pod.fetch(index, { method: "PUT", headers: { "content-type": "text/turtle" }, body: "" });
  const { DriveRootInitializationError, ensureDriveRoot } = await import(
    "../src/apps/drive/lib/model/root"
  );
  const failure = await ensureDriveRoot(f.fetch, { storageUrl: ROOT, typeIndexUrl: index }).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(DriveRootInitializationError);
  if (!(failure instanceof DriveRootInitializationError)) throw new Error("Missing resume handle");
  f.endpoints.set(secret, `${ROOT}drive/`);
  f.calls.length = 0;
  await expect(failure.resume()).rejects.toThrow("Drive could not discover");
  expect(f.calls.filter(({ method }) => ["PUT", "PATCH", "DELETE"].includes(method))).toEqual([]);
  expect((await f.fetch(secret)).status).toBe(200);
});

it.each([
  { ancestor: PRIVATE, status: 403 },
  { ancestor: ROOT, status: 404 },
])("round 72: ancestor rejection after namespace hydration stops writes ($ancestor $status)", async ({
  ancestor,
  status,
}) => {
  const f = await customAclPod();
  let hydrated = false;
  f.after(async (url, method, response) => {
    if (url === PUBLIC && method === "GET") hydrated = true;
    return response;
  });
  f.intercept(async (url, init) =>
    hydrated && url === ancestor && init?.method === "HEAD"
      ? new Response(null, { status })
      : undefined,
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      `${ancestor}new.txt`,
      "private contents",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ cause: "Ancestor could not be checked" });
  expect(hydrated).toBe(true);
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
});

it.each([
  "read",
  "overwrite",
])("round 72: unavailable durable protection refuses %s before any repair or payload", async (step) => {
  const f = await customAclPod();
  const source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(source);
  await protectionLedger(f.fetch).set(source, {
    acl: `${PRIVATE}.acl`,
    from: PRIVATE,
    turtle: await aclBody(PRIVATE),
    etag: selected.etag as string,
  });
  let hydrated = step === "read";
  f.after(async (url, method, response) => {
    if (url === PUBLIC && method === "GET") hydrated = true;
    return response;
  });
  f.intercept(async (url, init) =>
    hydrated && url === source && init?.method === "HEAD"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  f.calls.length = 0;
  const run = () =>
    step === "read"
      ? client.read(source)
      : client.write(
          source,
          "replacement",
          { contentType: "text/plain", ...confirmationOptions(selected) },
          { kind: "protect-ancestors" },
        );
  await expect(run()).rejects.toMatchObject({
    cause: { cause: "Required resource is unavailable" },
  });
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.calls).not.toContainEqual({ url: source, method: "GET" });
  expect(await (await f.pod.fetch(source)).text()).toBe("secret contents");
});
