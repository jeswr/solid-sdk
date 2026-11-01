// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { accessControl, accessLabel } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient, parentOf } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import {
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { ACL, aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

/** Conventional .acl endpoints with actual owner Read/Write/Control enforcement.
 * The existing fixture's policy store supplies conditional ACL requests and ETags.
 */
async function ownerWacPod() {
  const f = await rdfPod();
  const calls: { url: string; method: string }[] = [];
  const policyTags = new Map<string, string>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const auxiliary = url.endsWith(".acl");
    let resource: string | undefined = auxiliary ? url.slice(0, -4) : url;
    let inherited = false;
    let allowed = false;
    while (resource?.startsWith(ROOT)) {
      const body = f.policies.get(`${resource}.policy`);
      if (body !== undefined) {
        const data = await parseRdf(body, "text/turtle");
        const mode = auxiliary ? "Control" : ["GET", "HEAD"].includes(method) ? "Read" : "Write";
        allowed = [...new AclResource(data, DataFactory).authorizations].some(
          (rule) =>
            (inherited ? rule.default === resource : rule.accessTo === resource) &&
            rule.agent.has(OWNER) &&
            rule.mode.has(`${ACL}${mode}`),
        );
        break;
      }
      resource = parentOf(resource);
      inherited = true;
    }
    if (!allowed) return new Response(null, { status: 403 });
    if (auxiliary) {
      const headers = new Headers(init?.headers);
      const approved = [...policyTags].find(([, tag]) => tag === headers.get("if-match"));
      if (approved) headers.set("if-match", approved[0]);
      const response = await f.fetch(`${url.slice(0, -4)}.policy`, { ...init, headers });
      if (method === "DELETE" && response.ok) f.policies.delete(`${url.slice(0, -4)}.policy`);
      const receipt = response.headers.get("etag");
      if (receipt) {
        if (!policyTags.has(receipt)) policyTags.set(receipt, `"policy-${policyTags.size}"`);
        response.headers.set("etag", policyTags.get(receipt) as string);
      }
      return response;
    }
    f.endpoints.set(url, `${url}.acl`);
    return f.fetch(input, init);
  };
  return { ...f, fetch, calls };
}

it.each([
  "folder",
  "sibling",
])("round 71 fixture: an empty %s ACL revokes owner Read and Control", async (kind) => {
  const f = await ownerWacPod();
  const protectedUrl = kind === "folder" ? PRIVATE : `${PRIVATE}secret`;
  expect((await f.fetch(protectedUrl)).status).toBe(200);
  expect((await f.fetch(`${protectedUrl}.acl`, { method: "PUT", body: "" })).status).toBe(201);
  expect((await f.fetch(protectedUrl)).status).toBe(403);
  expect((await f.fetch(`${protectedUrl}.acl`, { method: "DELETE" })).status).toBe(403);
});

