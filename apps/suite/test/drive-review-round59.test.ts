// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { parseRdf } from "@jeswr/fetch-rdf";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, accessGains } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import {
  listTrash,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import {
  ACL,
  aclBody,
  DRIVE,
  EVERYONE,
  OWNER,
  PRIVATE,
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

async function separateDefaults(url: string) {
  const data = await parseRdf(await aclBody(url), "text/turtle");
  const rule = new WacFields(`${url}#children`, data, DataFactory);
  rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  rule.iris(`${ACL}default`).add(url);
  rule.iris(`${ACL}agentClass`).add(EVERYONE);
  rule.iris(`${ACL}mode`).add(`${ACL}Read`);
  // A compensation at the same endpoint must preserve the entire captured ACL,
  // including grants that were irrelevant to this folder's access comparison.
  const unrelated = new WacFields(`${url}#other`, data, DataFactory);
  unrelated.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  unrelated.iris(`${ACL}accessTo`).add(`${url}other`);
  unrelated.iris(`${ACL}agent`).add(OWNER);
  unrelated.iris(`${ACL}mode`).add(`${ACL}Read`);
  return turtle(data);
}

async function metadata(url: string) {
  const data = new Store();
  const node = new WacFields(DataFactory.blankNode(), data, DataFactory);
  node.iris("https://example.test/value").add("urn:original");
  SetFrom.subjectPredicate(
    new WacFields(url, data, DataFactory),
    "https://example.test/note",
    TermAs.is,
    TermFrom.instance,
  ).add(node);
  return turtle(data);
}

it.each(
  ["partial Restore", "folder overwrite"].flatMap((step) =>
    [1, 2].map((failures) => ({ step, failures })),
  ),
)("round 59: failed $step preserves the complete captured ACL after $failures post-PUT failures", async ({
  step,
  failures,
}) => {
  const f = await rdfPod();
  const url = `${PRIVATE}tree/`;
  await f.pod.fetch(url, { method: "PUT", body: await metadata(url) });
  await f.pod.fetch(`${url}child`, { method: "PUT", body: "shared child" });
  const policy = await separateDefaults(url);
  const replacementBody = await metadata(url);
  f.policies.set(`${url}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let run: () => Promise<unknown>;
  if (step === "partial Restore") {
    f.intercept(async (target, init) =>
      target === `${url}child` && init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    expect(
      (await trashItems(client, DRIVE, [await client.stat(url)], { webId: OWNER })).failed,
    ).toHaveLength(1);
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    run = () => restoreItems(client, DRIVE, [entry]);
  } else {
    const selected = await client.stat(url);
    run = () =>
      client.write(
        url,
        replacementBody,
        { contentType: "text/turtle", ifMatch: selected.etag as string },
        { kind: "protect-ancestors" },
      );
  }
  expect((await f.anonymous(url)).status).toBe(403);
  expect((await f.anonymous(`${url}child`)).status).toBe(200);
  let writes = 0;
  let failed = 0;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) writes += 1;
    return response;
  });
  f.intercept(async (target, init) => {
    if (writes > failed && failed < failures && target === `${url}.policy` && !init?.method) {
      failed += 1;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await run().catch(() => undefined);
  expect(failed).toBe(failures);
  expect((await f.anonymous(`${url}child`)).status).toBe(200);
  expect(f.policies.get(`${url}.policy`)).toBe(policy);
  const access = accessControl(f.fetch, ROOT);
  const before = { url: `${url}.policy`, etag: "", dataset: await parseRdf(policy, "text/turtle") };
  const after = {
    ...before,
    dataset: await parseRdf(f.policies.get(`${url}.policy`) as string, "text/turtle"),
  };
  for (const project of [access.forResource, access.defaults]) {
    expect(accessGains(project(before, url), project(after, url))).toEqual([]);
    expect(accessGains(project(after, url), project(before, url))).toEqual([]);
  }
});

it("round 59: partial Restore compares an unchanged shared original with its archived policy after Trash DELETE 403", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}tree/`;
  await f.pod.fetch(url, { method: "PUT", body: await metadata(url) });
  await f.pod.fetch(`${url}child`, { method: "PUT", body: "shared child" });
  f.policies.set(`${url}.policy`, await separateDefaults(url));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (target, init) =>
    target === `${url}child` && init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(url)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(`${url}child`)).status).toBe(200);
  expect(f.pod.has(entry.url)).toBe(false);
});

