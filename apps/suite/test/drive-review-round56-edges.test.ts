// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, requireAccess } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { restoreItems } from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
} from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
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

afterEach(() => vi.restoreAllMocks());

it.each([
  "graph",
  "validator",
])("round 56: rollback retains metadata after the source %s changes without an ACL edit", async (change) => {
  const f = await rdfPod();
  const from = `${PRIVATE}tree/`,
    to = `${PRIVATE}copy/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add("urn:original");
  const body = await turtle(data);
  await f.pod.fetch(from, { method: "PUT", body });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let written = false,
    failed = false;
  f.after(async (url, method, response) => {
    if (
      !written &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()).includes("urn:original")
    ) {
      written = true;
      await f.pod.fetch(from, { method: "PUT", body: change === "graph" ? "" : body });
    }
    if (written && !failed && url === to && method === "GET") {
      failed = true;
      throw new Error("Lost listing");
    }
    return response;
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
  });
  expect(failed).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it.each([
  "no controller",
  "backup offline",
])("round 56: recovery protection failure is surfaced (%s)", async (failure) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`;
  if (failure === "no controller") {
    const data = await parseRdf(await aclBody(from), "text/turtle");
    new WacFields(`${from}#owner`, data, DataFactory).iris(`${ACL}mode`).delete(`${ACL}Control`);
    f.policies.set(`${from}.policy`, await turtle(data));
  }
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    ...(failure === "backup offline" ? { webId: OWNER } : {}),
  });
  let copied = false;
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
      await f.pod.fetch(from, { method: "PUT", body: "edited" });
    }
    return response;
  });
  f.intercept(async (url, init) => {
    if (
      failure === "backup offline" &&
      url.includes("/.drive-recovery-") &&
      !url.endsWith("/") &&
      !url.endsWith(".policy") &&
      init?.method === "PUT"
    )
      return Promise.reject("Backup unavailable");
    return undefined;
  });
  if (failure === "no controller") {
    await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
      kind: "private-access-unavailable",
      cause: "Recovery owner unavailable",
    });
    expect(copied).toBe(false);
    expect(f.pod.has(to)).toBe(false);
    expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
    expect(f.calls.filter(({ method }) => ["PUT", "DELETE"].includes(method))).toEqual([]);
    return;
  }
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: expect.arrayContaining([to]),
    cause: { kind: "partial-failure", retainedDestinations: [], cause: "Backup unavailable" },
  });
  expect(copied).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it("round 56: a retained move surfaces backup provisioning failure and keeps private recovery", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PRIVATE}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let copied = false;
  f.after(async (url, method, response) => {
    if (
      !copied &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      copied = true;
      await f.pod.fetch(from, { method: "PUT", body: "edited" });
    }
    return response;
  });
  f.intercept(async (url, init) =>
    copied &&
    ((url === `${to}.policy` && init?.method === "PUT") || url.includes("/.drive-recovery-"))
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(client.move(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
    cause: {
      kind: "partial-failure",
      retainedDestinations: [],
      cause: { kind: "failed", status: 503 },
    },
  });
  expect((await f.anonymous(to)).status).toBe(403);
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
});

