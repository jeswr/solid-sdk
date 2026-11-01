// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, privateAcl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { commitHttp } from "../src/apps/drive/lib/client/commit";
import {
  deleteForever,
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

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

const steps = [
  "replace upload",
  "ACL overwrite",
  "source DELETE",
  "move",
  "rename",
  "Trash",
  "Restore",
  "partial Restore",
  "recovery DELETE",
  "Delete forever",
  "Empty Trash",
  "container merge",
] as const;

it.each(
  steps,
)("round 57 shape a: %s keeps the selected validator through preflight", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let target = `${PRIVATE}secret`;
  let run: () => Promise<unknown>;
  if (
    ["Restore", "partial Restore", "recovery DELETE", "Delete forever", "Empty Trash"].includes(
      step,
    )
  ) {
    if (step === "partial Restore" || step === "recovery DELETE")
      f.intercept(async (url, init) =>
        url === target && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [await client.stat(target)], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    target = entry.url;
    run = () =>
      step === "Delete forever" || step === "Empty Trash"
        ? deleteForever(client, DRIVE, [entry])
        : restoreItems(client, DRIVE, [entry]);
  } else if (step === "ACL overwrite") {
    const access = accessControl(f.fetch, ROOT);
    const endpoint = `${PRIVATE}.policy`;
    const original = await access.read(endpoint);
    if (original.status !== "known") throw new Error("Missing ACL");
    const etag = (await client.stat(PRIVATE)).etag as string;
    target = endpoint;
    run = () =>
      access.install(original.policy, PRIVATE, PRIVATE, {
        identity: { url: PRIVATE, etag },
        expectedAcl: original.policy,
      });
  } else if (step === "container merge") {
    target = PRIVATE;
    const selected = await client.stat(target);
    run = () =>
      client.mergeContainer(
        target,
        `${DRIVE}merged/`,
        { kind: "preserve-source" },
        { ifMatch: selected.etag as string },
      );
  } else {
    const selected = await client.stat(target);
    run = () => {
      switch (step) {
        case "replace upload":
          return uploadFile(
            client,
            PRIVATE,
            new Blob(["replacement"]),
            "secret",
            "replace",
            selected,
          );
        case "source DELETE":
          return client.remove(target, { ifMatch: selected.etag as string });
        case "move":
          return client.move(
            target,
            `${DRIVE}moved`,
            { kind: "preserve-source" },
            { ifMatch: selected.etag as string },
          );
        case "rename":
          return renameItem(client, selected, "renamed");
        case "Trash":
          return trashItems(client, DRIVE, [selected], { webId: OWNER });
        default:
          throw new Error("Unexpected step");
      }
    };
  }
  if (target.endsWith(".policy"))
    f.policies.set(target, `${f.policies.get(target)}\n# replacement`);
  else
    await f.pod.fetch(target, {
      method: "PUT",
      body: target.endsWith("/") ? "" : "concurrent contents",
    });
  f.calls.length = 0;
  const result = await run().catch((error: unknown) => error);
  expect(result instanceof Error || (result as { failed: unknown[] }).failed.length > 0).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  expect(f.calls).not.toContainEqual({ url: target, method: "PUT" });
});

// Exercise each operation over real IndexedDB, then inspect every mutation boundary,
// including its ACL writes, metadata writes and recovery housekeeping.
it.each(
  steps,
)("round 57 shape b: %s sends every destructive request directly after its HTTP checks", async (step) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const events: { url: string; method: string; headers: Headers }[] = [];
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    events.push({ url: String(key), method: "IDB", headers: new Headers() });
    return put.call(this, value, key);
  });
  for (const method of ["get", "getAllKeys", "delete"] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
      this: IDBObjectStore,
      key?: IDBValidKey | IDBKeyRange | null,
    ) {
      events.push({ url: String(key), method: "IDB", headers: new Headers() });
      return Reflect.apply(original, this, [key]);
    });
  }
  const http: typeof fetch = (input, init) => {
    events.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return f.fetch(input, init);
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const source = `${PRIVATE}secret`;
  const selected = await client.stat(source);
  if (
    ["Restore", "partial Restore", "recovery DELETE", "Delete forever", "Empty Trash"].includes(
      step,
    )
  ) {
    if (step === "partial Restore" || step === "recovery DELETE")
      f.intercept(async (url, init) =>
        url === source && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [selected], { webId: OWNER });
    f.intercept(undefined);
    const entries = await listTrash(client, DRIVE);
    events.length = 0;
    const result =
      step === "Delete forever" || step === "Empty Trash"
        ? await deleteForever(client, DRIVE, entries)
        : await restoreItems(client, DRIVE, entries);
    expect(result.failed).toEqual([]);
  } else {
    events.length = 0;
    switch (step) {
      case "replace upload":
        await uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected);
        break;
      case "ACL overwrite":
        await accessControl(http, ROOT).store(`${PRIVATE}.policy`, privateAcl(PRIVATE, OWNER));
        break;
      case "source DELETE":
        await client.remove(source, { ifMatch: selected.etag as string });
        break;
      case "move":
        await client.move(source, `${PRIVATE}moved`, { kind: "preserve-source" });
        break;
      case "rename":
        await renameItem(client, selected, "renamed");
        break;
      case "Trash":
        expect((await trashItems(client, DRIVE, [selected], { webId: OWNER })).failed).toEqual([]);
        break;
      case "container merge": {
        const data = new Store();
        new WacFields(PRIVATE, data, DataFactory)
          .iris("https://example.test/note")
          .add("urn:original");
        await f.pod.fetch(PRIVATE, { method: "PUT", body: await turtle(data) });
        await client.mergeContainer(PRIVATE, `${DRIVE}merged/`, { kind: "preserve-source" });
        break;
      }
    }
  }
  const mutations = events.flatMap((event, index) =>
    event.method === "DELETE" ||
    (event.method === "PUT" && (event.headers.has("if-match") || event.url.endsWith(".policy")))
      ? [{ event, prior: events[index - 1] }]
      : [],
  );
  expect(mutations.length).toBeGreaterThan(0);
  for (const { event, prior } of mutations) {
    expect(event.headers.has("if-match") || event.headers.get("if-none-match") === "*").toBe(true);
    expect(prior?.method).toBe("HEAD");
    expect(prior?.headers.has("if-match")).toBe(true);
    if (event.url === prior?.url)
      expect(prior.headers.get("if-match")).toBe(event.headers.get("if-match"));
  }
});

