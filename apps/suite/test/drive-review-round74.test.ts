// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { driveBootstrapFetch } from "../src/apps/drive/lib/client/bootstrap";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { customAclPod } from "./drive-custom-acl-pod";
import { rdfPod } from "./drive-rdf-pod";
import {
  ACL,
  aclBody,
  DRIVE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
} from "./drive-wac-pod";

it.each([
  "Move",
  "Copy",
  "Rename",
  "tree Move",
  "tree Copy",
])("round 74: %s retains owner-only recovery when public source access is revoked before deletion", async (step) => {
  const f = await customAclPod();
  const tree = step.startsWith("tree");
  const source = `${PUBLIC}source${tree ? "/" : ""}`;
  const content = tree ? `${source}child` : source;
  const destination = step === "Rename" ? PUBLIC : `${DRIVE}other/`;
  const target = `${destination}retained${tree ? "/" : ""}`;
  const payload = tree ? `${target}child` : target;
  await f.pod.fetch(content, { method: "PUT", body: "original public bytes" });
  await f.pod.fetch(destination, { method: "PUT", body: "" });
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
  const revokedPolicy = await aclBody(PUBLIC);
  let revoked = false;
  f.after(async (url, method, response) => {
    if (
      url === payload &&
      method === "PUT" &&
      response.ok &&
      !revoked &&
      (await (await f.pod.fetch(payload)).text()) === "original public bytes"
    ) {
      revoked = true;
      f.policies.set(`${PUBLIC}.policy`, revokedPolicy);
    }
    if (["GET", "HEAD"].includes(method) && url.startsWith(PUBLIC))
      response.headers.set(
        "wac-allow",
        `user="read write control",public="${revoked ? "" : "read"}"`,
      );

    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(source);
  const result = await (step.endsWith("Copy")
    ? client.copy(source, target, { kind: "preserve-source" }, confirmationOptions(selected))
    : client.move(source, target, { kind: "confirm-move" }, confirmationOptions(selected))
  ).catch((error: unknown) => error);
  expect(revoked).toBe(true);
  expect(result).toBeInstanceOf(DrivePartialFailureError);
  expect(f.calls.filter(({ method }) => method === "DELETE")).toEqual([]);
  expect((await f.anonymous(content)).status).toBe(403);
  expect((await f.anonymous(payload)).status).toBe(403);
  expect(await (await f.fetch(payload)).text()).toBe("original public bytes");
  expect((result as DrivePartialFailureError).retainedDestinations).toContain(target);
  expect(f.policies.get(`${PUBLIC}.policy`)).toBe(revokedPolicy);
});

it.each([
  "file",
  "folder",
])("round 74: partial Restore uses archived inherited sharing after refused Trash DELETE of a %s", async (kind) => {
  const f = await customAclPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared original" });
  const shared = await aclBody(PRIVATE, true);
  f.policies.set(`${PRIVATE}.policy`, shared);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(content)).status).toBe(200);
  expect((await f.anonymous(entry.url)).status).toBe(403);
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.policies.get(`${PRIVATE}.policy`)).toBe(shared);
  expect(await (await f.anonymous(content)).text()).toBe("shared original");
});

it.each([
  "Copy",
  "container merge",
])("round 74: %s captures a recovery owner before creating any destination", async (step) => {
  const f = await rdfPod();
  const policy = await parseRdf(await aclBody(ROOT, true), "text/turtle");
  new WacFields(`${ROOT}#owner`, policy, DataFactory).iris(`${ACL}mode`).delete(`${ACL}Control`);
  f.policies.set(`${ROOT}.policy`, await turtle(policy));
  const source = `${PUBLIC}source${step === "Copy" ? "" : "/"}`;
  const destination = `${PUBLIC}destination${step === "Copy" ? "" : "/"}`;
  await f.pod.fetch(source, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    step === "Copy"
      ? client.copy(source, destination, { kind: "preserve-source" })
      : client.mergeContainer(source, destination, { kind: "preserve-source" }),
  ).rejects.toHaveProperty("cause", "Recovery owner unavailable");
  expect(f.calls.filter(({ method }) => ["PUT", "DELETE"].includes(method))).toEqual([]);
});

it("round 74: bootstrap advances approval only from its own conditional write receipts", async () => {
  const f = await rdfPod();
  const http = driveBootstrapFetch(f.fetch, ROOT);
  const url = `${PUBLIC}registration.ttl`;
  expect((await http(url)).status).toBe(404);
  let response = await http(
    new Request(url, { method: "PUT", body: "first", headers: { "if-none-match": "*" } }),
  );
  expect(response.ok).toBe(true);
  const first = response.headers.get("etag") as string;
  // A same-version HEAD cannot replace the creation's captured discovery.
  expect((await http(new URL(url), { method: "HEAD" })).headers.get("etag")).toBe(first);
  response = await http(url, { method: "PUT", body: "second", headers: { "if-match": first } });
  expect(response.ok).toBe(true);
  const second = response.headers.get("etag") as string;
  expect(second).not.toBe(first);
  expect(
    (await http(url, { method: "PUT", body: "third", headers: { "if-match": second } })).ok,
  ).toBe(true);
  expect(await (await f.fetch(url)).text()).toBe("third");
});

