// AUTHORED-BY Codex

import { parseRdf } from "@jeswr/fetch-rdf";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl } from "../src/apps/drive/lib/client/access";
import { ancestorGuard } from "../src/apps/drive/lib/client/ancestors";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());

it("every exported container-creating client method requires a policy at type and runtime boundaries", async () => {
  const http = vi.fn<typeof fetch>();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  const creators = {
    // @ts-expect-error Container creation requires an explicit policy.
    createFolder: () => client.createFolder(PRIVATE),
    // @ts-expect-error Implicit ancestor creation requires an explicit policy.
    write: () => client.write(`${PRIVATE}upload`, "contents", { contentType: "text/plain" }),
    // @ts-expect-error Recursive copy must explicitly preserve source access.
    copy: () => client.copy(PRIVATE, PUBLIC),
    // @ts-expect-error Move must explicitly preserve access or request confirmation.
    move: () => client.move(PRIVATE, PUBLIC),
    // @ts-expect-error Recovery creation must explicitly preserve source access.
    mergeContainer: () => client.mergeContainer(PRIVATE, PUBLIC),
    // @ts-expect-error Trash provisioning must explicitly require owner-only access.
    prepareTrash: () => client.prepareTrash(PRIVATE),
  };
  const otherMethods = [
    "list",
    "stat",
    "read",
    "readVersion",
    "readRdf",
    "remove",
    "recheckDeletions",
    "exclusive",
  ];
  expect(
    Object.keys(client)
      .filter((key) => typeof client[key as keyof typeof client] === "function")
      .sort(),
  ).toEqual([...Object.keys(creators), ...otherMethods].sort());
  for (const create of Object.values(creators))
    await expect(create()).rejects.toThrow(/Explicit container policy required/);
  const putFolder = vi.fn();
  const provision = ancestorGuard({
    storageUrl: ROOT,
    http,
    access: accessControl(http, ROOT),
    readRdf: client.readRdf,
    putFolder,
    error: () => new Error(),
    owner: () => OWNER,
    deleteVersion: async () => {},
  });
  // @ts-expect-error The internal provisioning flight also has no policy default.
  await expect(provision.folder(PRIVATE)).rejects.toThrow(/Explicit container policy required/);
  // @ts-expect-error Raw container PUT is private.
  expect(client.rawPutFolder).toBeUndefined();
  expect(http).not.toHaveBeenCalled();
  expect(putFolder).not.toHaveBeenCalled();
});

it("invalid policy kinds fail before any request", async () => {
  const http = vi.fn<typeof fetch>();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  // @ts-expect-error An unverified inheritance decision is not a policy.
  await expect(client.createFolder(PRIVATE, { kind: "inherit" })).rejects.toThrow(
    /Explicit container policy required/,
  );
  expect(http).not.toHaveBeenCalled();
});

it("raw metadata writes cannot create a container or recreate one deleted after HEAD", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.write(
      `${PUBLIC}missing/`,
      "",
      { contentType: "text/turtle" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "not-found" });
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "HEAD" && response.ok)
      await f.pod.fetch(PRIVATE, { method: "DELETE" });
    return response;
  });
  // Remove the child first so the simulated concurrent DELETE succeeds.
  await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  await expect(
    client.write(PRIVATE, "", { contentType: "text/turtle" }, { kind: "protect-ancestors" }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(f.pod.has(PRIVATE)).toBe(false);
});

it.each([
  "owner-only",
  "inherit-verified",
] as const)("explicit %s creation uses the provisioning flight", async (kind) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const url = `${PUBLIC}new/`;
  const requirements: unknown[] = [];
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT")
      requirements.push(await protectionLedger(f.fetch).get(url));
    return undefined;
  });
  await client.createFolder(url, { kind });
  expect(requirements).toHaveLength(1);
  expect(Boolean(requirements[0])).toBe(kind === "owner-only");
  expect((await f.anonymous(url)).status).toBe(kind === "owner-only" ? 403 : 200);
});

