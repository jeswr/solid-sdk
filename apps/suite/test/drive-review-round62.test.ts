// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { accessControl, bindAccess } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import {
  copyItem,
  listTrash,
  moveItems,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT } from "./drive-wac-pod";

it("round 62: a binding rejects inconsistent resource and default ACL validators", async () => {
  const f = await rdfPod();
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === `${PRIVATE}.policy` && method === "GET") {
      changed = true;
      f.policies.set(url, `${f.policies.get(url)}\n# another revision\n`);
    }
    return response;
  });
  await expect(bindAccess(accessControl(f.fetch, ROOT), PRIVATE, PRIVATE)).rejects.toMatchObject({
    kind: "private-access-unavailable",
  });
  expect(changed).toBe(true);
});

it("round 62: an inherited policy's validator remains pinned even when its audience is unchanged", async () => {
  const f = await rdfPod();
  const binding = await bindAccess(
    accessControl(f.fetch, ROOT),
    `${PRIVATE}secret`,
    `${PRIVATE}secret`,
  );
  f.policies.set(
    `${PRIVATE}.policy`,
    `${f.policies.get(`${PRIVATE}.policy`)}\n# another revision\n`,
  );
  await expect(binding.recheck()).rejects.toMatchObject({ kind: "private-access-unavailable" });
});

it.each([
  "endpoint",
  "validator",
])("round 62: a captured inherited %s cannot be replaced while binding", async (change) => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const from = `${PRIVATE}secret`;
  const captured = await access.effective(from);
  if (change === "endpoint") {
    const next = `${PRIVATE}other.policy`;
    f.policies.set(next, await aclBody(PRIVATE));
    f.after(async (url, method, response) => {
      if (url === PRIVATE && method === "HEAD")
        response.headers.set("link", `<${next}>; rel="acl"`);
      return response;
    });
  } else
    f.policies.set(
      `${PRIVATE}.policy`,
      `${f.policies.get(`${PRIVATE}.policy`)}\n# another revision\n`,
    );
  await expect(bindAccess(access, from, from, false, captured)).rejects.toMatchObject({
    kind: "private-access-unavailable",
  });
});

it("round 62: undiscovered captured access cannot be replaced with fresh discovery", async () => {
  const f = await rdfPod();
  await expect(
    bindAccess(accessControl(f.fetch, ROOT), `${PRIVATE}secret`, `${PRIVATE}secret`, false, {
      status: "unknown",
      cause: "Link was missing",
    }),
  ).rejects.toMatchObject({ kind: "private-access-unavailable", cause: "Link was missing" });
});

