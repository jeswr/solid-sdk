// AUTHORED-BY Codex

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

// Reuse the installed workspace fixture without adding a dependency.
const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

it.each([
  "verified",
  "missing Link",
  "missing owner",
])("private-folder access verification remains fail closed: %s", async (mode) => {
  const f = await wacPod();
  f.after(async (url, _method, response) => {
    if (mode === "missing Link" && url === PRIVATE) response.headers.delete("link");
    return response;
  });
  const result = accessControl(f.fetch, ROOT).privateFolder(
    PRIVATE,
    mode === "missing owner" ? undefined : OWNER,
  );
  if (mode === "verified") await result;
  else await expect(result).rejects.toThrow();
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
});

it("an explicit creation queued behind restore runs after its flight and reports a safe conflict", async () => {
  const { f, client, entry } = await trashedFolder();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      reached.resolve();
      await release.promise;
    }
    return undefined;
  });
  const restoring = restoreItems(client, DRIVE, [entry]);
  await reached.promise;
  const creating = client.createFolder(PRIVATE, { kind: "inherit-verified" });
  const settled = vi.fn();
  void creating.then(settled, settled);
  try {
    await turn();
    expect(settled).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await Promise.allSettled([restoring, creating]);
  }
  await expect(creating).rejects.toMatchObject({ kind: "conflict", status: 412 });
  expect((await restoring).failed).toEqual([]);
  expect(f.exposures).toEqual([]);
});

it.each([
  "upload without owner",
  "new folder",
  "copy",
  "different copy",
])("successful cleanup clears protection and recreation makes a fresh policy decision: %s", async (operation) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { f, client, entry } = await trashedFolder();
  f.intercept(async (url, init) =>
    url === `${PRIVATE}.policy` && init?.method === "PUT"
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(
    operation.includes("copy")
      ? client.copy(entry.url, PRIVATE, { kind: "preserve-source" })
      : client.write(
          `${PRIVATE}first`,
          "secret contents",
          { contentType: "text/plain" },
          { kind: "protect-ancestors" },
        ),
  ).rejects.toThrow();
  expect(f.pod.has(PRIVATE)).toBe(false);
  expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
  f.intercept(undefined);
  if (operation === "new folder") await client.createFolder(PRIVATE, { kind: "inherit-verified" });
  else if (operation === "copy") await client.copy(entry.url, PRIVATE, { kind: "preserve-source" });
  else if (operation === "different copy") {
    await expect(client.copy(PUBLIC, PRIVATE, { kind: "preserve-source" })).rejects.toThrow();
    expect(f.pod.has(PRIVATE)).toBe(false);
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
  } else {
    const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
    await fresh.write(
      `${PRIVATE}retry`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    );
  }
  if (operation !== "different copy") {
    expect((await f.anonymous(PRIVATE)).status).toBe(403);
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
  }
  expect(f.exposures).toEqual([]);
});