it.each([
  404, 410, 200, 304, 503,
])("round 57: captured ACL absence is checked over HTTP (%s)", async (status) => {
  const methods: string[] = [];
  const http: typeof fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return new Response(null, {
      status: methods.length === 1 ? status : 200,
      headers: { etag: '"captured"' },
    });
  };
  const run = commitHttp({
    verifyHeaders: () => undefined,
    http,
    url: PRIVATE,
    init: { method: "DELETE", headers: { "if-match": '"captured"' } },
    policyGuards: [{ url: `${PRIVATE}.policy`, etag: null }],
    error: (code) => new Error(String(code)),
    response: async () => {},
  });
  if (status === 404 || status === 410) {
    await run;
    expect(methods).toEqual(["HEAD", "HEAD", "DELETE"]);
  } else {
    await expect(run).rejects.toThrow(status === 503 ? "503" : "412");
    expect(methods).toEqual(["HEAD"]);
  }
});

it.each([
  "missing",
  "weak",
])("round 57: ACL installation requires its own strong PUT receipt (%s)", async (validator) => {
  const f = await rdfPod();
  const endpoint = `${PRIVATE}.policy`;
  f.after(async (url, method, response) => {
    if (url === endpoint && method === "PUT" && response.ok) {
      if (validator === "missing") response.headers.delete("etag");
      else response.headers.set("etag", 'W/"weak"');
    }
    return response;
  });
  await expect(
    accessControl(f.fetch, ROOT).store(endpoint, privateAcl(PRIVATE, OWNER)),
  ).rejects.toMatchObject({ cause: "Missing policy PUT validator" });
});