it("round 62: mergeContainer binds inherited copied grants to the same policy capture", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}inherited/`;
  const to = `${PUBLIC}merged/`;
  await f.pod.fetch(from, { method: "PUT", body: "" });
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const privatePolicy = await aclBody(PRIVATE);
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === `${PRIVATE}.policy` && method === "GET") {
      changed = true;
      f.policies.set(url, privatePolicy);
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(client.mergeContainer(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "private-access-unavailable",
  });
  expect(changed).toBe(true);
  expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
});

it.each(
  ["missing", "weak"].flatMap((receipt) =>
    ["Upload", "Replace"].map((step) => ({ receipt, step })),
  ),
)("round 62: $step retains captured bytes without adopting a $receipt PUT receipt", async ({
  receipt,
  step,
}) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const url = `${PRIVATE}${step === "Upload" ? "new" : "secret"}`;
  const selected = await client.stat(`${PRIVATE}secret`);
  f.after(async (target, method, response) => {
    if (
      target === url &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(url)).text()) === "our upload"
    ) {
      if (receipt === "missing") response.headers.delete("etag");
      else response.headers.set("etag", 'W/"weak"');
    }
    return response;
  });
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["our upload"]),
    step === "Upload" ? "new" : "secret",
    step === "Upload" ? "fail" : "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const bodies: string[] = [];
  for (const target of (error as DrivePartialFailureError).retainedDestinations) {
    bodies.push(await (await f.pod.fetch(target)).text());
    expect((await f.anonymous(target)).status).toBe(403);
  }
  expect(bodies).toContain("our upload");
  if (step === "Replace") expect(bodies).toContain("secret contents");
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
});

it.each(
  [
    "Rename",
    "Move",
    "Copy",
    "folder Rename",
    "folder Move",
    "folder Copy",
    "mergeContainer",
  ].flatMap((step) => ["endpoint", "validator"].map((change) => ({ step, change }))),
)("round 62: $step rejects a copied policy whose $change disagrees with its binding before writing", async ({
  step,
  change,
}) => {
  const f = await rdfPod();
  const folder = step.startsWith("folder") || step === "mergeContainer";
  const from = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) {
    await f.pod.fetch(from, { method: "PUT", body: "" });
    await f.pod.fetch(`${from}confidential-name`, { method: "PUT", body: "secret contents" });
  }
  const shared = await aclBody(from, true);
  const privatePolicy = await aclBody(from);
  const oldEndpoint = `${from}old.policy`;
  f.policies.set(`${from}.policy`, shared);
  f.policies.set(oldEndpoint, shared);
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  const selected = await client.stat(from);
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      response.ok &&
      ((change === "endpoint" && url === from && method === "GET") ||
        (change === "validator" && url === `${from}.policy` && method === "GET"))
    ) {
      changed = true;
      if (change === "endpoint") response.headers.set("link", `<${oldEndpoint}>; rel="acl"`);
      f.policies.set(`${from}.policy`, privatePolicy);
    }
    return response;
  });
  const start = f.calls.length;
  const result = await (step.endsWith("Rename")
    ? renameItem(client, selected, "renamed")
    : step.endsWith("Move")
      ? moveItems(client, [selected], PUBLIC)
      : step.endsWith("Copy")
        ? copyItem(client, selected)
        : client.mergeContainer(
            from,
            `${PUBLIC}merged/`,
            { kind: "preserve-source" },
            { ifMatch: selected.etag as string },
          )
  ).catch((error: unknown) => error);
  const error = step.endsWith("Move")
    ? (result as Awaited<ReturnType<typeof moveItems>>).failed[0]?.error
    : result;
  expect(changed).toBe(true);
  expect(error).toMatchObject({ kind: "private-access-unavailable" });
  expect(
    f.calls.slice(start).filter(({ method }) => method === "PUT" || method === "DELETE"),
  ).toEqual([]);
  expect(confirmAccess).not.toHaveBeenCalled();
  expect((await f.anonymous(from)).status).toBe(403);
  expect((await client.stat(from)).etag).toBe(selected.etag);
});

it.each(
  ["Upload", "Replace", "Keep both", "standalone overwrite", "owner-only overwrite"].flatMap(
    (step) =>
      [false, true].flatMap((hiddenLink) =>
        [false, true].map((ignoresHead) => ({ step, hiddenLink, ignoresHead })),
      ),
  ),
)("round 62: $step reports a replaced PUT and retains recovery (404 hides Link: $hiddenLink, HEAD ignores If-Match: $ignoresHead)", async ({
  step,
  hiddenLink,
  ignoresHead,
}) => {
  const f = await rdfPod();
  const original = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(original);
  let changed = false;
  let target = "";
  f.intercept(async (url, init) => {
    if (ignoresHead && changed && url === target && init?.method === "HEAD") {
      const response = await f.pod.fetch(url, { method: "HEAD" });
      response.headers.delete("x-solid-demo-access-control");
      response.headers.set("link", `<${url}.policy>; rel="acl"`);
      return response;
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    if (
      !changed &&
      method === "PUT" &&
      response.ok &&
      !url.endsWith("/") &&
      !url.endsWith(".policy") &&
      (await (await f.pod.fetch(url)).text()) === "our upload"
    ) {
      changed = true;
      target = url;
      await f.pod.fetch(url, { method: "PUT", body: "another client's bytes" });
    }
    return response;
  });
  const result = await (step.endsWith("overwrite")
    ? client.write(
        original,
        "our upload",
        { contentType: "text/plain", ifMatch: selected.etag as string },
        { kind: step === "owner-only overwrite" ? "owner-only" : "protect-ancestors" },
      )
    : uploadFile(
        client,
        PRIVATE,
        new Blob(["our upload"]),
        step === "Upload" ? "new" : "secret",
        step === "Upload" ? "fail" : step === "Replace" ? "replace" : "keep-both",
        selected,
      )
  ).catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(result).toBeInstanceOf(DrivePartialFailureError);
  expect(await (await f.pod.fetch(target)).text()).toBe("another client's bytes");
  const recovered: string[] = [];
  for (const url of (result as DrivePartialFailureError).retainedDestinations) {
    recovered.push(await (await f.pod.fetch(url)).text());
    expect((await f.anonymous(url)).status).toBe(403);
  }
  expect(recovered).toContain("our upload");
  if (step === "Replace" || step.endsWith("overwrite"))
    expect(recovered).toContain("secret contents");
});

it.each([
  "file",
  "folder",
])("round 62: partial Restore compares the archived shared %s after refused Trash DELETE", async (kind) => {
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