it.each([
  "metadata",
  "missing metadata target",
  "existing folder",
])("the write gate checks a container's own retained requirement: %s", async (operation) => {
  const { f, client } = await trashedFolder();
  f.intercept(async (url, init) =>
    (url === `${PRIVATE}.policy` && init?.method === "PUT") ||
    (url === PRIVATE && init?.method === "DELETE")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(
    client.write(
      `${PRIVATE}first`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  f.intercept(undefined);
  if (operation === "missing metadata target") {
    await f.pod.fetch(PRIVATE, { method: "DELETE" });
    await expect(
      client.write(PRIVATE, "", { contentType: "text/turtle" }, { kind: "protect-ancestors" }),
    ).rejects.toThrow();
  } else if (operation === "existing folder") {
    await expect(client.createFolder(PRIVATE, { kind: "inherit-verified" })).rejects.toMatchObject({
      kind: "conflict",
      status: 412,
    });
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
    expect((await f.anonymous(PRIVATE)).status).toBe(403);
  } else {
    await client.write(PRIVATE, "", { contentType: "text/turtle" }, { kind: "protect-ancestors" });
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
    expect((await f.anonymous(PRIVATE)).status).toBe(403);
  }
  expect(f.exposures).toEqual([]);
});

it("checks protection requirements on the storage root before writing descendants", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await protectionLedger(f.fetch).set(ROOT, {
    acl: `${ROOT}.policy`,
    from: ROOT,
    turtle: await aclBody(ROOT),
  });
  f.audit();
  await expect(
    client.write(
      `${PUBLIC}upload`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(f.pod.has(`${PUBLIC}upload`)).toBe(false);
  expect(f.exposures).toEqual([]);
});

it("every Drive payload PUT/POST/PATCH is sent through guardedWrite", () => {
  const directory = new URL("../src/apps/drive/lib/client/", import.meta.url);
  const mutations: string[] = [];
  for (const name of readdirSync(directory)) {
    // ACL writes have their own conditional store-and-verify protocol in access.ts.
    if (!name.endsWith(".ts") || name === "access.ts") continue;
    const source = ts.createSourceFile(
      name,
      readFileSync(new URL(name, directory), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === "method" &&
        ts.isStringLiteral(node.initializer) &&
        ["PUT", "POST", "PATCH"].includes(node.initializer.text)
      ) {
        let enclosing: ts.Node = node;
        while (!ts.isCallExpression(enclosing)) enclosing = enclosing.parent;
        expect(enclosing.expression.getText(source), `${name}: ${node.getText(source)}`).toBe(
          "guardedWrite",
        );
        mutations.push(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(mutations).toEqual(["PUT", "PUT"]);
});
async function trashedFolder() {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const entry = result.done[0];
  if (!entry) throw new Error("Folder was not trashed");
  f.audit([PRIVATE]);
  f.calls.length = 0;
  return { f, client, entry };
}

it("commits protection before container creation and retains it until ACL verification", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { f, client } = await trashedFolder();
  const ledger = protectionLedger(f.fetch);
  const beforeCreate = vi.fn();
  const beforeVerify = vi.fn();
  f.intercept(async (url, init) => {
    if (url === PRIVATE && init?.method === "PUT") {
      expect(await ledger.get(PRIVATE)).toBeDefined();
      beforeCreate();
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === `${PRIVATE}.policy` && method === "GET" && response.ok) {
      expect(await ledger.get(PRIVATE)).toBeDefined();
      beforeVerify();
    }
    return response;
  });
  await client.write(
    `${PRIVATE}upload`,
    "secret contents",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  expect(beforeCreate).toHaveBeenCalledOnce();
  expect(beforeVerify).toHaveBeenCalledOnce();
  expect(await ledger.get(PRIVATE)).toBeUndefined();
  expect(f.exposures).toEqual([]);
});

it.each([
  "matching",
  "wider",
  "demo",
])("retry re-verifies a surviving policy instead of trusting existence: %s", async (mode) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { f, client } = await trashedFolder();
  f.intercept(async (url, init) => {
    if (
      (url === PRIVATE && init?.method === "DELETE") ||
      (url === `${PRIVATE}.policy` && (init?.method ?? "GET") === "GET" && f.policies.has(url))
    )
      return new Response(null, { status: 503 });
    return undefined;
  });
  await expect(
    client.write(
      `${PRIVATE}first`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(f.pod.has(PRIVATE)).toBe(true);
  f.intercept(undefined);
  if (mode === "wider") f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  if (mode === "demo")
    f.after(async (url, _method, response) => {
      if (url === PRIVATE) response.headers.set("x-solid-demo-access-control", "none");
      return response;
    });
  f.calls.length = 0;
  const retry = client.write(
    `${PRIVATE}retry`,
    "secret contents",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  if (mode === "matching") {
    await retry;
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeUndefined();
    expect(
      f.calls.filter(({ url, method }) => url === `${PRIVATE}.policy` && method === "PUT"),
    ).toEqual([]);
    expect((await f.anonymous(`${PRIVATE}retry`)).status).toBe(403);
  } else {
    await expect(retry).rejects.toThrow(/folder still requires protection/);
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeDefined();
    expect(f.pod.has(`${PRIVATE}retry`)).toBe(false);
  }
  expect(f.exposures).toEqual([]);
});

it.each([
  false,
  true,
])("folder restore coordinates uploads through its pending ACL (503: %s)", async (fail) => {
  const { f, client, entry } = await trashedFolder();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      reached.resolve();
      await release.promise;
      if (fail) return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const restoring = restoreItems(client, DRIVE, [entry]);
  await reached.promise;
  const uploading = client.write(
    `${PRIVATE}upload`,
    "secret contents",
    {
      contentType: "text/plain",
    },
    { kind: "protect-ancestors" },
  );
  const settled = vi.fn();
  void uploading.then(settled, settled);
  const done = Promise.allSettled([restoring, uploading]);
  try {
    await turn();
    expect(settled).not.toHaveBeenCalled();
    expect(f.pod.has(`${PRIVATE}upload`)).toBe(false);
    expect(f.exposures).toEqual([]);
  } finally {
    release.resolve();
    await done;
  }
  // A concurrent new member can make restore's final membership check conflict;
  // either outcome must keep the upload behind the verified policy.
  if (fail) expect((await restoring).failed).toHaveLength(1);
  expect((await done)[1]?.status).toBe(fail ? "rejected" : "fulfilled");
  expect(f.exposures).toEqual([]);
  if (!fail) expect((await f.anonymous(`${PRIVATE}upload`)).status).toBe(403);
});

it.each([
  "hidden headers",
  "ACL and cleanup failure",
])("failed protection survives reload and gates retries: %s", async (mode) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { f, client } = await trashedFolder();
  f.intercept(async (url, init) => {
    if (
      mode === "ACL and cleanup failure" &&
      ((url === `${PRIVATE}.policy` && init?.method === "PUT") ||
        (url === PRIVATE && init?.method === "DELETE"))
    )
      return new Response(null, { status: 503 });
    return undefined;
  });
  f.after(async (url, _method, response) => {
    if (mode === "hidden headers" && url === PRIVATE) {
      response.headers.delete("link");
      response.headers.delete("etag");
    }
    return response;
  });
  const upload = (c: ReturnType<typeof createSolidDriveClient>, name: string) =>
    c.write(
      `${PRIVATE}${name}`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    );
  await expect(upload(client, "first")).rejects.toThrow();
  expect(f.pod.has(PRIVATE)).toBe(true);
  // A fresh module registry models a reload: only IndexedDB and the pod survive.
  vi.resetModules();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  const reloaded = create({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(upload(reloaded, "retry")).rejects.toThrow(/could not be established or verified/);
  expect(f.pod.has(`${PRIVATE}retry`)).toBe(false);
  expect(f.exposures).toEqual([]);
  f.intercept(undefined);
  f.after(undefined);
  await upload(reloaded, "repaired");
  expect((await f.anonymous(`${PRIVATE}repaired`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});