it.each(
  [".acl", "secret.acl"].flatMap((name) =>
    ["Upload", "Keep both", "unconditional write", "owner-only write", "Copy", "Rename"].map(
      (step) => ({ name, step }),
    ),
  ),
)("round 71: $step refuses auxiliary $name before any placeholder can revoke owner access", async ({
  name,
  step,
}) => {
  const f = await ownerWacPod();
  // Keep the folder inherited too: creating its .acl must not end inheritance.
  f.policies.delete(`${PRIVATE}.policy`);
  const source = `${PRIVATE}notes.ttl`;
  await f.pod.fetch(source, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: "",
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const target = `${PRIVATE}${name}`;
  const selected = await client.stat(source);
  const run = () => {
    if (step === "Upload" || step === "Keep both")
      return uploadFile(
        client,
        PRIVATE,
        new Blob([""], { type: "text/turtle" }),
        name,
        step === "Upload" ? "fail" : "keep-both",
      );
    if (step === "Copy") return client.copy(source, target, { kind: "preserve-source" });
    if (step === "Rename") return renameItem(client, selected, name);
    return client.write(
      target,
      "",
      { contentType: "text/turtle" },
      step === "owner-only write"
        ? { kind: "owner-only", webId: OWNER }
        : { kind: "protect-ancestors" },
    );
  };
  const result = await run().catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toContain("access-control resource");
  expect(f.calls.filter(({ method }) => ["PUT", "DELETE", "PATCH"].includes(method))).toEqual([]);
  expect((await f.fetch(PRIVATE)).status).toBe(200);
  expect((await f.fetch(source)).status).toBe(200);
  // Owner still has Control (a readable, absent ACL), and all bytes survive.
  expect((await f.fetch(`${PRIVATE}.acl`)).status).toBe(404);
  expect((await f.fetch(`${source}.acl`)).status).toBe(404);
  expect(await (await f.fetch(source)).text()).toBe("");
  expect(await (await f.fetch(`${PRIVATE}secret`)).text()).toBe("secret contents");
});

it.each([
  ".acl",
  "secret.ACL",
  ".acr",
  "secret.AcR",
  "%2Eacl",
  "secret%2e%61cl",
  "parent.acl/child",
  "parent.acr/child",
  "parent%2Eacl/child",
  "parent.acl%2fchild",
])("round 71: ordinary destinations reject access-control path %s before ancestor creation", async (path) => {
  const f = await ownerWacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      `${PRIVATE}${path}`,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("access-control resource");
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
});

it.each([
  "Replace",
  "owner-only Replace",
])("round 71: %s cannot replace a captured existing auxiliary policy", async (step) => {
  const f = await ownerWacPod();
  const source = `${PRIVATE}secret`;
  const original = await aclBody(source);
  f.policies.set(`${source}.policy`, original);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const approved = await client.stat(`${source}.acl`);
  const run =
    step === "Replace"
      ? () =>
          uploadFile(
            client,
            PRIVATE,
            new Blob([""], { type: "text/turtle" }),
            "secret.acl",
            "replace",
            approved,
          )
      : () =>
          client.write(
            approved.url,
            "",
            { contentType: "text/turtle", ...confirmationOptions(approved) },
            { kind: "owner-only", webId: OWNER },
          );
  await expect(run()).rejects.toThrow("access-control resource");
  expect(f.policies.get(`${source}.policy`)).toBe(original);
  expect((await f.fetch(source)).status).toBe(200);
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
});

it.each([
  "write",
  "folder",
  "Copy",
  "Move",
  "mergeContainer",
])("round 71: %s rejects reserved folder destinations", async (step) => {
  const f = await rdfPod();
  const source = `${PRIVATE}source/`;
  await f.pod.fetch(source, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(source);
  const target = `${PRIVATE}folder.acl/`;
  const run = () => {
    if (step === "folder") return client.createFolder(target, { kind: "inherit-verified" });
    if (step === "Copy") return client.copy(source, target, { kind: "preserve-source" });
    if (step === "Move")
      return client.move(
        source,
        target,
        { kind: "preserve-source" },
        confirmationOptions(selected),
      );
    if (step === "mergeContainer")
      return client.mergeContainer(
        source,
        target,
        { kind: "preserve-source" },
        confirmationOptions(selected),
      );
    return client.write(
      target,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    );
  };
  await expect(run()).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.pod.has(source)).toBe(true);
});

it.each([
  "Copy",
  "Move",
])("round 71: %s validates every descendant destination before creating any tree", async (step) => {
  const f = await rdfPod();
  const source = `${PRIVATE}source/`;
  await f.pod.fetch(`${source}first`, { method: "PUT", body: "keep" });
  await f.pod.fetch(`${source}last.acl`, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(source);
  const target = `${PRIVATE}target/`;
  await expect(
    step === "Copy"
      ? client.copy(source, target, { kind: "preserve-source" })
      : client.move(source, target, { kind: "preserve-source" }, confirmationOptions(selected)),
  ).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.pod.has(target)).toBe(false);
  expect(await (await f.pod.fetch(`${source}first`)).text()).toBe("keep");
});

it.each(
  ["WAC", "ACP"].flatMap((model) => [false, true].map((encoded) => ({ model, encoded }))),
)("round 71: ordinary writes reject a previously discovered custom $model endpoint (encoded: $encoded)", async ({
  model,
  encoded,
}) => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const endpoint = `${PRIVATE}custom-policy`;
  f.after(async (url, method, response) => {
    if (url === source && method === "HEAD")
      response.headers.set(
        "link",
        `<${endpoint}>; rel="${model === "WAC" ? "acl" : "http://www.w3.org/ns/solid/acp#accessControl"}"`,
      );
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.stat(source);
  await expect(
    client.write(
      encoded ? `${PRIVATE}%63ustom-policy` : endpoint,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("access-control resource");
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
});

it.each([
  "notes.acl.txt",
  ".acls",
  "normal%20name.ttl",
])("round 71: safe ordinary filename %s still uploads", async (name) => {
  const f = await ownerWacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const target = `${PRIVATE}${name}`;
  await client.write(
    target,
    "safe",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(await (await f.fetch(target)).text()).toBe("safe");
});

it.each([
  "Delete",
  "Move",
  "Rename",
])("round 71: ordinary %s disposal cannot remove an access-control resource and resume inheritance", async (step) => {
  const f = await ownerWacPod();
  const protectedUrl = `${PRIVATE}secret`;
  const policy = await aclBody(protectedUrl);
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  f.policies.set(`${protectedUrl}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(`${protectedUrl}.acl`);
  const run = () =>
    step === "Delete"
      ? client.remove(selected.url, confirmationOptions(selected))
      : step === "Rename"
        ? renameItem(client, selected, "notes.ttl")
        : client.move(
            selected.url,
            `${PRIVATE}notes.ttl`,
            { kind: "preserve-source" },
            confirmationOptions(selected),
          );
  await expect(run()).rejects.toThrow("access-control resource");
  expect(f.policies.get(`${protectedUrl}.policy`)).toBe(policy);
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
});

it.each(
  ["file", "folder"].flatMap((kind) => ["own", "inherited"].map((sharing) => ({ kind, sharing }))),
)("round 71: partial Restore preserves $sharing person sharing on an unchanged $kind after refused Trash DELETE", async ({
  kind,
  sharing,
}) => {
  const f = await rdfPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared contents" });
  const governed = sharing === "own" ? source : PRIVATE;
  const data = await parseRdf(await aclBody(governed), "text/turtle");
  const friend = new WacFields(DataFactory.blankNode(), data, DataFactory);
  friend.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  friend.iris(`${ACL}accessTo`).add(governed);
  if (governed.endsWith("/")) friend.iris(`${ACL}default`).add(governed);
  friend.iris(`${ACL}agent`).add(`${ROOT}friend#me`);
  friend.iris(`${ACL}mode`).add(`${ACL}Read`);
  const original = await turtle(data);
  f.policies.set(`${governed}.policy`, original);
  const access = accessControl(f.fetch, ROOT);
  expect(accessLabel(await access.effective(content), content, OWNER)).toBe(
    "People you've shared with: 1",
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (!entry) throw new Error("Missing recovery");
  expect(entry.status).toBe("partial");
  expect(accessLabel(await access.effective(entry.url), entry.url, OWNER)).toBe("Only you");
  const result = await restoreItems(client, DRIVE, entries);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.policies.get(`${governed}.policy`)).toBe(original);
  expect(accessLabel(await access.effective(content), content, OWNER)).toBe(
    "People you've shared with: 1",
  );
  expect(await (await client.read(content)).text()).toBe("shared contents");
});