it("round 57: compensation never adopts a concurrently restricted ACL as its own receipt", async () => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const original = await access.read(`${PRIVATE}.policy`);
  if (original.status !== "known") throw new Error("Missing ACL");
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const selected = await client.stat(PRIVATE);
  f.policies.set(original.policy.url, `${f.policies.get(original.policy.url)}\n# another writer`);
  await expect(
    access.install(original.policy, PRIVATE, PRIVATE, {
      identity: { url: PRIVATE, etag: selected.etag as string },
      expectedAcl: original.policy,
      restrict: true,
    }),
  ).rejects.toThrow();
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
});

it.each([
  "PUT",
  "DELETE",
])("round 57: standalone conditional %s also uses the final HTTP check", async (method) => {
  const methods: string[] = [];
  await commitHttp({
    verifyHeaders: () => undefined,
    http: async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return new Response(null, { headers: { etag: '"captured"' } });
    },
    url: PRIVATE,
    init: { method, headers: { "if-match": '"captured"' } },
    error: (status) => new Error(String(status)),
    response: async () => {},
  });
  expect(methods).toEqual(["HEAD", method]);
});

it.each([
  "present",
  "absent",
  "unavailable",
  "missing validator",
])("round 57: direct recovery APIs capture and pin their archive (%s)", async (state) => {
  const f = await rdfPod();
  const trash = `${DRIVE}.trash/`;
  const from = `${trash}12345678-1234-1234-1234-123456789012/secret`;
  const to = `${PRIVATE}copy`;
  const archive = `${trash}12345678-1234-1234-1234-123456789012/.access.json`;
  await f.pod.fetch(from, { method: "PUT", body: "secret contents" });
  f.policies.set(`${trash}.policy`, await aclBody(trash));
  if (state !== "absent")
    await f.pod.fetch(archive, {
      method: "PUT",
      body: JSON.stringify({
        [from]: { resource: from, acl: `${from}.policy`, turtle: await aclBody(from) },
      }),
    });
  f.intercept(async (url) =>
    url === archive && state === "unavailable" ? new Response(null, { status: 503 }) : undefined,
  );
  f.after(async (url, method, response) => {
    if (url === archive && method === "GET" && state === "missing validator")
      response.headers.delete("etag");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const run = client.copy(from, to, { kind: "preserve-source" });
  if (state === "present" || state === "absent") {
    await run;
    expect((await f.anonymous(to)).status).toBe(403);
  } else {
    await expect(run).rejects.toThrow();
    expect(f.pod.has(to)).toBe(false);
  }
});

it.each([
  false,
  true,
])("round 57: explicit policy guards survive deletion persistence (recursive: %s)", async (recursive) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const target = recursive ? PRIVATE : `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const selected = await client.stat(target);
  const policy = await accessControl(f.fetch, ROOT).read(`${PRIVATE}.policy`);
  if (policy.status !== "known") throw new Error("Missing policy");
  const foreign = await aclBody(PRIVATE, true);
  const put = IDBObjectStore.prototype.put;
  let changed = false;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (typeof key === "string" && key.startsWith("delete-request:")) {
      changed = true;
      f.policies.set(policy.policy.url, foreign);
    }
    return put.call(this, value, key);
  });
  await expect(
    client.remove(target, {
      recursive,
      ifMatch: selected.etag as string,
      commit: { policyGuards: [policy.policy] },
    }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
  expect(f.calls.some(({ method }) => method === "DELETE")).toBe(false);
  expect(f.policies.get(policy.policy.url)).toBe(foreign);
});

it("round 57: ACL verification checks grants even when the server repeats the PUT validator", async () => {
  const f = await rdfPod();
  const endpoint = `${PRIVATE}.policy`;
  let saved = false;
  f.after(async (url, method, response) => {
    if (url === endpoint && method === "PUT" && response.ok) saved = true;
    if (saved && url === endpoint && method === "GET" && response.ok)
      return new Response(await aclBody(PRIVATE, true), { headers: response.headers });
    return response;
  });
  await expect(
    accessControl(f.fetch, ROOT).store(endpoint, privateAcl(PRIVATE, OWNER)),
  ).rejects.toMatchObject({ cause: "Policy verification failed" });
});