it.each([
  "no controller",
  "unavailable recovery identifier",
])("round 59: recovery reports %s while preserving captured bytes", async (failure) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  if (failure === "no controller") {
    const data = await parseRdf(await aclBody(from), "text/turtle");
    new WacFields(`${from}#owner`, data, DataFactory).iris(`${ACL}mode`).delete(`${ACL}Control`);
    f.policies.set(`${from}.policy`, await turtle(data));
  }
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    ...(failure === "unavailable recovery identifier" ? { webId: OWNER } : {}),
  });
  let copied = false;
  const uuid = crypto.randomUUID.bind(crypto);
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    if (copied && failure === "unavailable recovery identifier")
      throw "Recovery identifier unavailable";
    return uuid();
  });
  f.after(async (url, method, response) => {
    if (
      !copied &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      copied = true;
      await f.pod.fetch(from, { method: "PUT", body: "edited" });
      if (failure === "unavailable recovery identifier")
        f.policies.set(`${to}.policy`, await aclBody(to, true));
    }
    return response;
  });
  f.intercept(async (url, init) =>
    copied && url === `${to}.policy` && init?.method === "PUT"
      ? new Response(null, { status: 503 })
      : undefined,
  );
  if (failure === "no controller") {
    await expect(client.move(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
      kind: "private-access-unavailable",
      cause: "Recovery owner unavailable",
    });
    expect(copied).toBe(false);
    expect(f.pod.has(to)).toBe(false);
    expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
    expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
    return;
  }
  await expect(client.move(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: expect.arrayContaining([to]),
    cause: {
      kind: "private-access-unavailable",
      cause: "Recovery identifier unavailable",
    },
  });
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it("round 56: demo folder compensation also uses the shared ACL ownership boundary", async () => {
  const from = `${ROOT}tree/`,
    to = `${ROOT}copy/`;
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "tree/child", body: "original", contentType: "text/plain" }],
  });
  let created = false;
  const http: typeof fetch = async (input, init) => {
    if (created && String(input) === from && init?.method === "HEAD")
      return new Response(null, { status: 503 });
    const response = await pod.fetch(input, init);
    if (String(input) === to && init?.method === "PUT" && response.ok) created = true;
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(pod.has(from)).toBe(true);
  expect(pod.has(to)).toBe(false);
});

it.each([
  false,
  true,
])("round 56: unsettled recovery carries its approved validator and never authorizes deletion (versioned: %s)", async (versioned) => {
  const f = await rdfPod();
  const url = `${DRIVE}.trash/12345678-1234-1234-1234-123456789012/secret`;
  const entry = { url, original: `${PRIVATE}missing`, name: "secret", trashedAt: new Date(0) };
  await f.pod.fetch(url, { method: "PUT", body: "original" });
  f.policies.set(`${DRIVE}.trash/.policy`, await aclBody(`${DRIVE}.trash/`));
  const index = emptyTrashIndex();
  addTrashRecord(index, entry);
  index.record(url).status = "partial";
  index.record(url).leaseOwner = "urn:foreign:expired";
  index.record(url).leaseUntil = new Date(0);
  await f.pod.fetch(`${DRIVE}.trash/index.ttl`, {
    method: "PUT",
    body: await serializeTrashIndex(index),
    headers: { "content-type": "text/turtle" },
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const identity = await client.stat(url);
  const selected = versioned
    ? {
        ...entry,
        etag: identity.etag as string,
        ...(identity.verifyHeaders ? { verifyHeaders: identity.verifyHeaders } : {}),
      }
    : entry;
  const result = await restoreItems(client, DRIVE, [selected]);
  expect(result.failed).toHaveLength(1);
  expect(await (await f.pod.fetch(entry.original)).text()).toBe("original");
  expect(f.pod.has(url)).toBe(true);
});

it("round 56: restricted installation retains captured origin constraints", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const data = await parseRdf(await aclBody(url), "text/turtle");
  new WacFields(`${url}#owner`, data, DataFactory)
    .iris(`${ACL}origin`)
    .add("https://trusted.example/");
  f.policies.set(`${url}.policy`, await turtle(data));
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.effective(url), url);
  const etag = (await f.fetch(url, { method: "HEAD" })).headers.get("etag") as string;
  await access.install(policy, url, url, {
    identity: { url, etag },
    expectedAcl: policy,
    restrict: true,
  });
  expect(f.policies.get(`${url}.policy`)).toContain("https://trusted.example/");
});

it("round 56: installation without a discovered or saved ACL endpoint fails before writing", async () => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.effective(PRIVATE), PRIVATE);
  f.after(async (url, _method, response) => {
    if (url === PRIVATE) response.headers.delete("link");
    return response;
  });
  await expect(access.install(policy, PRIVATE, PRIVATE)).rejects.toMatchObject({
    cause: "Destination has no ACL support",
  });
  expect(f.calls).not.toContainEqual({ url: `${PRIVATE}.policy`, method: "PUT" });
});
