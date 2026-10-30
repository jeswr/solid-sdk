// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { parseRdf } from "@jeswr/fetch-rdf";
import { LiteralAs, LiteralFrom, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { DriveAccessChangedError } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  DriveError,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import {
  deleteForever,
  listTrash,
  moveItems,
  recentFiles,
  renameItem,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import { formatModified, viewItems } from "../src/apps/drive/lib/view/view";
import { nonWacPod } from "./drive-non-wac-pod";
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

const steps = [
  "Move",
  "Rename",
  "Trash",
  "Restore",
  "partial Restore",
  "remove",
  "Delete forever",
  "Empty Trash",
] as const;
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

it("round 64: late endpoint refusal reports retained private bytes when recovery allocation fails", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  const alternate = `${from}foreign.policy`;
  const foreign = `${await aclBody(to)}\n# concurrent owner-only policy`;
  const unavailable = new Error("Recovery allocation unavailable");
  let deletionPending = false;
  let changed = false;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (
      typeof key === "string" &&
      key.startsWith("delete-request:") &&
      (value as { source: string }).source === from
    )
      deletionPending = true;
    return put.call(this, value, key);
  });
  const uuid = crypto.randomUUID.bind(crypto);
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    if (changed) throw unavailable;
    return uuid();
  });
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (
      deletionPending &&
      !changed &&
      String(input) === from &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      f.policies.set(alternate, await aclBody(from));
      f.policies.set(`${to}.policy`, foreign);
    }
    if (changed && String(input) === from)
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  await expect(
    client.move(
      from,
      to,
      { kind: "preserve-source" },
      { ifMatch: (await client.stat(from)).etag as string },
    ),
  ).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: [to],
    cause: unavailable,
  });
  expect(changed).toBe(true);
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
  expect(await (await f.pod.fetch(to)).text()).toBe("secret contents");
  expect((await f.anonymous(to)).status).toBe(403);
  expect(f.policies.get(`${to}.policy`)).toBe(foreign);
  expect(f.calls.filter(({ method }) => method === "DELETE")).toEqual([]);
});

it("round 64/73: a stale Trash traversal stops without refreshing descendant captures", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toEqual([]);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry?.etag) throw new Error("Missing selected recovery validator");
  const missing = new DriveError("not-found", 404, `${entry.url}/stale-child`);
  const remove = vi.spyOn(client, "remove").mockRejectedValue(missing);
  const result = await deleteForever(client, DRIVE, [entry]);
  expect(result.failed).toEqual([
    {
      url: entry.url,
      error: expect.objectContaining({
        message: "The folder changed during deletion. Refresh Trash and confirm deletion again.",
        cause: missing,
      }),
    },
  ]);
  expect(remove).toHaveBeenCalledTimes(1);
  for (const [url, options] of remove.mock.calls) {
    expect(url).toBe(entry.url);
    expect(options?.ifMatch).toBe(entry.etag);
  }
  expect(await (await f.pod.fetch(entry.url)).text()).toBe("secret contents");
});

