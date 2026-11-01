// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import {
  accessControl,
  accessLabel,
  bindAccess,
  requireAccess,
} from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import {
  copyItem,
  listTrash,
  restoreItems,
  trashItems,
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

async function noDefaults(resource: string) {
  return aclBody(resource, false, false);
}

it.each([
  "no defaults",
  "unrelated defaults",
])("round 69: nearest ACL with %s governs an empty inherited projection", async (kind) => {
  const f = await rdfPod();
  const data = await parseRdf(await noDefaults(PRIVATE), "text/turtle");
  if (kind === "unrelated defaults")
    for (const rule of new AclResource(data, DataFactory).authorizations)
      new WacFields(rule as Term, data, DataFactory).iris(`${ACL}default`).add(PUBLIC);
  f.policies.set(`${PRIVATE}.policy`, await turtle(data));
  const state = await accessControl(f.fetch, ROOT).effective(`${PRIVATE}secret`);
  expect(requireAccess(state, `${PRIVATE}secret`).url).toBe(`${PRIVATE}.policy`);
  expect(requireAccess(state, `${PRIVATE}secret`).dataset.size).toBe(0);
  expect(accessLabel(state, `${PRIVATE}secret`, OWNER)).toBe("No one");
  expect(f.calls).not.toContainEqual({ url: `${ROOT}.policy`, method: "GET" });
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
});

it("round 69: the WAC fixture stops at the nearest existing ACL even without defaults", async () => {
  const f = await rdfPod();
  f.policies.set(`${PRIVATE}.policy`, await noDefaults(PRIVATE));
  expect((await f.anonymous(`${PUBLIC}placeholder`)).status).toBe(200);
  expect((await f.anonymous(`${PRIVATE}secret`)).status).toBe(403);
});

it.each([
  "Copy",
  "Move",
  "Rename",
  "folder Copy",
  "folder Move",
])("round 69: %s preserves a nearest ACL's empty default projection without publishing secrets", async (step) => {
  const f = await rdfPod();
  f.policies.set(`${PRIVATE}.policy`, await noDefaults(PRIVATE));
  const folder = step.startsWith("folder");
  const source = folder ? PRIVATE : `${PRIVATE}secret`;
  const target = folder
    ? `${PUBLIC}copied/`
    : step === "Rename"
      ? `${PRIVATE}renamed`
      : `${PUBLIC}copied`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.audit();
  if (step.includes("Move") || step === "Rename")
    await client.move(
      source,
      target,
      { kind: "preserve-source" },
      confirmationOptions(await client.stat(source)),
    );
  else await client.copy(source, target, { kind: "preserve-source" });
  expect(await (await f.pod.fetch(folder ? `${target}secret` : target)).text()).toBe(
    "secret contents",
  );
  expect((await f.anonymous(folder ? `${target}secret` : target)).status).toBe(403);
  expect(f.exposures).toEqual([]);
  if (step.includes("Move") || step === "Rename") expect(f.pod.has(source)).toBe(false);
});

it("round 69: installing a folder ACL with no defaults replaces the previous inherited default capture", async () => {
  const f = await rdfPod();
  const target = `${PUBLIC}folder/`;
  await f.pod.fetch(target, { method: "PUT", body: "" });
  const access = accessControl(f.fetch, ROOT);
  const binding = await bindAccess(access, target, target);
  f.policies.set(`${target}.policy`, await noDefaults(target));
  const policy = requireAccess(await access.read(`${target}.policy`), target);
  binding.installed(policy);
  await expect(binding.recheck()).resolves.toBeUndefined();
  expect(binding.identities.every(({ url }) => url === `${target}.policy`)).toBe(true);
});

it("round 69: Make a copy cannot turn a denied descendant into a public own ACL", async () => {
  const f = await rdfPod();
  f.policies.set(`${PRIVATE}.policy`, await noDefaults(PRIVATE));
  const source = `${PRIVATE}secret`;
  expect((await f.anonymous(source)).status).toBe(403);
  f.audit();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const target = await copyItem(client, await client.stat(source));
  expect(target).toBe(`${PRIVATE}Copy%20of%20secret`);
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect((await f.anonymous(target)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it("round 69: an own folder ACL blocks inherited Move widening even without default grants", async () => {
  const f = await rdfPod();
  f.policies.set(`${PRIVATE}.policy`, await noDefaults(PRIVATE));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  await client.move(
    PRIVATE,
    `${PUBLIC}moved/`,
    { kind: "confirm-move" },
    confirmationOptions(await client.stat(PRIVATE)),
  );
  expect(confirmAccess).not.toHaveBeenCalled();
  expect((await f.anonymous(`${PUBLIC}moved/secret`)).status).toBe(403);
  expect(f.pod.has(PRIVATE)).toBe(false);
});

it.each([
  "file",
  "folder",
])("round 69: shared %s partial Restore compares archived original access after refused Trash DELETE", async (kind) => {
  const f = await rdfPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared contents" });
  const originalPolicy = await aclBody(source, true);
  f.policies.set(`${source}.policy`, originalPolicy);
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
  expect(entries[0]?.status).toBe("partial");
  expect((await f.anonymous(entries[0]?.url as string)).status).toBe(403);
  const result = await restoreItems(client, DRIVE, entries);
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  expect(f.pod.has(entries[0]?.url as string)).toBe(false);
  expect(f.policies.get(`${source}.policy`)).toBe(originalPolicy);
  expect(await (await f.anonymous(content)).text()).toBe("shared contents");
});
