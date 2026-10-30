// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, accessGains } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import {
  listTrash,
  moveItems,
  restoreItems,
  trashItems,
  uploadFile,
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

const APP = "https://another-app.test";
async function origins(resource: string, values: readonly string[]) {
  const data = await parseRdf(await aclBody(resource), "text/turtle");
  const rule = new WacFields(DataFactory.blankNode(), data, DataFactory);
  rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  rule.iris(`${ACL}accessTo`).add(resource);
  if (resource.endsWith("/")) rule.iris(`${ACL}default`).add(resource);
  for (const origin of values) rule.iris(`${ACL}origin`).add(origin);
  rule.iris(`${ACL}mode`).add(`${ACL}Read`);
  return turtle(data);
}

it.each(
  ["file", "folder"].flatMap((kind) => [false, true].map((hiddenLink) => ({ kind, hiddenLink }))),
)("round 63: separate origin grants require $kind Move confirmation (404 hides Link: $hiddenLink)", async ({
  kind,
  hiddenLink,
}) => {
  const f = await rdfPod();
  const from = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder")
    await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  f.policies.set(`${PRIVATE}.policy`, await origins(PRIVATE, ["https://suite.example"]));
  f.policies.set(`${PUBLIC}.policy`, await origins(PUBLIC, ["https://suite.example", APP]));
  f.after(async (_url, _method, response) => {
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    return response;
  });
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  const result = await moveItems(client, [await client.stat(from)], PUBLIC);
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({ gains: expect.arrayContaining([expect.stringContaining(APP)]) }),
  );
  expect(result.done).toEqual([]);
  expect(f.pod.has(from)).toBe(true);
  expect(f.calls.filter((call) => call.method === "DELETE")).toEqual([]);
});

it("round 63: origin permissions compare independently of principal clauses and mode unions", async () => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = async (values: readonly string[]) => ({
    url: `${PRIVATE}.policy`,
    etag: '"captured"',
    dataset: await parseRdf(await origins(PRIVATE, values), "text/turtle"),
  });
  const empty = await policy([]);
  const allowed = await policy([APP]);
  expect(accessGains(empty, allowed)).toContain(`Application ${APP}`);
  expect(accessGains(allowed, allowed)).toEqual([]);
  expect(accessGains(allowed, empty)).toEqual([]);
  expect(accessGains(empty, access.forResource(allowed, PRIVATE))).toContain(`Application ${APP}`);
});

it.each(
  ["Upload", "Copy", "folder Copy", "New folder"].flatMap((step) =>
    [false, true].map((hiddenLink) => ({ step, hiddenLink })),
  ),
)("round 63: $step rollback preserves a concurrently discovered ACL (404 hides Link: $hiddenLink)", async ({
  step,
  hiddenLink,
}) => {
  const f = await rdfPod();
  const from = step === "folder Copy" ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (step === "folder Copy") await f.pod.fetch(from, { method: "PUT", body: "" });
  const target = `${PRIVATE}${step === "New folder" || step === "folder Copy" ? "new/" : "new"}`;
  const alternate = `${target}concurrent.policy`;
  const foreign = await aclBody(target, true);
  let changed = false;
  f.after(async (url, method, response) => {
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    if (
      !changed &&
      url === target &&
      method === "PUT" &&
      response.ok &&
      (step !== "Upload" || (await (await f.pod.fetch(target)).text()) === "our upload")
    ) {
      changed = true;
      f.policies.set(alternate, foreign);
    }
    if (changed && url === target && method !== "PUT")
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    return response;
  });
  f.intercept(async (url, init) => {
    if (changed && url === target && init?.method === "DELETE") {
      const response = await f.pod.fetch(url, init);
      if (response.ok) f.policies.delete(alternate); // Solid servers may delete the discovered auxiliary with its resource.
      return response;
    }
    return undefined;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await (step === "Upload"
    ? uploadFile(client, PRIVATE, new Blob(["our upload"]), "new")
    : step === "New folder"
      ? client.createFolder(target, { kind: "inherit-verified" })
      : client.copy(from, target, { kind: "preserve-source" })
  ).catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(result).toBeInstanceOf(Error);
  expect(f.policies.get(alternate)).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  if (step === "Upload" || step === "Copy") {
    expect(result).toBeInstanceOf(DrivePartialFailureError);
    const retained = (result as DrivePartialFailureError).retainedDestinations;
    expect(retained.length).toBeGreaterThan(0);
    const bodies = await Promise.all(
      retained.map(async (url) => {
        expect((await f.anonymous(url)).status).toBe(403);
        return (await f.pod.fetch(url)).text();
      }),
    );
    expect(bodies).toContain(step === "Upload" ? "our upload" : "secret contents");
  }
});

it.each([
  "file",
  "folder",
])("round 63: partial Restore compares the archived shared %s after refused Trash DELETE", async (kind) => {
  const f = await rdfPod();
  const from = `${PUBLIC}shared${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(from, { method: "PUT", body: kind === "folder" ? "" : "shared original" });
  if (kind === "folder")
    await f.pod.fetch(`${from}child`, { method: "PUT", body: "shared original" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === (kind === "folder" ? `${from}child` : from) && init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(from)).status).toBe(200);
  expect(f.pod.has(entry.url)).toBe(false);
});

it.each([
  false,
  true,
])("round 63: recovery intersection retains only captured application permissions (permitted: %s)", async (permitted) => {
  const f = await rdfPod();
  const target = `${PRIVATE}secret`;
  const endpoint = `${target}.policy`;
  f.policies.set(endpoint, await origins(target, permitted ? [APP] : []));
  const access = accessControl(f.fetch, ROOT);
  const original = await access.read(endpoint);
  if (original.status !== "known") throw new Error("Missing own policy");
  const identity = {
    url: target,
    etag: (await f.pod.fetch(target, { method: "HEAD" })).headers.get("etag") as string,
  };
  const desired = await parseRdf(await origins(target, [APP]), "text/turtle");
  const saved = await access.store(endpoint, desired, target, {
    identity,
    restrict: true,
    expectedAcl: original.policy,
  });
  const baseline = {
    url: endpoint,
    etag: "",
    dataset: await parseRdf(await origins(target, []), "text/turtle"),
  };
  expect(accessGains(baseline, saved)).toEqual(permitted ? [`Application ${APP}`] : []);
});