it.each(
  steps.flatMap((step) =>
    ["file", "folder"].flatMap((kind) =>
      [false, true].map((hiddenLink) => ({ step, kind, hiddenLink })),
    ),
  ),
)("round 64: $step retains $kind recovery when the final HEAD changes ACL endpoint (404 hides Link: $hiddenLink)", async ({
  step,
  kind,
  hiddenLink,
}) => {
  const f = await rdfPod();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const source = `${PUBLIC}shared${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(source, { method: "PUT", body: kind === "folder" ? "" : "shared contents" });
  if (kind === "folder")
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "shared contents" });
  let changed = false;
  let enabled = false;
  let deletionPending = false;
  let target = source;
  const alternate = () => `${target}foreign.policy`;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const response = await f.fetch(input, init);
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    if (
      enabled &&
      deletionPending &&
      !changed &&
      url === target &&
      method === "HEAD" &&
      headers.has("if-match")
    ) {
      changed = true;
      f.policies.set(alternate(), await aclBody(target));
    }
    if (changed && url === target) response.headers.set("link", `<${alternate()}>; rel="acl"`);
    return response;
  };
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: http,
    ...(step === "Rename" ? {} : { webId: OWNER }),
  });
  let selected = await client.stat(source);
  let run: () => Promise<unknown>;
  if (["Restore", "partial Restore", "Delete forever", "Empty Trash"].includes(step)) {
    if (step === "partial Restore")
      f.intercept(async (url, init) =>
        url === source && init?.method === "DELETE"
          ? new Response(null, { status: 403 })
          : undefined,
      );
    await trashItems(client, DRIVE, [selected], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    target = entry.url;
    run = () =>
      step === "Delete forever" || step === "Empty Trash"
        ? deleteForever(client, DRIVE, [entry])
        : restoreItems(client, DRIVE, [entry]);
  } else {
    selected = await client.stat(source);
    run = () =>
      step === "Move"
        ? moveItems(client, [selected], `${PUBLIC}moved/`)
        : step === "Rename"
          ? renameItem(client, selected, "renamed")
          : step === "Trash"
            ? trashItems(client, DRIVE, [selected], { webId: OWNER })
            : client.remove(source, {
                recursive: kind === "folder",
                ifMatch: selected.etag as string,
              });
  }
  f.intercept(async (url, init) => {
    if (changed && url === target && init?.method === "DELETE") {
      const response = await f.pod.fetch(url, init);
      if (response.ok) f.policies.delete(alternate());
      return response;
    }
    return undefined;
  });
  f.calls.length = 0;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (
      typeof key === "string" &&
      key.startsWith("delete-request:") &&
      (value as { source: string }).source === target
    )
      deletionPending = true;
    return put.call(this, value, key);
  });
  enabled = true;
  const result = await run().catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(
    result instanceof Error ||
      (typeof result === "object" &&
        result !== null &&
        "failed" in result &&
        (result as { failed: unknown[] }).failed.length > 0),
  ).toBe(true);
  expect(f.pod.has(target)).toBe(true);
  expect(f.policies.has(alternate())).toBe(true);
  expect(f.policies.get(alternate())).toBe(await aclBody(target));
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  if (step === "Move" || step === "Rename") {
    const destination =
      step === "Move"
        ? `${PUBLIC}moved/shared${kind === "folder" ? "/" : ""}`
        : `${PUBLIC}renamed${kind === "folder" ? "/" : ""}`;
    expect((await f.anonymous(destination)).status).not.toBe(200);
  }
  if (step === "Trash" || step === "partial Restore") {
    const [entry] = await listTrash(client, DRIVE);
    expect(entry).toBeDefined();
  }
  if (result instanceof DrivePartialFailureError)
    expect(result.unverifiedSources).toContain(target);
});

it.each([
  "file",
  "folder",
])("round 64: Move requires a captured private recovery owner before copying a shared %s", async (kind) => {
  const f = await rdfPod();
  const target = `${PUBLIC}shared${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(target, { method: "PUT", body: kind === "folder" ? "" : "shared" });
  if (kind === "folder") await f.pod.fetch(`${target}child`, { method: "PUT", body: "shared" });
  const data = await parseRdf(f.policies.get(`${ROOT}.policy`) as string, "text/turtle");
  new WacFields(`${ROOT}#owner`, data, DataFactory).iris(`${ACL}mode`).delete(`${ACL}Control`);
  f.policies.set(`${ROOT}.policy`, await turtle(data));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.move(
      target,
      `${PUBLIC}copy${kind === "folder" ? "/" : ""}`,
      { kind: "confirm-move" },
      { ifMatch: (await client.stat(target)).etag as string },
    ),
  ).rejects.toMatchObject({ cause: "Recovery owner unavailable" });
  expect(f.pod.has(target)).toBe(true);
  expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
});