it.each([
  "endpoint",
  "validator",
])("round 59: replay preserves a concurrent ACL %s change and reports private recovery", async (change) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const endpoint = `${url}.policy`;
  const foreignEndpoint = change === "endpoint" ? `${PRIVATE}other.policy` : endpoint;
  f.policies.set(endpoint, await separateDefaults(url));
  const foreign = `${await aclBody(url)}\n# another client's policy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let writes = 0;
  let failed = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) {
      writes += 1;
      if (writes === 2) f.policies.set(foreignEndpoint, foreign);
    }
    if (writes >= 2 && target === url && method === "HEAD" && change === "endpoint")
      response.headers.set("link", `<${foreignEndpoint}>; rel="acl"`);
    return response;
  });
  f.intercept(async (target, init) => {
    if (writes === 1 && !failed && target === endpoint && !init?.method) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(failed).toBe(true);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const retained = (error as DrivePartialFailureError).retainedDestinations;
  expect(retained.length).toBeGreaterThan(0);
  expect(await (await f.pod.fetch(retained[0] as string)).text()).toBe("secret contents");
  expect((await f.anonymous(retained[0] as string)).status).toBe(403);
  expect(f.policies.get(foreignEndpoint)).toBe(foreign);
  for (const target of [endpoint, foreignEndpoint])
    expect(f.calls).not.toContainEqual({ url: target, method: "PUT" });
});

it.each([
  { verificationFails: false, probe: "present" },
  { verificationFails: true, probe: "present" },
  { verificationFails: true, probe: "offline" },
  { verificationFails: true, probe: "404" },
  { verificationFails: true, probe: "410" },
])("round 59: quarantine reports a committed backup with no PUT receipt (verification fails: $verificationFails; backup: $probe)", async ({
  verificationFails,
  probe,
}) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  let backupWritten = false;
  let verificationRefused = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    if (
      target.includes("/.drive-recovery-") &&
      target.endsWith("/0-secret") &&
      method === "PUT" &&
      response.ok
    ) {
      backupWritten = true;
      response.headers.delete("etag");
    }
    return response;
  });
  f.intercept(async (target, init) => {
    if (verificationRefused && target.endsWith("/0-secret") && init?.method === "HEAD") {
      if (probe === "offline") throw new Error("Backup discovery unavailable");
      if (probe === "404" || probe === "410") {
        await f.pod.fetch(target, { method: "DELETE" });
        return new Response(null, { status: Number(probe) });
      }
    }
    if (
      verificationFails &&
      backupWritten &&
      target.includes("/.drive-recovery-") &&
      target.endsWith("/.policy")
    ) {
      verificationRefused = true;
      return new Response(null, { status: 503 });
    }
    if (uploaded && target === `${PRIVATE}.policy`) return new Response(null, { status: 503 });
    return undefined;
  });
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  const backups = f.pod
    .snapshot()
    .resources.map(([target]) => target)
    .filter((target) => target.includes("/.drive-recovery-") && target.endsWith("/0-secret"));
  expect(backups).toHaveLength(probe === "404" || probe === "410" ? 0 : 1);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect((error as DrivePartialFailureError).retainedDestinations).toEqual(backups);
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement");
});

it("round 59: quarantine reports all saved backups when protection-ledger hydration fails", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  let backups = 0;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    if (
      target.includes("/.drive-recovery-") &&
      /\/[01]-secret$/.test(target) &&
      method === "PUT" &&
      response.ok
    )
      backups += 1;
    return response;
  });
  f.intercept(async (target) =>
    uploaded && target === `${PRIVATE}.policy` ? new Response(null, { status: 503 }) : undefined,
  );
  const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === url && backups === 2) throw new Error("Ledger unavailable after backup");
    return get.call(this, key);
  });
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(backups).toBe(2);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const retained = (error as DrivePartialFailureError).retainedDestinations;
  expect(retained).toHaveLength(2);
  expect(
    await Promise.all(retained.map(async (target) => (await f.pod.fetch(target)).text())),
  ).toEqual(["secret contents", "replacement"]);
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement");
});

it("round 59: quarantine accumulates earlier and nested backup locations", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  let foreignAcl: string | undefined;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    if (
      !foreignAcl &&
      target.includes("/.drive-recovery-") &&
      target.endsWith("/1-secret") &&
      method === "PUT" &&
      response.ok
    ) {
      foreignAcl = `${target}.policy`;
      f.policies.set(foreignAcl, await aclBody(target, true));
    }
    return response;
  });
  f.intercept(async (target) =>
    uploaded && target === `${PRIVATE}.policy` ? new Response(null, { status: 503 }) : undefined,
  );
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(foreignAcl).toBeDefined();
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const retained = (error as DrivePartialFailureError).retainedDestinations;
  expect(retained).toHaveLength(2);
  expect(
    await Promise.all(retained.map(async (target) => (await f.pod.fetch(target)).text())),
  ).toEqual(["secret contents", "replacement"]);
  for (const target of retained) expect((await f.anonymous(target)).status).toBe(403);
});

it.each([
  "discovery",
  "backup PUT",
])("round 59: quarantine reports earlier backups when later %s fails", async (failure) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    return response;
  });
  f.intercept(async (target, init) => {
    if (uploaded && target === `${PRIVATE}.policy`) return new Response(null, { status: 503 });
    if (
      target.includes("/.drive-recovery-") &&
      target.endsWith("/1-secret") &&
      (failure === "discovery" || init?.method === "PUT")
    )
      return new Response(null, { status: 503 });
    return undefined;
  });
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  const backups = f.pod
    .snapshot()
    .resources.map(([target]) => target)
    .filter((target) => target.includes("/.drive-recovery-") && target.endsWith("/0-secret"));
  expect(backups).toHaveLength(1);
  expect(await (await f.pod.fetch(backups[0] as string)).text()).toBe("secret contents");
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect((error as DrivePartialFailureError).retainedDestinations).toEqual(backups);
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement");
});

it.each([
  "own ACL",
  "own ACL without fallback",
  "ACL absence",
])("round 59 shape a: ACL installation keeps its captured endpoint with %s", async (kind) => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const endpoint = `${PRIVATE}.policy`;
  const replacement = `${PRIVATE}changed.policy`;
  const captured = await access.read(endpoint);
  if (captured.status !== "known") throw new Error("Missing ACL");
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const identity = { url: PRIVATE, etag: (await client.stat(PRIVATE)).etag as string };
  if (kind !== "ACL absence") f.policies.set(replacement, f.policies.get(endpoint) as string);
  else f.policies.delete(endpoint);
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "HEAD")
      response.headers.set("link", `<${replacement}>; rel="acl"`);
    return response;
  });
  await expect(
    access.install(captured.policy, PRIVATE, PRIVATE, {
      identity,
      ...(kind === "own ACL without fallback" ? {} : { knownAcl: endpoint }),
      expectedAcl: kind !== "ACL absence" ? captured.policy : null,
    }),
  ).rejects.toThrow();
  expect(f.calls).not.toContainEqual({ url: replacement, method: "PUT" });
});
