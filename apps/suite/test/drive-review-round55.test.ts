// AUTHORED-BY Codex
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import {
  listTrash,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());
it.each([
  "copy",
  "rename",
])("round 55: %s binds captured bytes to their policy version", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PRIVATE}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === from && method === "GET" && response.ok) {
      replaced = true;
      await f.pod.fetch(from, { method: "PUT", body: "sanitized" });
      f.policies.set(`${from}.policy`, await aclBody(from, true));
    }
    return response;
  });
  await expect(
    step === "copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  const anonymous = await f.anonymous(to);
  expect(anonymous.ok && (await anonymous.text()) === "secret contents").toBe(false);
  expect(f.pod.has(to)).toBe(false);
});
it("round 55: compensation preserves a newly revoked public grant", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let revoked = false;
  f.after(async (target, method, response) => {
    if (!revoked && target === url && method === "PUT" && response.ok) {
      revoked = true;
      f.policies.set(`${url}.policy`, await aclBody(url));
    }
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(revoked).toBe(true);
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
  expect((await f.anonymous(url)).status).toBe(403);
});
it.each([
  "copy",
  "rename",
])("round 55: refused %s cleanup secures retained confidential recovery", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${PRIVATE}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let widened = false;
  f.after(async (url, method, response) => {
    if (
      !widened &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      widened = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      await f.pod.fetch(from, { method: "PUT", body: "edited source" });
    }
    return response;
  });
  await expect(
    step === "copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(widened).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect((await f.anonymous(to)).status).toBe(403);
});
it.each([
  "revoked",
  "widened",
])("round 55: rollback ACL never widens a replacement during provisioning (%s)", async (ordering) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let uploaded = false,
    replaced = false;
  const locks = navigator.locks;
  const request = locks.request.bind(locks);
  vi.spyOn(locks, "request").mockImplementation(
    async (...args: Parameters<typeof locks.request>) => {
      if (uploaded && !replaced && String(args[0]).startsWith("solid-drive:ancestor:")) {
        replaced = true;
        await f.pod.fetch(url, { method: "PUT", body: "replacement secret" });
        f.policies.set(`${url}.policy`, await aclBody(url));
        f.calls.length = 0;
      }
      return Reflect.apply(request, locks, args);
    },
  );
  f.after(async (target, method, response) => {
    if (!uploaded && target === url && method === "PUT" && response.ok) {
      uploaded = true;
      f.policies.set(`${url}.policy`, await aclBody(url, ordering === "widened"));
    }
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(f.calls).not.toContainEqual({ url: `${url}.policy`, method: "PUT" });
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement secret");
  await expect(client.read(url)).rejects.toThrow();
  expect((await f.anonymous(url)).status).toBe(403);
});
it.each([
  false,
  true,
])("round 55: replay checks and repairs protection after PUT (hidden Link: %s)", async (hidden) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let puts = 0;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) {
      puts++;
      f.policies.set(`${url}.policy`, await aclBody(url, true));
    }
    if (hidden && puts >= 2 && target === url) response.headers.delete("link");
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(puts).toBe(2);
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
  expect((await f.anonymous(url)).status).toBe(403);
});
it("round 55: shared original with a refused Trash DELETE finishes partial Restore", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "shared original" });
  f.policies.set(`${source}.policy`, await aclBody(source, true));
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
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(result.failed).toEqual([]);
  expect(f.pod.has(entry.url)).toBe(false);
  expect((await f.anonymous(`${source}child`)).status).toBe(200);
});

it.each([
  "resource",
  "defaults",
  "unrelated",
  "deny all",
  "origin group",
])("round 55: recovery ACL intersection preserves narrower %s grants", async (mode) => {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { DataFactory } = await import("n3");
  const { accessControl } = await import("../src/apps/drive/lib/client/access");
  const { WacFields, ACL, turtle } = await import("./drive-wac-pod");
  const f = await rdfPod();
  const url = `${PRIVATE}folder/`;
  await f.pod.fetch(`${url}child`, { method: "PUT", body: "private" });
  const desired = await parseRdf(await aclBody(url, true), "text/turtle");
  const current = await parseRdf(await aclBody(url, true), "text/turtle");
  const publicRule = new WacFields(`${url}#public`, current, DataFactory);
  if (mode === "resource") publicRule.iris(`${ACL}accessTo`).clear();
  if (mode === "defaults") publicRule.iris(`${ACL}default`).clear();
  if (mode === "unrelated") {
    publicRule.iris(`${ACL}accessTo`).clear();
    publicRule.iris(`${ACL}accessTo`).add(`${PRIVATE}other`);
    publicRule.iris(`${ACL}default`).clear();
  }
  if (mode === "deny all")
    for (const name of ["owner", "public"]) {
      const rule = new WacFields(`${url}#${name}`, current, DataFactory);
      rule.iris(`${ACL}agent`).clear();
      rule.iris(`${ACL}agentClass`).clear();
    }
  if (mode === "origin group")
    for (const data of [desired, current]) {
      const rule = new WacFields(`${url}#public`, data, DataFactory);
      rule.iris(`${ACL}agentClass`).clear();
      rule.iris(`${ACL}agentGroup`).add(`${ROOT}group#friends`);
      rule.iris(`${ACL}origin`).add("https://trusted.example/");
    }
  f.policies.set(`${url}.policy`, await turtle(current));
  const etag = (await f.fetch(url, { method: "HEAD" })).headers.get("etag") as string;
  await accessControl(f.fetch, ROOT).install(
    { url: `${url}.policy`, etag: "", dataset: desired },
    url,
    url,
    { identity: { url, etag }, restrict: true },
  );
  expect((await f.anonymous(url)).status).toBe(mode === "defaults" ? 200 : 403);
  expect((await f.anonymous(`${url}child`)).status).toBe(mode === "resource" ? 200 : 403);
  if (mode === "origin group")
    expect(f.policies.get(`${url}.policy`)).toContain("https://trusted.example/");
});

