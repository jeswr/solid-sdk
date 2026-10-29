// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { afterEach, expect, it, vi } from "vitest";
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
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
} from "./drive-wac-pod";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  "copy",
  "rename",
])("round 57: %s materializes only the source's applicable ACL grants", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PRIVATE}${step === "copy" ? "Copy%20of%20secret" : "renamed"}`;
  const source = await parseRdf(await aclBody(from), "text/turtle");
  source.addQuads([...(await parseRdf(await aclBody(to, true), "text/turtle"))]);
  f.policies.set(`${from}.policy`, await turtle(source));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  expect((await f.anonymous(from)).status).toBe(403);
  const selected = await client.stat(from);
  if (step === "copy") await copyItem(client, selected);
  else await renameItem(client, selected, "renamed");
  expect(f.pod.has(to)).toBe(true);
  expect((await f.anonymous(to)).status).toBe(403);
});
it.each([
  "copy",
  "rename",
])("round 57: %s stops on an inherited destination revocation", async (step) => {
  const f = await rdfPod();
  const from = `${PUBLIC}placeholder`,
    to = `${PUBLIC}${step === "copy" ? "Copy%20of%20placeholder" : "renamed"}`;
  f.policies.set(`${from}.policy`, await aclBody(from, true));
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let revoked = false;
  f.after(async (url, method, response) => {
    if (!revoked && url === to && method === "PUT" && response.ok) {
      revoked = true;
      f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
    }
    return response;
  });
  const selected = await client.stat(from);
  await expect(
    step === "copy" ? copyItem(client, selected) : renameItem(client, selected, "renamed"),
  ).rejects.toThrow();
  expect(revoked).toBe(true);
  expect(f.calls).not.toContainEqual({ url: `${to}.policy`, method: "PUT" });
  expect(f.pod.has(from)).toBe(true);
  expect((await f.anonymous(to)).status).toBe(403);
});
it.each([
  "complete",
  "partial",
])("round 57: %s Restore pins its preflight policy archive", async (mode) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  if (mode === "partial")
    f.intercept(async (url, init) =>
      url === from && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
    );
  await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  if (mode === "partial") await f.pod.fetch(from, { method: "DELETE" });
  const archive = policyArchiveOf(entry.url) as string;
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === archive && method === "GET" && response.ok) {
      replaced = true;
      const replacement = JSON.parse(await response.clone().text());
      replacement[entry.url].turtle = await aclBody(from, true);
      await f.pod.fetch(archive, { method: "PUT", body: JSON.stringify(replacement) });
    }
    return response;
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(replaced).toBe(true);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect((await f.anonymous(from)).status).not.toBe(200);
});
it("round 57: provisioning cleanup checks ACL ownership after pending.add", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`,
    acl = `${to}.policy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const foreign = await aclBody(to, true);
  let verified = false,
    failed = false,
    replaced = false;
  f.after(async (url, method, response) => {
    if (url === acl && method === "GET" && response.ok) verified = true;
    return response;
  });
  f.intercept(async (url, init) => {
    if (verified && !failed && url === to && init?.method === "HEAD") {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (typeof key === "string" && key.startsWith("delete-request:") && value.source === to) {
      replaced = true;
      f.policies.set(acl, foreign);
    }
    return put.call(this, value, key);
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(f.policies.get(acl)).toBe(foreign);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});
it("round 57: ACL verification never adopts an equivalent replacement validator", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`,
    acl = `${to}.policy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let replacement: string | undefined;
  f.after(async (url, method, response) => {
    if (url === acl && method === "PUT" && response.ok) {
      replacement = `${f.policies.get(acl)}\n# concurrently reserialized\n`;
      f.policies.set(acl, replacement);
    }
    return response;
  });
  f.intercept(async (url, init) =>
    url === to && init?.method === "PUT" && new Headers(init.headers).has("if-match")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(replacement).toBeDefined();
  expect(f.policies.get(acl)).toBe(replacement);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});