it.each([
  false,
  true,
])("inheritance is compared to archived original access before creation (original public: %s)", async (publicRead) => {
  const f = await wacPod();
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, publicRead));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).failed,
  ).toEqual([]);
  const beforePut = vi.fn();
  f.intercept(async (url, init) => {
    if (url === PRIVATE && init?.method === "PUT") {
      beforePut();
      expect(Boolean(await protectionLedger(f.fetch).get(PRIVATE))).toBe(!publicRead);
    }
    return undefined;
  });
  await client.createFolder(PRIVATE, { kind: "inherit-verified" });
  expect(beforePut).toHaveBeenCalledOnce();
  expect((await f.anonymous(PRIVATE)).status).toBe(publicRead ? 200 : 403);
});

it("archived creation relocates its original policy and missing owner creation fails before PUT", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PUBLIC}archived/`;
  await client.createFolder(url, {
    kind: "archived",
    from: PRIVATE,
    acl: {
      url: `${PRIVATE}.policy`,
      etag: "",
      dataset: await parseRdf(await aclBody(PRIVATE), "text/turtle"),
    },
  });
  expect((await f.anonymous(url)).status).toBe(403);
  await expect(client.createFolder(`${PUBLIC}no-owner/`, { kind: "owner-only" })).rejects.toThrow();
  expect(f.pod.has(`${PUBLIC}no-owner/`)).toBe(false);
});

it.each([
  false,
  true,
])("partial restore protects creation after a lost DELETE response (hidden Link: %s)", async (hiddenLink) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "DELETE" && response.ok)
      throw new TypeError("DELETE response lost after server committed");
    return response;
  });
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(trashed.failed).toHaveLength(1);
  expect(f.pod.has(PRIVATE)).toBe(false);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial entry");
  expect(entry.status).toBe("partial");
  f.audit([PRIVATE]);
  f.after(async (url, _method, response) => {
    if (hiddenLink && url === PRIVATE) response.headers.delete("link");
    return response;
  });
  const merging = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const merge = client.mergeContainer;
  vi.spyOn(client, "mergeContainer").mockImplementation(async (...args) => {
    merging.resolve();
    await release.promise;
    return merge(...args);
  });
  const requirements: unknown[] = [];
  f.intercept(async (url, init) => {
    if (url === PRIVATE && init?.method === "PUT")
      requirements.push(await protectionLedger(f.fetch).get(PRIVATE));
    if (url === `${PRIVATE}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    return undefined;
  });
  const restoring = restoreItems(client, DRIVE, [entry]);
  await merging.promise;
  const uploaded = await client
    .write(
      `${PRIVATE}upload`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    )
    .then(
      () => true,
      () => false,
    );
  const anonymous = await f.anonymous(`${PRIVATE}upload`);
  release.resolve();
  expect((await restoring).failed).toHaveLength(1);
  expect(uploaded).toBe(false);
  expect(anonymous.status).not.toBe(200);
  expect(f.pod.has(`${PRIVATE}upload`)).toBe(false);
  expect(requirements.length).toBeGreaterThan(0);
  expect(requirements.every(Boolean)).toBe(true);
  expect(f.exposures).toEqual([]);
  expect(f.pod.has(`${entry.url}secret`)).toBe(true);
});

