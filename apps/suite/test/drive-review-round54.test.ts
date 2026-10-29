// AUTHORED-BY Codex
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { containerData } from "../src/apps/drive/lib/client/rdf";
import {
  deleteForever,
  listTrash,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());

it("round 54: partial Restore never adopts a recovery root replaced before descendant inspection", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${source}child` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === entry.url && method === "GET" && response.ok) {
      replaced = true;
      await f.pod.fetch(`${url}child`, { method: "PUT", body: "secret contents" });
    }
    return response;
  });
  f.calls.length = 0;
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(replaced).toBe(true);
  expect(f.pod.has(`${entry.url}child`)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: `${entry.url}child`, method: "DELETE" });
});

it.each([
  "own",
  "inherited",
])("round 54: partial Restore compares an unchanged shared original against its archived %s policy", async (sharing) => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const shared = sharing === "own" ? source : PRIVATE;
  f.policies.set(`${shared}.policy`, await aclBody(shared, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === source && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await f.anonymous(source)).text()).toBe("secret contents");
  expect(f.pod.has(entry.url)).toBe(false);
});

it.each([
  "policy archive",
  "recovery receipt",
])("round 54: %s retains owner-only protection when its slot becomes public", async (kind) => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let removed = false;
  f.after(async (url, method, response) => {
    if (url === source && method === "DELETE" && response.ok) removed = true;
    return response;
  });
  let target: string | undefined;
  f.intercept(async (url, init) => {
    if (
      kind === "recovery receipt" &&
      removed &&
      url === `${DRIVE}.trash/index.ttl` &&
      init?.method === "PUT"
    )
      return new Response(null, { status: 403 });
    if (
      !target &&
      (init?.method ?? "GET") === "HEAD" &&
      url.endsWith(kind === "policy archive" ? ".access.json" : "partial.ttl")
    ) {
      target = url;
      const slot = new URL(".", url).href;
      f.policies.set(`${slot}.policy`, await aclBody(slot, true));
    }
    return undefined;
  });
  const result = await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  expect(result.done.length + result.failed.length).toBe(1);
  expect(target).toBeDefined();
  expect((await f.anonymous(target as string)).status).toBe(403);
});

it.each([
  false,
  true,
])("round 54: replacement rollback protects old bytes before replay (hidden Link: %s)", async (hideLink) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  const exposed: string[] = [];
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) {
      if (!uploaded) {
        uploaded = true;
        f.policies.set(`${url}.policy`, await aclBody(url, true));
      }
      const anonymous = await f.anonymous(url);
      if (anonymous.ok) exposed.push(await anonymous.text());
    }
    if (uploaded && hideLink && target === url) response.headers.delete("link");
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(uploaded).toBe(true);
  expect(exposed).not.toContain("secret contents");
  const anonymous = await f.anonymous(url);
  expect(anonymous.ok && (await anonymous.text()) === "secret contents").toBe(false);
  if (!hideLink) expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
});

it.each([
  "widened defaults",
  "public index ACL",
])("round 54: Trash index retains owner-only access with %s", async (mode) => {
  const f = await rdfPod();
  const trash = `${DRIVE}.trash/`;
  const index = `${trash}index.ttl`;
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  if (mode === "public index ACL") {
    await f.pod.fetch(index, {
      method: "PUT",
      body: "",
      headers: { "content-type": "text/turtle" },
    });
    f.policies.set(`${index}.policy`, await aclBody(index, true));
  }
  let widened = false;
  f.intercept(async (target, init) => {
    if (!widened && target === url && init?.method === "HEAD") {
      widened = true;
      if (mode === "widened defaults")
        f.policies.set(`${trash}.policy`, await aclBody(trash, true));
    }
    return undefined;
  });
  const result = await trashItems(client, DRIVE, [{ url, name: "secret", kind: "file" }], {
    webId: OWNER,
  });
  expect(result.failed).toEqual([]);
  expect((await f.anonymous(index)).status).toBe(403);
});

it.each([
  "recursive remove",
  "Delete forever",
  "Empty Trash",
  "recursive move",
])("round 54: %s rejects a root replaced after the captured listing and before descendant inspection", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let root = `${PRIVATE}tree/`;
  await f.pod.fetch(`${root}child`, { method: "PUT", body: "confirmed" });
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (step === "Delete forever" || step === "Empty Trash") {
    await trashItems(client, DRIVE, [await client.stat(root)], { webId: OWNER });
    [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    root = entry.url;
  }
  const selected = await client.stat(root);
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === root && method === "GET" && response.ok) {
      replaced = true;
      await f.pod.fetch(`${root}child`, { method: "DELETE" });
      await f.pod.fetch(root, { method: "DELETE" });
      await f.pod.fetch(`${root}child`, { method: "PUT", body: "unconfirmed replacement" });
    }
    return response;
  });
  f.calls.length = 0;
  const result = await (step === "recursive move"
    ? client.move(
        root,
        `${PRIVATE}moved/`,
        { kind: "preserve-source" },
        { ifMatch: selected.etag as string },
      )
    : entry
      ? deleteForever(client, DRIVE, [entry])
      : client.remove(root, { recursive: true, ifMatch: selected.etag as string })
  ).catch((error: unknown) => error);
  expect(replaced).toBe(true);
  if (result && typeof result === "object" && "failed" in result)
    expect(result.failed).toHaveLength(1);
  else expect(result).toBeInstanceOf(Error);
  expect(await (await f.pod.fetch(`${root}child`)).text()).toBe("unconfirmed replacement");
  expect(f.calls).not.toContainEqual({ url: `${root}child`, method: "DELETE" });
});

it.each([
  "rollback cleanup",
  "metadata undo",
])("round 54: %s cannot use descendant mutation as permission to adopt a replacement container", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}source/`;
  const to = `${PRIVATE}destination/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add(`${ROOT}statement`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  if (step === "metadata undo") await f.pod.fetch(to, { method: "PUT", body: "" });
  else await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const merged =
    step === "metadata undo"
      ? await client.mergeContainer(from, to, { kind: "preserve-source" })
      : undefined;
  if (merged)
    await client.write(
      `${to}child`,
      "ours",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    );
  let rollingBack = !!merged;
  let replaced = false;
  f.after(async (url, method, response) => {
    if (
      !merged &&
      !rollingBack &&
      url === `${to}child` &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(url)).text()) === "secret contents"
    ) {
      rollingBack = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
    }
    return response;
  });
  f.intercept(async (url, init) => {
    if (rollingBack && !replaced && url === to && (init?.method ?? "GET") === "GET") {
      replaced = true;
      const graph = containerData((await client.readRdf(from))?.dataset as Store, from);
      const current = await f.pod.fetch(to);
      const body = await current.text();
      if (f.pod.has(`${to}child`)) await f.pod.fetch(`${to}child`, { method: "DELETE" });
      await f.pod.fetch(to, { method: "DELETE" });
      await f.pod.fetch(to, { method: "PUT", body });
      expect(graph.size).toBeGreaterThan(0);
    }
    return undefined;
  });
  f.calls.length = 0;
  if (merged) {
    f.policies.set(`${to}.policy`, await aclBody(to, true));
    await expect(merged.recheck()).rejects.toThrow();
  } else await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
  if (merged) expect(await (await f.pod.fetch(to)).text()).toContain("statement");
});

it("round 54: partial Restore retains a recovery container recreated after its last child restores", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`;
  await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${from}child` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  let restored = false;
  let replaced = false;
  f.after(async (url, method, response) => {
    if (url === `${entry.url}child` && method === "DELETE" && response.ok) restored = true;
    return response;
  });
  f.intercept(async (url, init) => {
    if (restored && !replaced && url === entry.url && (init?.method ?? "GET") === "GET") {
      replaced = true;
      const current = await f.pod.fetch(url);
      await f.pod.fetch(url, { method: "DELETE" });
      await f.pod.fetch(url, { method: "PUT", body: await current.text() });
    }
    return undefined;
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(replaced).toBe(true);
  expect(result.failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(await (await f.pod.fetch(`${from}child`)).text()).toBe("secret contents");
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});