it.each([
  "copy",
  "move",
])("round 57: %s never clears its last original bytes when quarantine backup disappears", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let copied = false,
    removed = false;
  f.after(async (url, method, response) => {
    if (
      !copied &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      copied = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      await f.pod.fetch(from, { method: "PUT", body: "edited source" });
    }
    if (
      url.includes("/.drive-recovery-") &&
      !url.endsWith("/") &&
      !url.endsWith(".policy") &&
      method === "PUT" &&
      response.ok
    ) {
      removed = true;
      await f.pod.fetch(url, { method: "DELETE" });
    }
    return response;
  });
  await expect(
    step === "copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(removed).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
});

it.each([
  "file",
  "folder",
])("round 57: %s ACL transfer preserves principal identities and ignores foreign defaults", async (kind) => {
  const f = await rdfPod();
  const from = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  const to = kind === "file" ? `${PUBLIC}copy` : `${PUBLIC}copy/`;
  if (kind === "folder")
    await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const data = await parseRdf(await aclBody(from), "text/turtle");
  const grant = new WacFields(`${from}#guest`, data, DataFactory);
  grant.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  grant.iris(`${ACL}accessTo`).add(from);
  grant.iris(`${ACL}agent`).add(`${from}#person`);
  grant.iris(`${ACL}origin`).add(`${from}#origin`);
  grant.iris(`${ACL}mode`).add(`${ACL}Read`);
  const foreign = new WacFields(`${from}#foreign`, data, DataFactory);
  foreign.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  foreign.iris(`${ACL}defaultForNew`).add(to);
  foreign.iris(`${ACL}agentClass`).add("http://xmlns.com/foaf/0.1/Agent");
  foreign.iris(`${ACL}mode`).add(`${ACL}Read`);
  f.policies.set(`${from}.policy`, await turtle(data));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.copy(from, to, { kind: "preserve-source" });
  const saved = await parseRdf(f.policies.get(`${to}.policy`) as string, "text/turtle");
  const rule = new WacFields(`${to}#guest`, saved, DataFactory);
  expect([...rule.iris(`${ACL}agent`)]).toEqual([`${from}#person`]);
  expect([...rule.iris(`${ACL}origin`)]).toEqual([`${from}#origin`]);
  expect((await f.anonymous(to)).status).toBe(403);
  if (kind === "folder") expect((await f.anonymous(`${to}child`)).status).toBe(403);
});

it.each([
  "own",
  "inherited",
])("round 57: partial Restore compares a shared original against archived %s grants", async (sharing) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  f.policies.set(
    `${sharing === "own" ? from : PRIVATE}.policy`,
    await aclBody(sharing === "own" ? from : PRIVATE, true),
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === from && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  f.calls.length = 0;
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await f.anonymous(from)).text()).toBe("secret contents");
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.calls).not.toContainEqual({ url: from, method: "PUT" });
});

it.each([
  "default",
  "defaultForNew",
])("round 57: folder copies preserve distinct listing and descendant grants (%s)", async (predicate) => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`,
    to = `${PUBLIC}copy/`;
  await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const data = await parseRdf(await aclBody(from, true), "text/turtle");
  new WacFields(`${from}#public`, data, DataFactory).iris(`${ACL}default`).delete(from);
  const ownerRule = new WacFields(`${from}#owner`, data, DataFactory);
  ownerRule.iris(`${ACL}default`).delete(from);
  ownerRule.iris(`${ACL}${predicate}`).add(from);
  f.policies.set(`${from}.policy`, await turtle(data));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.copy(from, to, { kind: "preserve-source" });
  expect((await f.anonymous(to)).status).toBe(200);
  expect((await f.anonymous(`${to}child`)).status).toBe(403);
});

it("round 57: quarantine never adopts a backup ACL installed during ledger hydration", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let copied = false;
  let backup: string | undefined;
  let backupPublic = "";
  f.after(async (url, method, response) => {
    if (
      !copied &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      copied = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      await f.pod.fetch(from, { method: "PUT", body: "edited source" });
    }
    if (
      url.includes("/.drive-recovery-") &&
      !url.endsWith("/") &&
      !url.endsWith(".policy") &&
      method === "PUT" &&
      response.ok
    ) {
      backup = url;
      backupPublic = await aclBody(url, true);
    }
    return response;
  });
  const get = IDBObjectStore.prototype.get;
  let changed = false;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (!changed && backup && key === to) {
      changed = true;
      f.policies.set(`${backup}.policy`, backupPublic);
    }
    return get.call(this, key);
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(changed).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
});