it.each([
  "verified",
  "ACL 503",
  "hidden Link",
])("partial restore records its archive before PUT and holds concurrent uploads through %s", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "DELETE" && response.ok)
      throw new TypeError("Lost DELETE response");
    return response;
  });
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial entry");
  const created = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.after(async (url, method, response) => {
    if (url === PRIVATE) {
      if (mode === "hidden Link") response.headers.delete("link");
      if (method === "PUT") {
        created.resolve();
        await release.promise;
      }
    }
    return response;
  });
  f.intercept(async (url, init) =>
    mode === "ACL 503" && url === `${PRIVATE}.policy` && init?.method === "PUT"
      ? new Response(null, { status: 503 })
      : undefined,
  );
  f.audit([PRIVATE]);
  const restoring = restoreItems(client, DRIVE, [entry]);
  await created.promise;
  const uploading = client.write(
    `${PRIVATE}concurrent`,
    "secret contents",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  const settled = vi.fn();
  void uploading.then(settled, settled);
  const done = Promise.allSettled([restoring, uploading]);
  try {
    expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeDefined();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    expect(f.pod.has(`${PRIVATE}concurrent`)).toBe(false);
  } finally {
    release.resolve();
    await done;
  }
  expect((await done)[1]?.status).toBe(mode === "verified" ? "fulfilled" : "rejected");
  if (mode !== "verified") {
    expect((await restoring).failed).toHaveLength(1);
    const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
    await expect(
      fresh.write(
        `${PRIVATE}retry`,
        "secret contents",
        { contentType: "text/plain" },
        { kind: "protect-ancestors" },
      ),
    ).rejects.toThrow();
    expect(f.pod.has(`${PRIVATE}retry`)).toBe(false);
    expect(Boolean(await protectionLedger(f.fetch).get(PRIVATE))).toBe(mode === "hidden Link");
    expect(f.pod.has(`${entry.url}secret`)).toBe(true);
  } else expect((await f.anonymous(`${PRIVATE}concurrent`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it("metadata writes with supplied validators still refuse a missing folder with retained protection", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await protectionLedger(f.fetch).set(PRIVATE, {
    acl: `${PRIVATE}.policy`,
    from: PRIVATE,
    turtle: await aclBody(PRIVATE),
  });
  f.intercept(async (url, init) =>
    url === PRIVATE && init?.method === "HEAD" ? new Response(null, { status: 404 }) : undefined,
  );
  await expect(
    client.write(
      PRIVATE,
      "",
      { contentType: "text/turtle", ifMatch: '"stale"' },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(f.calls.some(({ url, method }) => url === PRIVATE && method === "PUT")).toBe(false);
  expect(await protectionLedger(f.fetch).get(PRIVATE)).toBeDefined();
});

it("ordinary folder moves retain inheritance when the destination is verified narrower", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${PRIVATE}narrow/`;
  await client.move(PUBLIC, to, { kind: "confirm-move" });
  expect(f.policies.has(`${to}.policy`)).toBe(false);
  expect((await f.anonymous(`${to}placeholder`)).status).toBe(403);
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  expect((await f.anonymous(`${to}placeholder`)).status).toBe(200);
});

it.each([
  false,
  true,
])("confirmed folder widening provisions a policy before creation (unknown source: %s)", async (unknown) => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  const from = `${PRIVATE}nested/`;
  const to = `${PUBLIC}confirmed/`;
  await client.createFolder(from, { kind: "inherit-verified" });
  await client.write(
    `${from}file`,
    "secret contents",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  f.after(async (url, _method, response) => {
    if (unknown && url === from) response.headers.delete("link");
    return response;
  });
  const beforePut = vi.fn();
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "PUT") {
      beforePut();
      expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
    }
    return undefined;
  });
  await client.move(from, to, { kind: "confirm-move" });
  expect(confirmAccess).toHaveBeenCalledWith(expect.objectContaining({ canKeep: !unknown }));
  expect(beforePut).toHaveBeenCalledOnce();
  expect((await f.anonymous(`${to}file`)).status).toBe(200);
});

it("inheritance is rechecked inside the creation flight before omitting its ledger", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const from = `${PRIVATE}nested/`;
  const to = `${PRIVATE}renamed/`;
  await client.createFolder(from, { kind: "inherit-verified" });
  await client.write(
    `${from}file`,
    "secret contents",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  const beforePut = vi.fn();
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "HEAD")
      f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
    if (url === to && init?.method === "PUT") {
      beforePut();
      expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
    }
    return undefined;
  });
  await client.move(from, to, { kind: "confirm-move" });
  expect(beforePut).toHaveBeenCalledOnce();
  expect((await f.anonymous(`${to}file`)).status).toBe(403);
});
