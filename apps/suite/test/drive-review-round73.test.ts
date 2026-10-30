// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, accessLabel } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import {
  deleteForever,
  listTrash,
  purgeExpired,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { customAclPod } from "./drive-custom-acl-pod";
import { rdfPod } from "./drive-rdf-pod";
import { ACL, aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

it.each([
  { resource: ROOT, method: "HEAD" },
  { resource: ROOT, method: "GET" },
  { resource: PRIVATE, method: "HEAD" },
  { resource: PRIVATE, method: "GET" },
  { resource: `${PRIVATE}secret`, method: "HEAD" },
])("round 73: missing namespace Link on $method $resource stops all writes", async ({
  resource,
  method,
}) => {
  const f = await customAclPod();
  const secret = `${PRIVATE}secret`;
  const endpoint = `${PRIVATE}secret-policy.ttl`;
  f.endpoints.set(secret, endpoint);
  f.after(async (url, verb, response) => {
    if (url === resource && verb === method) response.headers.delete("link");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await uploadFile(
    client,
    PRIVATE,
    new Blob([""]),
    "secret-policy.ttl",
    "fail",
  ).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(f.calls.filter(({ method }) => ["PUT", "PATCH", "DELETE"].includes(method))).toEqual([]);
  expect(result).toHaveProperty("message", expect.stringContaining("Drive could not discover"));
  expect((await f.fetch(secret)).status).toBe(200);
  // Reading the absent endpoint requires owner Control over secret.
  expect((await f.fetch(endpoint)).status).toBe(404);
});

it.each([
  "Delete forever",
  "Empty Trash",
  "startup purge",
])("round 73: %s never recaptures descendants after a stale traversal", async (step) => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}sub/a`, { method: "PUT", body: "A" });
  await f.pod.fetch(`${source}sub/z`, { method: "PUT", body: "Z" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const trashed = await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  const entries = await listTrash(client, DRIVE);
  const entry = entries[0];
  if (!entry) throw new Error("Missing Trash tree");
  const a = `${entry.url}sub/a`;
  const z = `${entry.url}sub/z`;
  let captured = false;
  let replaced = false;
  f.after(async (_url, _method, response) => {
    // This server provides no atomic parent receipts for committed deletions.
    response.headers.delete("x-solid-drive-parent-validators");
    return response;
  });
  const http: typeof fetch = async (input, init) => {
    // Only the snapshot's conditional HEAD can authorize this race; namespace
    // probes and Trash listing hydration must finish without interference.
    if (String(input) === a && init?.method === "HEAD")
      captured = new Headers(init.headers).has("if-match");
    if (String(input) === z && init?.method === "HEAD" && captured && !replaced) {
      replaced = true;
      await f.pod.fetch(z, { method: "DELETE" });
      await f.pod.fetch(a, { method: "PUT", body: "B from another client" });
      expect((await f.pod.fetch(entry.url, { method: "HEAD" })).headers.get("etag")).toBe(
        entry.etag,
      );
      return new Response(null, { status: 404 });
    }
    return f.fetch(input, init);
  };
  const deleting = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const result =
    step === "startup purge"
      ? await purgeExpired(deleting, DRIVE, { now: new Date(Date.now() + 31 * 86_400_000) })
      : await deleteForever(deleting, DRIVE, entries);
  expect(replaced).toBe(true);
  expect(await (await f.pod.fetch(a)).text()).toBe("B from another client");
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]?.error).toHaveProperty(
    "message",
    "The folder changed during deletion. Refresh Trash and confirm deletion again.",
  );
  expect(f.calls).not.toContainEqual({ url: a, method: "DELETE" });
});

it.each([
  "source policy",
  "own source policy",
  "descendant content",
  "descendant discovery",
])("round 73: renewed Move consent retains captured %s", async (change) => {
  const f = await rdfPod();
  const folder = !change.endsWith("source policy");
  const source = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  const content = folder ? `${source}sub/a` : source;
  if (folder) await f.pod.fetch(content, { method: "PUT", body: "A" });
  if (change === "own source policy") f.policies.set(`${source}.policy`, await aclBody(source));
  const destination = `${DRIVE}destination/`;
  const target = `${destination}${folder ? "tree/" : "secret"}`;
  await f.pod.fetch(destination, { method: "PUT", body: "" });
  f.policies.set(`${destination}.policy`, await aclBody(destination));
  let widened = false;
  let confirmed = false;
  let callsAtConfirmation = 0;
  const confirmAccess = vi.fn(async () => {
    confirmed = true;
    callsAtConfirmation = f.calls.length;
    if (change.endsWith("source policy")) {
      const resource = change === "own source policy" ? source : PRIVATE;
      const data = await parseRdf(f.policies.get(`${resource}.policy`) as string, "text/turtle");
      const bob = new WacFields(`${resource}#bob`, data, DataFactory);
      bob.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
      bob.iris(`${ACL}accessTo`).add(resource);
      if (resource.endsWith("/")) bob.iris(`${ACL}default`).add(resource);
      bob.iris(`${ACL}agent`).add(`${ROOT}bob#me`);
      bob.iris(`${ACL}mode`).add(`${ACL}Read`);
      f.policies.set(`${resource}.policy`, await turtle(data));
    } else if (change === "descendant content") {
      await f.pod.fetch(content, { method: "PUT", body: "B from another client" });
    } else f.endpoints.set(content, `${content}-foreign.policy`);
    return "keep" as const;
  });
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    const url = String(input);
    if (
      !widened &&
      url.startsWith(target) &&
      !url.endsWith(".policy") &&
      init?.method === "PUT" &&
      new Headers(init.headers).has(
        change === "own source policy" ? "if-none-match" : "if-match",
      ) &&
      response.ok
    ) {
      widened = true;
      f.policies.set(`${destination}.policy`, await aclBody(destination, true));
    }
    return response;
  };
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: http,
    webId: OWNER,
    confirmAccess,
  });
  const selected = await client.stat(source);
  const result = await client
    .move(source, target, { kind: "confirm-move" }, confirmationOptions(selected))
    .catch((error: unknown) => error);
  expect(widened).toBe(true);
  expect(
    confirmed,
    JSON.stringify(result, ["name", "message", "cause", "retainedDestinations"]),
  ).toBe(true);
  expect(confirmAccess).toHaveBeenCalledOnce();
  expect(result).toBeInstanceOf(Error);
  expect(f.pod.has(content)).toBe(true);
  expect(f.pod.has(target)).toBe(false);
  expect(
    f.calls.slice(callsAtConfirmation).filter(({ method }) => ["PUT", "DELETE"].includes(method)),
  ).toEqual([]);
});

it.each([
  "file",
  "folder",
])("round 73: partial Restore of an unchanged shared %s uses its archived original audience", async (kind) => {
  const f = await customAclPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared original" });
  const original = await aclBody(source, true);
  f.policies.set(`${source}.policy`, original);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  const entry = entries[0];
  if (!entry) throw new Error("Missing recovery copy");
  expect(entry.status).toBe("partial");
  const access = accessControl(f.fetch, ROOT);
  expect(accessLabel(await access.effective(entry.url), entry.url, OWNER)).toBe("Only you");
  expect(accessLabel(await access.effective(source), source, OWNER)).toBe("Anyone with the link");
  const restored = await restoreItems(client, DRIVE, entries);
  expect(restored.failed).toEqual([]);
  expect(restored.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.policies.get(`${source}.policy`)).toBe(original);
  expect(await (await client.read(content)).text()).toBe("shared original");
});
