// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import {
  deleteForever,
  listTrash,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { expectPrivateRecovery } from "./drive-private-recovery";
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

it.each([
  "copy",
  "move",
  "inherited move",
])("round 56: %s retains confidential recovery with a missing ACL and hidden Link", async (step) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`,
    to = `${step === "inherited move" ? PRIVATE : PUBLIC}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      changed = true;
      f.policies.delete(`${to}.policy`);
      if (step === "inherited move")
        f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
      await f.pod.fetch(from, { method: "PUT", body: "edited source" });
    }
    if (changed && url === to) response.headers.delete("link");
    return response;
  });
  await expect(
    step === "copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, {
          kind: step === "inherited move" ? "confirm-move" : "preserve-source",
        }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  // Hidden/replaced discovery cannot authorize repairing the captured endpoint.
  // Missing discovery refuses clearing too. Preserve the other client's policy
  // and retain a private backup while surfacing the changed endpoint.
  expect(f.policies.has(`${to}.policy`)).toBe(false);
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
  await expectPrivateRecovery(f, "secret contents");
});

it("round 56: replacement compensation preserves an owner-and-Bob ACL installed after upload", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`,
    policy = `${url}.policy`;
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  const data = await parseRdf(await aclBody(url), "text/turtle");
  const bob = new WacFields(`${url}#bob`, data, DataFactory);
  bob.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  bob.iris(`${ACL}accessTo`).add(url);
  bob.iris(`${ACL}agent`).add(`${ROOT}bob#me`);
  bob.iris(`${ACL}mode`).add(`${ACL}Read`);
  const changed = await turtle(data);
  let uploaded = false;
  f.after(async (target, method, response) => {
    if (!uploaded && target === url && method === "PUT" && response.ok) {
      uploaded = true;
      f.policies.set(policy, changed);
    }
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(uploaded).toBe(true);
  expect(f.policies.get(policy)).toBe(changed);
  expect(f.calls).not.toContainEqual({ url: policy, method: "PUT" });
});

it.each([
  "copy",
  "rename",
])("round 56: %s refuses a concurrent destination ACL revocation before install", async (step) => {
  const f = await rdfPod();
  const from = `${PUBLIC}placeholder`,
    to = `${PUBLIC}copy`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const revoked = await aclBody(to);
  let installed = false;
  let created = false;
  let checks = 0;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.ok) created = true;
    // Install discovers the resource after the three binding HEADs.
    if (!installed && created && url === to && method === "HEAD" && ++checks === 4) {
      installed = true;
      f.policies.set(`${to}.policy`, revoked);
    }
    return response;
  });
  await expect(
    step === "copy"
      ? client.copy(from, to, { kind: "preserve-source" })
      : client.move(from, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(installed).toBe(true);
  expect(f.pod.has(from)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: `${to}.policy`, method: "PUT" });
  expect(f.policies.get(`${to}.policy`)).toBe(revoked);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it("round 56: Delete forever preserves a recreated empty recovery folder and its ACL", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "original" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  const replacement = await aclBody(entry.url, true);
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === `${entry.url}child` && method === "DELETE" && response.ok) {
      replaced = true;
      await f.pod.fetch(entry.url, { method: "DELETE" });
      await f.pod.fetch(entry.url, { method: "PUT", body: "" });
      f.policies.set(`${entry.url}.policy`, replacement);
    }
    return response;
  });
  const result = await deleteForever(client, DRIVE, [entry]);
  expect(replaced).toBe(true);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(f.policies.get(`${entry.url}.policy`)).toBe(replacement);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
});