it("round 74: evacuation without a captured controller preserves created bytes and a concurrent ACL", async () => {
  const f = await rdfPod();
  const rootPolicy = await parseRdf(await aclBody(ROOT), "text/turtle");
  new WacFields(`${ROOT}#owner`, rootPolicy, DataFactory)
    .iris(`${ACL}mode`)
    .delete(`${ACL}Control`);
  f.policies.set(`${ROOT}.policy`, await turtle(rootPolicy));
  const url = `${PUBLIC}created`;
  const foreign = await aclBody(url, true);
  let changed = false;
  f.after(async (target, method, response) => {
    if (
      !changed &&
      target === url &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(url)).text()) === "created bytes"
    ) {
      changed = true;
      f.policies.set(`${url}.policy`, foreign);
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.write(
      url,
      "created bytes",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toHaveProperty("cause", "Recovery owner unavailable");
  expect(changed).toBe(true);
  expect(f.policies.get(`${url}.policy`)).toBe(foreign);
  expect(await (await f.pod.fetch(url)).text()).toBe("created bytes");
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
  expect(f.calls).not.toContainEqual({ url: `${url}.policy`, method: "PUT" });
});

it("round 74: bootstrap refuses a fresher validator after a conditional write is refused", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  await f.pod.fetch(url, { method: "PUT", body: "confirmed" });
  const http = driveBootstrapFetch(f.fetch, ROOT);
  const first = (await http(url)).headers.get("etag") as string;
  let replaced = false;
  const replacement = "another client's registration";
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT" && !replaced) {
      replaced = true;
      await f.pod.fetch(url, { method: "PUT", body: replacement });
      return new Response(null, { status: 412 });
    }
    return undefined;
  });
  expect(
    (await http(url, { method: "PUT", body: "ours", headers: { "if-match": first } })).status,
  ).toBe(412);
  const later = (await http(url)).headers.get("etag") as string;
  expect(later).not.toBe(first);
  await expect(
    http(url, { method: "PUT", body: "retry", headers: { "if-match": later } }),
  ).rejects.toThrow("Refresh and confirm again");
  expect(await (await f.fetch(url)).text()).toBe(replacement);
  expect(
    f.calls.filter(({ url: target, method }) => target === url && method === "PUT"),
  ).toHaveLength(1);
});

it("round 74: bootstrap never replaces the first document capture before its first write", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  await f.pod.fetch(url, { method: "PUT", body: "confirmed" });
  const http = driveBootstrapFetch(f.fetch, ROOT);
  const first = (await http(url)).headers.get("etag");
  await f.pod.fetch(url, { method: "PUT", body: "foreign replacement" });
  const second = (await http(url)).headers.get("etag") as string;
  expect(second).not.toBe(first);
  await expect(
    http(url, { method: "PUT", body: "ours", headers: { "if-match": second } }),
  ).rejects.toThrow("Refresh and confirm again");
  expect(await (await f.fetch(url)).text()).toBe("foreign replacement");
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
});

it("round 74: an unreadable bootstrap document is never recorded as absent", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  f.intercept(async (target) => (target === url ? new Response(null, { status: 503 }) : undefined));
  const http = driveBootstrapFetch(f.fetch, ROOT);
  expect((await http(url)).status).toBe(503);
  f.intercept(undefined);
  expect(
    (await http(url, { method: "PUT", headers: { "if-none-match": "*" }, body: "new" })).ok,
  ).toBe(true);
});

it.each([
  "endpoint",
  "modes",
])("round 74: bootstrap retains the first %s discovery for an identical validator", async (change) => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  await f.pod.fetch(url, { method: "PUT", body: "confirmed" });
  let reads = 0;
  f.after(async (target, method, response) => {
    if (target === url && (method === "GET" || method === "HEAD")) {
      if (method === "GET") reads++;
      if (change === "modes")
        response.headers.set(
          "wac-allow",
          reads === 1 ? 'user="read write control",public=""' : 'user="read",public=""',
        );
      else if (reads > 1) response.headers.set("link", `<${url}foreign.policy>; rel="acl"`);
    }
    return response;
  });
  const http = driveBootstrapFetch(f.fetch, ROOT);
  const first = (await http(url)).headers.get("etag") as string;
  expect((await http(url)).headers.get("etag")).toBe(first);
  await expect(
    http(url, { method: "PUT", body: "ours", headers: { "if-match": first } }),
  ).rejects.toThrow("access policy changed");
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
});

it("round 74: bootstrap refuses unconfirmed or unconditional overwrites", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  await f.pod.fetch(url, { method: "PUT", body: "original" });
  const etag = (await f.fetch(url, { method: "HEAD" })).headers.get("etag") as string;
  await expect(
    driveBootstrapFetch(f.fetch, ROOT)(url, {
      method: "PUT",
      body: "ours",
      headers: { "if-match": etag },
    }),
  ).rejects.toThrow("could not be confirmed");
  await expect(
    driveBootstrapFetch(f.fetch, ROOT)(url, { method: "PUT", body: "ours" }),
  ).rejects.toHaveProperty("status", 428);
  f.after(async (target, method, response) => {
    if (target === url && method === "GET") response.headers.delete("etag");
    return response;
  });
  const http = driveBootstrapFetch(f.fetch, ROOT);
  expect((await http(url)).headers.has("etag")).toBe(false);
  await expect(
    http(url, { method: "PUT", body: "ours", headers: { "if-match": etag } }),
  ).rejects.toThrow("could not be confirmed");
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
});

it("round 74: a weak bootstrap read cannot authorize an overwrite", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}registration.ttl`;
  await f.pod.fetch(url, { method: "PUT", body: "original" });
  f.after(async (target, method, response) => {
    if (target === url && method === "GET") response.headers.set("etag", 'W/"weak"');
    return response;
  });
  const http = driveBootstrapFetch(f.fetch, ROOT);
  expect((await http(url)).headers.get("etag")).toBe('W/"weak"');
  await expect(
    http(url, { method: "PUT", body: "ours", headers: { "if-match": 'W/"weak"' } }),
  ).rejects.toThrow("could not be confirmed");
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
});
