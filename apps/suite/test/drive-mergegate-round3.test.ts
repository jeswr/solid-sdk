// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { aclBody, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

it("same-folder rename with a hidden ACL Link refuses before writes and retains private bytes", async () => {
  const f = await wacPod();
  const from = `${PUBLIC}secret`,
    to = `${PUBLIC}renamed`;
  await f.pod.fetch(from, { method: "PUT", body: "secret contents" });
  f.policies.set(`${from}.policy`, await aclBody(from));
  f.after(async (url, method, response) => {
    if (url !== from || !["HEAD", "GET"].includes(method)) return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  expect((await f.anonymous(from)).status).toBe(403);
  f.audit();
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow(
    "can't confirm who can access",
  );
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(false);
  expect(f.exposures).toEqual([]);
});

it("same-folder rename with hidden ACL Link cannot authorize unknown access", async () => {
  const f = await wacPod();
  const from = `${PUBLIC}secret`,
    to = `${PUBLIC}renamed`;
  await f.pod.fetch(from, { method: "PUT", body: "secret contents" });
  f.policies.set(`${from}.policy`, await aclBody(from));
  f.after(async (url, method, response) => {
    if (url !== from || method !== "GET") return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow("Private access");
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(false);
});

it("same-folder rename preserves a discovered own ACL and rewrites accessTo before secret bytes", async () => {
  const f = await wacPod();
  const from = `${PUBLIC}secret`,
    to = `${PUBLIC}renamed`;
  await f.pod.fetch(from, { method: "PUT", body: "secret contents" });
  const original = await aclBody(from);
  f.policies.set(`${from}.policy`, original);
  f.audit();
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await client.move(from, to, { kind: "confirm-move" });
  expect(confirmAccess).not.toHaveBeenCalled();
  expect((await f.anonymous(to)).status).toBe(403);
  expect(f.policies.get(`${to}.policy`)).toContain(`<${to}>`);
  expect(f.policies.get(`${to}.policy`)).not.toContain(`<${from}>`);
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { relocate, sameGraph } = await import("../src/apps/drive/lib/client/rdf");
  const expected = relocate(await parseRdf(original, "text/turtle"), [
    [`${from}.policy`, `${to}.policy`],
    [from, to],
  ]);
  expect(
    sameGraph(expected, await parseRdf(f.policies.get(`${to}.policy`) as string, "text/turtle")),
  ).toBe(true);
  expect(f.exposures).toEqual([]);
});

it("same-folder rename checks unknown effective access even when own ACL is positively absent", async () => {
  const f = await wacPod();
  f.after(async (url, method, response) => {
    if (url !== PUBLIC || method !== "HEAD") return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await expect(
    client.move(`${PUBLIC}placeholder`, `${PUBLIC}renamed`, { kind: "confirm-move" }),
  ).rejects.toThrow("Private access");
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
});

it("explicit confirmation cannot authorize unknown same-folder rename", async () => {
  const f = await wacPod();
  const from = `${PUBLIC}placeholder`,
    to = `${PUBLIC}renamed`;
  f.after(async (url, method, response) => {
    if (url !== from || method !== "GET") return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow("Private access");
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.pod.has(to)).toBe(false);
  expect(f.pod.has(from)).toBe(true);
});

it.each([
  "copy",
  "trash",
  "restore",
  "undo",
])("%s refuses hidden own access before copying or deleting the source", async (operation) => {
  const f = await wacPod();
  const { trashItems, restoreItems } = await import("../src/apps/drive/lib/operations/operations");
  const { OWNER, DRIVE, PRIVATE } = await import("./drive-wac-pod");
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  let from = `${PRIVATE}secret`;
  let entry: Awaited<ReturnType<typeof trashItems>>["done"][number] | undefined;
  if (operation === "restore") {
    entry = (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).done[0];
    if (!entry) throw new Error("Missing trash entry");
    from = entry.url;
  }
  f.after(async (url, method, response) => {
    if (url !== from || !["GET", "HEAD"].includes(method)) return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  const start = f.calls.length;
  if (operation === "copy")
    await expect(client.copy(from, `${PUBLIC}secret`, { kind: "preserve-source" })).rejects.toThrow(
      "can't confirm who can access",
    );
  else if (operation === "trash") {
    const result = await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
    expect(result.failed[0]?.error).toMatchObject({ kind: "private-access-unavailable" });
  } else if (operation === "restore" && entry) {
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result.failed[0]?.error).toMatchObject({ kind: "private-access-unavailable" });
  } else {
    const { moveWithValidator } = await import("../src/apps/drive/state/undo");
    await expect(
      moveWithValidator(
        { storageUrl: ROOT, fetch: f.fetch },
        from,
        `${PUBLIC}secret`,
        (await client.stat(from)).etag as string,
      ),
    ).rejects.toThrow("can't confirm who can access");
  }
  expect(f.pod.has(from)).toBe(true);
  expect(f.calls.slice(start).some(({ url, method }) => url === from && method === "DELETE")).toBe(
    false,
  );
  expect(f.pod.has(`${PUBLIC}secret`)).toBe(false);
});
