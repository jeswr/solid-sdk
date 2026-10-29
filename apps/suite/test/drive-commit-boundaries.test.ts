// AUTHORED-BY Codex

import { createRequire } from "node:module";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, privateAcl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { Compensation } from "../src/apps/drive/lib/client/commit";
import { nonWacPod } from "./drive-non-wac-pod";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, OWNER, PRIVATE, ROOT, turtle, WacFields, wacPod } from "./drive-wac-pod";

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

it("merge rollback retains recovered RDF when its recovery graph disappears before destination DELETE", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const predicate = "https://example.test/recovered";
  const object = `${ROOT}statement`;
  const data = new Store();
  new WacFields(PRIVATE, data, DataFactory).iris(predicate).add(object);
  await f.pod.fetch(PRIVATE, { method: "PUT", body: await turtle(data) });
  const to = `${PRIVATE}merged/`;
  const merged = await client.mergeContainer(PRIVATE, to, { kind: "preserve-source" });
  await f.pod.fetch(PRIVATE, { method: "PUT", body: "" });
  f.policies.set(`${to}.policy`, await aclBody(to, true));
  await expect(merged.recheck()).rejects.toMatchObject({ kind: "private-access-unavailable" });
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
  const survivor = await client.readRdf(to);
  if (!survivor) throw new Error("Missing merged survivor");
  expect([...new WacFields(to, survivor.dataset, DataFactory).iris(predicate)]).toEqual([object]);
  const recovery = await client.readRdf(PRIVATE);
  if (!recovery) throw new Error("Missing recovery container");
  expect(new WacFields(PRIVATE, recovery.dataset, DataFactory).iris(predicate).size).toBe(0);
});

it.each([
  "succeeds",
  "fails",
])("removing an already missing resource retires its scoped access binding when bookkeeping %s", async (bookkeeping) => {
  if (bookkeeping === "fails") vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PRIVATE}secret`;
  if (!client.exclusive) throw new Error("Missing scoped client support");
  await client.exclusive([url], async (scoped) => {
    const binding = await scoped.bindAccess?.(url, url);
    if (!binding) throw new Error("Missing scoped access binding");
    await f.pod.fetch(url, { method: "DELETE" });
    if (bookkeeping === "fails") {
      const remove = IDBObjectStore.prototype.delete;
      vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
        this: IDBObjectStore,
        key,
      ) {
        if (key === url) throw new Error("Deletion bookkeeping failed");
        return remove.call(this, key);
      });
      await expect(scoped.remove(url)).rejects.toMatchObject({
        cause: new Error("Deletion bookkeeping failed"),
      });
    } else await scoped.remove(url);
    f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
    await expect(binding.recheck()).resolves.toBeUndefined();
  });
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
  expect(f.pod.has(url)).toBe(false);
});

it.each([
  "commits",
  "fails identity",
])("recursive deletion disarms its root compensation only when the root %s", async (outcome) => {
  const pod = nonWacPod("ACP", ROOT, `${PRIVATE}secret`);
  const undo = vi.fn(async () => {});
  const compensation = new Compensation(undo);
  compensation.arm();
  const disarm = vi.spyOn(compensation, "disarm");
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === PRIVATE && init?.method === "HEAD" && new Headers(init.headers).has("if-match")) {
      // Removing a child is not the commit that makes the root's undo unsafe.
      expect(pod.has(`${PRIVATE}secret`)).toBe(false);
      expect(disarm).not.toHaveBeenCalled();
      if (outcome === "fails identity") return new Response(null, { status: 412 });
    }
    return pod.fetch(input, init);
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  const remove = client.remove(PRIVATE, { recursive: true, commit: { disarm: [compensation] } });
  if (outcome === "commits") await remove;
  else await expect(remove).rejects.toMatchObject({ cause: { status: 412, url: PRIVATE } });
  expect(disarm).toHaveBeenCalledTimes(outcome === "commits" ? 1 : 0);
  await compensation.rollback();
  expect(undo).toHaveBeenCalledTimes(outcome === "commits" ? 0 : 1);
  expect(pod.has(PRIVATE)).toBe(outcome !== "commits");
  expect(pod.calls.some(({ url }) => /\.(acl|acr)$/.test(url))).toBe(false);
});

it.each([
  "changed policy",
  "ignored precondition",
  "missing validator",
  "unreadable policy",
])("ACL overwrite stops at its final identity check with %s", async (failure) => {
  const f = await wacPod();
  const policy = `${PRIVATE}.policy`;
  const original = f.policies.get(policy);
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const http: typeof fetch = (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return f.fetch(input, init);
  };
  f.intercept(async (url, init) => {
    if (url !== policy || init?.method !== "HEAD") return undefined;
    return new Response(null, {
      status: failure === "changed policy" ? 412 : failure === "unreadable policy" ? 403 : 200,
      ...(failure === "ignored precondition" ? { headers: { etag: '"foreign"' } } : {}),
    });
  });
  await expect(
    accessControl(http, ROOT).store(policy, privateAcl(PRIVATE, OWNER)),
  ).rejects.toMatchObject({
    kind: "private-access-unavailable",
    cause: failure === "unreadable policy" ? 403 : 412,
  });
  expect(requests.map(({ method }) => method)).toEqual(["GET", "HEAD"]);
  expect(requests[1]?.headers.get("if-match")).toBe(JSON.stringify(original));
  expect(f.policies.get(policy)).toBe(original);
});

it.each([
  404, 410,
])("overwrite refuses to recreate a resource missing at its final identity check (%s)", async (status) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PRIVATE}secret`;
  const selected = await client.stat(url);
  if (!selected.etag) throw new Error("Missing selected validator");
  f.intercept(async (target, init) =>
    target === url && init?.method === "HEAD" && new Headers(init.headers).has("if-match")
      ? new Response(null, { status })
      : undefined,
  );
  await expect(
    client.write(
      url,
      "replacement",
      { contentType: "text/plain", ifMatch: selected.etag },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "conflict", status: 412, url });
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
});
