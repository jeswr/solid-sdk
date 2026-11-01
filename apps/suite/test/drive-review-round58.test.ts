// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { createSolidDriveClient, policyArchiveOf } from "../src/apps/drive/lib/client/client";
import {
  copyItem,
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import {
  ACL,
  aclBody,
  DRIVE,
  EVERYONE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
} from "./drive-wac-pod";

async function collidingPolicy(from: string, other: string) {
  const data = await parseRdf(await aclBody(from), "text/turtle");
  const publicRule = new WacFields(`${other}#owner`, data, DataFactory);
  publicRule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  publicRule.iris(`${ACL}accessTo`).add(from);
  publicRule.iris(`${ACL}agentClass`).add(EVERYONE);
  publicRule.iris(`${ACL}mode`).add(`${ACL}Append`);
  return turtle(data);
}

it.each([
  "Copy",
  "Rename",
  "Restore",
])("round 58: %s never merges colliding authorization identifiers", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}${step === "Copy" ? "Copy%20of%20secret" : "renamed"}`;
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  let destination = to;
  if (step === "Restore") {
    await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    const archive = policyArchiveOf(entry.url) as string;
    const saved = JSON.parse(await (await f.pod.fetch(archive)).text());
    // The archived original's two rules collide when first transplanted to recovery.
    saved[entry.url].turtle = await collidingPolicy(from, entry.url);
    await f.pod.fetch(archive, { method: "PUT", body: JSON.stringify(saved) });
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result.failed).toEqual([]);
    destination = from;
  } else {
    f.policies.set(`${from}.policy`, await collidingPolicy(from, to));
    expect((await f.anonymous(from)).status).toBe(403);
    if (step === "Copy") await copyItem(client, await client.stat(from));
    else await renameItem(client, await client.stat(from), "renamed");
  }
  expect(f.pod.has(destination)).toBe(true);
  expect((await f.anonymous(destination)).status).toBe(403);
  const data = await parseRdf(f.policies.get(`${destination}.policy`) as string, "text/turtle");
  const publicRules = [...new AclResource(data, DataFactory).authorizations].filter((rule) =>
    rule.agentClass.has(EVERYONE),
  );
  expect(publicRules).toHaveLength(1);
  expect(publicRules.map((rule) => [...rule.mode])).toEqual([[`${ACL}Append`]]);
  expect(confirmAccess).not.toHaveBeenCalled();
});

it.each([
  "direct merge",
  "partial Restore",
])("round 58: %s retains the placeholder PUT validator through listing", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add("urn:original");
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let recovery = from;
  let destination = `${PRIVATE}merged/`;
  let run: () => Promise<unknown>;
  if (step === "partial Restore") {
    f.intercept(async (url, init) =>
      url === from && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
    );
    await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    recovery = entry.url;
    destination = from;
    await f.pod.fetch(from, { method: "DELETE" });
    run = () => restoreItems(client, DRIVE, [entry]);
  } else run = () => client.mergeContainer(from, destination, { kind: "preserve-source" });
  let created = false;
  let replacement: string | null = null;
  f.after(async (url, method, response) => {
    if (url === destination && method === "PUT" && response.ok) created = true;
    return response;
  });
  f.intercept(async (url, init) => {
    if (created && replacement === null && url === destination && !init?.method) {
      await f.pod.fetch(destination, { method: "PUT", body: "" });
      replacement = (await f.pod.fetch(destination, { method: "HEAD" })).headers.get("etag");
    }
    return undefined;
  });
  const result = await run().catch((error: unknown) => error);
  expect(replacement).not.toBeNull();
  expect(result instanceof Error || !!(result as { failed?: unknown[] }).failed?.length).toBe(true);
  expect((await f.pod.fetch(destination, { method: "HEAD" })).headers.get("etag")).toBe(
    replacement,
  );
  expect(f.pod.has(recovery)).toBe(true);
});

it.each([
  ["file", "own"],
  ["file", "inherited"],
  ["folder", "own"],
  ["folder", "inherited"],
])("round 58: partial Restore keeps unchanged shared %s with %s grants after Trash DELETE 403", async (kind, sharing) => {
  const f = await rdfPod();
  const from = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder") await f.pod.fetch(`${from}child`, { method: "PUT", body: "shared child" });
  const governed = sharing === "own" ? from : PRIVATE;
  f.policies.set(`${governed}.policy`, await aclBody(governed, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    (url === from || url === `${from}child`) && init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  const original = (await f.pod.fetch(from, { method: "HEAD" })).headers.get("etag");
  f.calls.length = 0;
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(from)).status).toBe(200);
  if (kind === "folder")
    expect(await (await f.anonymous(`${from}child`)).text()).toBe("shared child");
  expect(f.pod.has(entry.url)).toBe(false);
  expect((await f.pod.fetch(from, { method: "HEAD" })).headers.get("etag")).toBe(original);
  expect(f.calls).not.toContainEqual({ url: from, method: "PUT" });
});

it.each([
  "Copy",
  "Move",
])("round 58: %s rollback preserves a concurrent ACL when placeholder Link is hidden", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  const acl = `${to}.policy`;
  const foreign = await aclBody(to, true);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let installed = false;
  f.after(async (url, method, response) => {
    if (!installed && url === to && method === "PUT" && response.ok) {
      installed = true;
      response.headers.delete("link");
      f.policies.set(acl, foreign);
    }
    return response;
  });
  await expect(
    step === "Copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(installed).toBe(true);
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.policies.get(acl)).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
  expect(f.calls).not.toContainEqual({ url: acl, method: "PUT" });
});

it("round 58: standalone upload rollback cannot delete an ACL when absent-resource discovery was hidden", async () => {
  const f = await rdfPod();
  const to = `${PRIVATE}upload`;
  const foreign = await aclBody(to, true);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.after(async (url, method, response) => {
    if (url === to && method === "HEAD" && response.status === 404) response.headers.delete("link");
    if (url === to && method === "PUT" && response.ok) f.policies.set(`${to}.policy`, foreign);
    return response;
  });
  await expect(
    client.write(
      to,
      "secret contents",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(f.pod.has(to)).toBe(true);
  expect(f.policies.get(`${to}.policy`)).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it.each([
  "file",
  "empty folder",
  "metadata folder",
])("round 58: partial Restore pins its compared %s survivor before recovery DELETE", async (kind) => {
  const f = await rdfPod();
  const from = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind !== "file") {
    const data = new Store();
    if (kind === "metadata folder")
      new WacFields(from, data, DataFactory).iris("https://example.test/note").add("urn:original");
    await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  }
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === from && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  if (kind !== "file") await f.pod.fetch(from, { method: "DELETE" });
  let reads = 0;
  let replacement: string | null = null;
  f.intercept(async (url, init) => {
    if (
      url === from &&
      !init?.method &&
      ++reads === (kind === "file" ? 1 : kind === "empty folder" ? 2 : 3)
    ) {
      const body = await (await f.pod.fetch(from)).text();
      await f.pod.fetch(from, { method: "PUT", body });
      replacement = (await f.pod.fetch(from, { method: "HEAD" })).headers.get("etag");
    }
    return undefined;
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(replacement).not.toBeNull();
  expect(result.failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect((await f.pod.fetch(from, { method: "HEAD" })).headers.get("etag")).toBe(replacement);
});

it.each([
  "missing",
  "weak",
])("round 58: partial Restore refuses a survivor's %s initial validator", async (kind) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === from && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  f.after(async (url, method, response) => {
    if (url === from && method === "HEAD") {
      if (kind === "missing") response.headers.delete("etag");
      else response.headers.set("etag", 'W/"weak"');
    }
    return response;
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
});

it.each([
  "Copy",
  "mergeContainer",
])("round 58: %s checks its metadata PUT receipt during verification", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`,
    to = `${PRIVATE}copy/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add("urn:original");
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let written = false;
  let replacement: string | null = null;
  f.after(async (url, method, response) => {
    if (
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()).includes("urn:original")
    )
      written = true;
    return response;
  });
  f.intercept(async (url, init) => {
    if (written && !replacement && url === to && !init?.method) {
      const body = await (await f.pod.fetch(to)).text();
      await f.pod.fetch(to, { method: "PUT", body });
      replacement = (await f.pod.fetch(to, { method: "HEAD" })).headers.get("etag");
    }
    return undefined;
  });
  await expect(
    step === "Copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.mergeContainer(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(replacement).not.toBeNull();
  expect(f.pod.has(from)).toBe(true);
  expect((await f.pod.fetch(to, { method: "HEAD" })).headers.get("etag")).toBe(replacement);
});

it("round 58: owner-only overwrite refuses an undiscoverable ACL endpoint", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(from);
  let namespaceHydrated = false;
  f.after(async (url, method, response) => {
    if (url === PUBLIC && method === "GET") namespaceHydrated = true;
    if (namespaceHydrated && url === from && method === "HEAD") response.headers.delete("link");
    return response;
  });
  await expect(
    client.write(
      from,
      "replacement",
      {
        contentType: "text/plain",
        ifMatch: selected.etag as string,
      },
      { kind: "owner-only" },
    ),
  ).rejects.toMatchObject({ cause: "ACL Link unavailable" });
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
});