// A child DELETE has no atomic parent receipt in standard LDP. Keep this
// executable reproduction explicit until container lifetime witnesses replace
// HEAD-based advancement; a second read or graph equality cannot prove identity.
it.fails("round 55 low, unresolved: a post-mutation HEAD must not authorize deleting a recreated parent", async () => {
  const f = await rdfPod();
  const root = `${PRIVATE}tree/`;
  await f.pod.fetch(`${root}child`, { method: "PUT", body: "approved child" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(root);
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === `${root}child` && method === "DELETE" && response.ok) {
      replaced = true;
      await f.pod.fetch(root, { method: "DELETE" });
      await f.pod.fetch(root, { method: "PUT", body: "" });
    }
    return response;
  });
  await client
    .remove(root, { recursive: true, ifMatch: selected.etag as string })
    .catch(() => undefined);
  expect(replaced).toBe(true);
  expect(f.pod.has(root)).toBe(true);
});

it.each([
  "created placeholder",
  "refused creation",
])("round 55: protection-ledger repair never adopts a replacement after %s", async (mode) => {
  const f = await rdfPod();
  const from = `${DRIVE}public/placeholder`,
    to = `${PRIVATE}recovery`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) => {
    if (mode === "refused creation" && url === to && init?.method === "PUT")
      return new Response(null, { status: 412 });
    if (url === `${to}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (url === to && init?.method === "DELETE") return new Response(null, { status: 403 });
    return undefined;
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  f.intercept(undefined);
  await f.pod.fetch(to, { method: "PUT", body: "replacement secret" });
  expect((await f.anonymous(to)).status).toBe(403);
  f.calls.length = 0;
  await expect(client.read(to)).rejects.toThrow();
  expect(f.calls).not.toContainEqual({ url: `${to}.policy`, method: "PUT" });
  expect((await f.anonymous(to)).status).toBe(403);
});

it.each([
  "strong",
  "missing",
  "weak",
])("round 55: direct ACL installation requires a %s resource receipt", async (mode) => {
  const { accessControl, requireAccess } = await import("../src/apps/drive/lib/client/access");
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.effective(PRIVATE), PRIVATE);
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "HEAD" && mode !== "strong") {
      if (mode === "missing") response.headers.delete("etag");
      else response.headers.set("etag", 'W/"weak"');
    }
    return response;
  });
  const result = access.install(policy, PRIVATE, PRIVATE);
  if (mode === "strong") await expect(result).resolves.toMatchObject({ url: `${PRIVATE}.policy` });
  else {
    await expect(result).rejects.toThrow();
    expect(f.calls).not.toContainEqual({ url: `${PRIVATE}.policy`, method: "PUT" });
  }
});

it.each(
  [false, true].flatMap((replace) => ["file", "folder"].map((kind) => ({ replace, kind }))),
)("round 55: owner-only $kind overwrite keeps its preflight receipt through ACL provisioning (replacement: $replace)", async ({
  replace,
  kind,
}) => {
  const f = await rdfPod();
  const url = kind === "folder" ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (kind === "folder") await f.pod.fetch(url, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let provisioned = false;
  let replacementEtag: string | null = null;
  f.after(async (target, method, response) => {
    if (!provisioned && target === `${url}.policy` && method === "PUT" && response.ok) {
      provisioned = true;
      if (replace) {
        await f.pod.fetch(url, {
          method: "PUT",
          body: kind === "folder" ? "" : "unapproved replacement",
        });
        replacementEtag = (await f.pod.fetch(url, { method: "HEAD" })).headers.get("etag");
      }
    }
    return response;
  });
  const result = client.write(
    url,
    kind === "folder" ? "" : "approved upload",
    { contentType: kind === "folder" ? "text/turtle" : "text/plain" },
    { kind: "owner-only" },
  );
  if (replace) {
    await expect(result).rejects.toMatchObject({ kind: "conflict", status: 412 });
    expect((await f.pod.fetch(url, { method: "HEAD" })).headers.get("etag")).toBe(replacementEtag);
  } else await expect(result).resolves.toHaveProperty("etag");
  expect(provisioned).toBe(true);
  if (kind === "file")
    expect(await (await f.pod.fetch(url)).text()).toBe(
      replace ? "unapproved replacement" : "approved upload",
    );
});

it.each([
  "file",
  "folder",
])("round 55: an empty approved %s validator cannot become a fresh overwrite", async (kind) => {
  const f = await rdfPod();
  const url = kind === "folder" ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (kind === "folder") await f.pod.fetch(url, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    client.write(
      url,
      "",
      { contentType: kind === "folder" ? "text/turtle" : "text/plain", ifMatch: "" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
});
