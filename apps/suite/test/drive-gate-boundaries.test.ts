// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
import { deletionControl } from "../src/apps/drive/lib/client/deletion";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

it.each([
  "create-existing",
  "replace-missing",
  "replace-changed",
])("owner-only writes preserve data and ACLs when their approved identity conflicts: %s", async (condition) => {
  const f = await wacPod();
  const url = `${PRIVATE}${condition === "replace-missing" ? "missing" : "secret"}`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const policies = [...f.policies];
  await expect(
    client.write(
      url,
      "private index",
      {
        contentType: "text/plain",
        ...(condition === "create-existing"
          ? { ifNoneMatch: "*" as const }
          : { ifMatch: '"approved"' }),
      },
      { kind: "owner-only" },
    ),
  ).rejects.toMatchObject({ kind: "conflict", status: 412, url });
  expect([...f.policies]).toEqual(policies);
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
  expect(await (await f.pod.fetch(`${PRIVATE}secret`)).text()).toBe("secret contents");
});

it("owner-only creation stops on an unavailable initial HEAD before changing access or sending data", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}index`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (target, init) =>
    target === url && init?.method === "HEAD" ? new Response(null, { status: 503 }) : undefined,
  );
  await expect(
    client.write(
      url,
      "confidential index",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "owner-only" },
    ),
  ).rejects.toMatchObject({ status: 503, url });
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
  expect(f.pod.has(url)).toBe(false);
});

it("owner-only creation keeps an empty protected placeholder when its PUT has no validator", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}index`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) response.headers.delete("etag");
    return response;
  });
  await expect(
    client.write(
      url,
      "confidential index",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "owner-only" },
    ),
  ).rejects.toMatchObject({ kind: "private-access-unavailable" });
  expect(
    f.calls.filter(({ url: target, method }) => target === url && method === "PUT"),
  ).toHaveLength(1);
  expect(await (await f.pod.fetch(url)).text()).toBe("");
  expect((await f.anonymous(url)).status).toBe(403);
});

it.each([
  "before",
  "after",
])("owner-only payload rechecks required access independently of the binding %s PUT", async (timing) => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let previousRead = false;
  let uploaded = false;
  let widened = false;
  let bindingReads = 0;
  f.after(async (target, method, response) => {
    if (target === url && method === "GET") previousRead = true;
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    if (
      !widened &&
      target === `${url}.policy` &&
      method === "GET" &&
      response.ok &&
      (timing === "before" ? previousRead && !uploaded : uploaded) &&
      ++bindingReads === 2
    ) {
      widened = true;
      f.policies.set(`${url}.policy`, await aclBody(url, true));
    }
    return response;
  });
  if (timing === "after") f.audit();
  await expect(
    client.write(
      url,
      "new index",
      {
        contentType: "text/plain",
        ifMatch: (await client.stat(url)).etag as string,
      },
      { kind: "owner-only" },
    ),
  ).rejects.toMatchObject({
    kind: "private-access-unavailable",
    cause: "Owner-only protection changed",
  });
  expect(widened).toBe(true);
  expect(uploaded).toBe(timing === "after");
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
  if (uploaded) expect((await f.anonymous(url)).status).toBe(403);
  else expect(f.calls).not.toContainEqual({ url, method: "PUT" });
  expect(f.exposures).toEqual([]);
});

it("replacement rollback stops if protection widens again after its ACL PUT verifies", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  let reprotected = false;
  let widenedAgain = false;
  f.after(async (target, method, response) => {
    if (!uploaded && target === url && method === "PUT" && response.ok) {
      uploaded = true;
      f.policies.set(`${url}.policy`, await aclBody(url, true));
    }
    if (uploaded && target === `${url}.policy` && method === "PUT" && response.ok)
      reprotected = true;
    if (
      reprotected &&
      !widenedAgain &&
      target === `${url}.policy` &&
      method === "GET" &&
      response.ok
    ) {
      widenedAgain = true;
      f.policies.set(`${url}.policy`, await aclBody(url, true));
    }
    return response;
  });
  f.audit();
  await expect(
    uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected),
  ).rejects.toMatchObject({
    kind: "private-access-unavailable",
    cause: "Rollback protection changed",
  });
  expect(widenedAgain).toBe(true);
  expect(
    f.calls.filter(({ url: target, method }) => target === url && method === "PUT"),
  ).toHaveLength(1);
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement");
  expect(f.exposures).toEqual([]);
});

it("recursive removal preserves a root replaced after its last child DELETE receipt", async () => {
  const f = await rdfPod();
  const root = `${PRIVATE}tree/`;
  await f.pod.fetch(`${root}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let removed = false;
  let replaced = false;
  f.after(async (url, method, response) => {
    if (url === `${root}child` && method === "DELETE" && response.ok) removed = true;
    return response;
  });
  f.intercept(async (url, init) => {
    if (removed && !replaced && url === root && (init?.method ?? "GET") === "GET") {
      replaced = true;
      await f.pod.fetch(root, { method: "PUT", body: "" });
    }
    return undefined;
  });
  await expect(
    client.remove(root, { recursive: true, ifMatch: (await client.stat(root)).etag as string }),
  ).rejects.toMatchObject({ cause: { kind: "conflict", status: 412, url: root } });
  expect(replaced).toBe(true);
  expect(f.pod.has(root)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: root, method: "DELETE" });
});

it("copy rollback retains its container when the original source is replaced by identical RDF", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`;
  const to = `${PRIVATE}copy/`;
  await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let replaced = false;
  f.after(async (url, method, response) => {
    if (
      !replaced &&
      url === `${to}child` &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(url)).text()) === "secret contents"
    ) {
      replaced = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      await f.pod.fetch(from, { method: "PUT", body: "" });
    }
    return response;
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: [to],
    deletedSources: [],
  });
  expect(replaced).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.pod.has(`${to}child`)).toBe(false);
  expect(await (await f.pod.fetch(`${from}child`)).text()).toBe("secret contents");
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it("a failed final identity HEAD never becomes an ambiguous DELETE or a pending deletion", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const cause = new Error("Identity read offline");
  let offline = true;
  const http = vi.fn<typeof fetch>(async (input, init) => {
    if (offline && init?.method === "HEAD") throw cause;
    return f.fetch(input, init);
  });
  const deletion = deletionControl(
    http,
    (status, target) => new DriveError("conflict", status, target),
  );
  const etag = (await f.pod.fetch(url, { method: "HEAD" })).headers.get("etag") as string;
  await expect(deletion.remove(url, etag)).rejects.toBe(cause);
  expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toEqual([]);
  expect(await deletion.recheck(ROOT)).toEqual([]);
  offline = false;
  await deletion.remove(url, etag);
  expect(f.pod.has(url)).toBe(false);
});