it.each([
  false,
  true,
])("round 64: remove retains the caller's final header assertion (recursive: %s)", async (recursive) => {
  const f = await rdfPod();
  const target = recursive ? `${PUBLIC}guarded/` : `${PUBLIC}file`;
  await f.pod.fetch(target, { method: "PUT", body: recursive ? "" : "captured" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(target);
  const check = vi.fn((): undefined => {
    throw new DriveAccessChangedError(["The confirmed endpoint changed"]);
  });
  await expect(
    client.remove(target, {
      recursive,
      ifMatch: selected.etag as string,
      commit: { verifyHeaders: check },
    }),
  ).rejects.toThrow("access policy changed");
  expect(check).toHaveBeenCalledTimes(1);
  expect(f.pod.has(target)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
});

it.each([
  "ACP",
  "unreadable ACL",
] as const)("round 64: explicit deletion pins discovery even on %s storage", async (model) => {
  const target = `${ROOT}file`;
  const f = nonWacPod(model, ROOT, target);
  vi.stubGlobal("indexedDB", new IDBFactory());
  let deletionPending = false;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (
      typeof key === "string" &&
      key.startsWith("delete-request:") &&
      (value as { source: string }).source === target
    )
      deletionPending = true;
    return put.call(this, value, key);
  });
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (
      String(input) === target &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match") &&
      deletionPending
    )
      response.headers.set(
        "link",
        `<${target}.replacement.acr>; rel="${model === "ACP" ? "http://www.w3.org/ns/solid/acp#accessControl" : "acl"}"`,
      );
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const selected = await client.stat(target);
  await expect(client.remove(target, { ifMatch: selected.etag as string })).rejects.toThrow(
    "access policy changed",
  );
  expect(f.has(target)).toBe(true);
  expect(f.calls.filter(({ method }) => method === "DELETE")).toEqual([]);
});

it.each([
  "file",
  "folder",
])("round 64: overwrite refuses a changed final ACL endpoint for a %s", async (kind) => {
  const f = await rdfPod();
  const target = `${PUBLIC}overwrite${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(target, { method: "PUT", body: kind === "folder" ? "" : "confirmed bytes" });
  const alternate = `${target}foreign.policy`;
  let changed = false;
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (
      !changed &&
      String(input) === target &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      f.policies.set(alternate, await aclBody(target, true));
    }
    if (changed && String(input) === target)
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const approved = await client.stat(target);
  f.calls.length = 0;
  await expect(
    client.write(
      target,
      kind === "folder" ? "" : "new secret bytes",
      {
        contentType: kind === "folder" ? "text/turtle" : "text/plain",
        ifMatch: approved.etag as string,
      },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "PUT" });
  expect((await f.pod.fetch(target, { method: "HEAD" })).headers.get("etag")).toBe(approved.etag);
  expect(f.policies.get(alternate)).toBe(await aclBody(target, true));
});

it.each([
  "file",
  "folder",
])("round 64: partial Restore accepts the archived shared %s after Trash DELETE was refused", async (kind) => {
  const f = await rdfPod();
  const source = `${PUBLIC}shared${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(source, { method: "PUT", body: kind === "folder" ? "" : "shared contents" });
  if (kind === "folder")
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "shared contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === (kind === "folder" ? `${source}child` : source) && init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(source)).status).toBe(200);
  expect(f.pod.has(entry.url)).toBe(false);
});

it("round 64: Unix stat:mtime populates Modified, date filters and Recent through the real WAC listing", async () => {
  const f = await rdfPod();
  const now = new Date("2026-10-30T12:00:00Z");
  const epoch = now.getTime() / 1000;
  const source = `${PUBLIC}epoch.txt`;
  await f.pod.fetch(source, { method: "PUT", body: "epoch" });
  // Supply only Unix stat metadata for this child in the actual server listing.
  f.after(async (url, method, response) => {
    if (url !== PUBLIC || method !== "GET" || !response.ok) return response;
    const listing = await parseRdf(await response.text(), "text/turtle");
    const resource = new WacFields(source, listing, DataFactory);
    SetFrom.subjectPredicate(
      resource,
      "http://purl.org/dc/terms/modified",
      TermAs.term,
      TermFrom.itself,
    ).clear();
    SetFrom.subjectPredicate(
      resource,
      "http://www.w3.org/ns/posix/stat#mtime",
      LiteralAs.number,
      LiteralFrom.integer,
    ).clear();
    SetFrom.subjectPredicate(
      resource,
      "http://www.w3.org/ns/posix/stat#mtime",
      LiteralAs.number,
      LiteralFrom.integer,
    ).add(epoch);
    return new Response(await turtle(listing), { headers: response.headers });
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const item = (await client.list(PUBLIC)).find(({ url }) => url === source);
  expect(item?.modified).toEqual(now);
  expect(formatModified(item?.modified, now)).toBe("Just now");
  expect(viewItems(item ? [item] : [], { modified: "today", now })).toHaveLength(1);
  expect((await recentFiles(client, [PUBLIC])).map(({ url }) => url)).toContain(source);
});