it("round 56: partial Restore never adopts replacement recovery children after its first DELETE", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  for (const name of ["one", "two"])
    await f.pod.fetch(`${source}${name}`, { method: "PUT", body: `public ${name}` });
  f.policies.set(`${source}.policy`, await aclBody(source, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === `${source}two` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  await f.pod.fetch(`${source}two`, { method: "DELETE" });
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === `${entry.url}one` && method === "DELETE" && response.ok) {
      replaced = true;
      await f.pod.fetch(`${entry.url}two`, { method: "DELETE" });
      await f.pod.fetch(entry.url, { method: "DELETE" });
      await f.pod.fetch(`${entry.url}two`, { method: "PUT", body: "replacement secret" });
    }
    return response;
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(replaced).toBe(true);
  expect(result.done).toEqual([]);
  expect(f.pod.has(entry.url)).toBe(true);
  const publicRead = await f.anonymous(`${source}two`);
  expect(publicRead.ok && (await publicRead.text()) === "replacement secret").toBe(false);
});

it("round 56 shape a: copy preserves its caller-approved source validator across preflight", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const from = `${PRIVATE}secret`,
    to = `${PUBLIC}copy`;
  const selected = await client.stat(from);
  await f.pod.fetch(from, { method: "PUT", body: "replacement secret" });
  if (!selected.etag) throw new Error("Missing selected validator");
  const options = { ifMatch: selected.etag, sourceGuards: [] };
  await expect(client.copy(from, to, { kind: "preserve-source" }, options)).rejects.toMatchObject({
    kind: "conflict",
    status: 412,
  });
  expect(f.pod.has(to)).toBe(false);
});

it.each([
  "recursive remove",
  "move",
  "Restore",
  "partial Restore",
  "Delete forever",
  "Empty Trash",
])("round 56: %s keeps the approved parent when standard LDP provides no atomic receipt", async (step) => {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "original" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let target = source;
  let run: () => Promise<unknown>;
  if (["Restore", "partial Restore", "Delete forever", "Empty Trash"].includes(step)) {
    if (step === "partial Restore")
      f.intercept(async (url, init) =>
        url === `${source}child` && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    target = entry.url;
    run = () =>
      step.endsWith("Restore")
        ? restoreItems(client, DRIVE, [entry])
        : deleteForever(client, DRIVE, [entry]);
  } else
    run = () =>
      step === "move"
        ? client.move(source, `${PRIVATE}moved/`, { kind: "preserve-source" })
        : client.remove(source, { recursive: true });
  f.calls.length = 0;
  f.after(async (_url, _method, response) => {
    response.headers.delete("x-solid-drive-parent-validators");
    return response;
  });
  const result = await run().catch((error) => error);
  expect(result instanceof Error || (result as { failed: unknown[] }).failed.length > 0).toBe(true);
  expect(f.pod.has(target)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
});

it("round 56: replay evacuates its own PUT without overwriting a new sharing policy", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let puts = 0;
  const foreign = await aclBody(url, true);
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) {
      puts++;
      if (puts === 1) f.policies.set(`${url}.policy`, foreign);
      if (puts === 2) f.policies.set(`${url}.policy`, foreign);
    }
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected),
  ).rejects.toThrow();
  expect(puts).toBe(2);
  expect(f.policies.get(`${url}.policy`)).toBe(foreign);
  expect(await (await f.pod.fetch(url)).text()).toBe("");
  await expectPrivateRecovery(f, "secret contents");
});

it.each(
  ["file", "folder"].flatMap((kind) => ["own", "inherited"].map((sharing) => ({ kind, sharing }))),
)("round 56: unchanged shared $kind restores against archived $sharing grants after Trash DELETE is refused", async ({
  kind,
  sharing,
}) => {
  const f = await rdfPod();
  const source = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}shared/`;
  const file = kind === "file" ? source : `${source}child`;
  if (kind === "folder") await f.pod.fetch(file, { method: "PUT", body: "secret contents" });
  const shared = sharing === "own" ? source : PRIVATE;
  f.policies.set(`${shared}.policy`, await aclBody(shared, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === file && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await f.anonymous(file)).text()).toBe("secret contents");
  expect(f.pod.has(entry.url)).toBe(false);
});
