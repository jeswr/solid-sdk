// AUTHORED-BY Claude Opus 5.5
// sst-2vvz: Community Solid Server 7 answers PUTs (201 create, 205 replace) without an ETag.
// Drive reads the file back. A read-back validator certifies "these are exactly our bytes and
// media type" but is never a PUT receipt: it may be the next write's If-Match and the identity
// for the non-destructive post-write check, never the basis of compensation or rollback.
import { expect, it } from "vitest";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const target = `${PRIVATE}report.txt`;
const existing = `${PRIVATE}secret`;

async function cssLikePod(url = target) {
  const f = await rdfPod();
  const puts: { ifMatch: string | null; body: string }[] = [];
  f.intercept(async (requested, init) => {
    if (requested === url && init?.method === "PUT")
      puts.push({
        ifMatch: new Headers(init.headers).get("if-match"),
        body: init.body instanceof Blob ? await init.body.text() : String(init.body ?? ""),
      });
    return undefined;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  return { f, puts, client };
}

const stripPutEtags =
  (url: string, status?: number) =>
  async (requested: string, method: string, response: Response) => {
    if (
      requested === url &&
      method === "PUT" &&
      response.ok &&
      (!status || response.status === status)
    )
      response.headers.delete("etag");
    return response;
  };

it("uploads when the placeholder PUT has no ETag but reads back empty with a strong one", async () => {
  const { f, puts, client } = await cssLikePod();
  let readBack: string | null = null;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET" && readBack === null)
      readBack = response.headers.get("etag");
    return response;
  });
  await uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt");
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(readBack).toMatch(/^"/);
  expect(puts.map(({ ifMatch }) => ifMatch)).toEqual([null, readBack]);
});

it("uploads when neither the placeholder PUT nor the content PUT returns an ETag", async () => {
  const { f, puts, client } = await cssLikePod();
  f.after(stripPutEtags(target));
  await uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt");
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(puts).toHaveLength(2);
});

it("replaces a file when the content PUT returns no ETag", async () => {
  const { f, client } = await cssLikePod(existing);
  f.after(stripPutEtags(existing));
  const selected = await client.stat(existing);
  await uploadFile(client, PRIVATE, new Blob(["new contents"]), "secret", "replace", selected);
  expect(await (await f.pod.fetch(existing)).text()).toBe("new contents");
});

it("never rolls back with a read-back validator that an identical concurrent write produced", async () => {
  const { f, puts, client } = await cssLikePod(existing);
  let raced = false;
  let failCheck = false;
  let identityChecked = false;
  f.after(async (url, method, response) => {
    if (url !== existing) return response;
    if (method === "PUT" && response.ok && !raced) {
      response.headers.delete("etag");
      // Another writer stores the same bytes, so the read-back sees THEIR validator.
      raced = true;
      await f.pod.fetch(existing, {
        method: "PUT",
        body: "new contents",
        headers: { "content-type": "text/plain" },
      });
      failCheck = true;
    }
    return response;
  });
  f.intercept(async (url, init) => {
    // One intercept records every PUT (it replaces cssLikePod's recorder) and fails only
    // the first post-write identity HEAD, so a leaked receipt could still roll back.
    if (url === existing && init?.method === "PUT")
      puts.push({
        ifMatch: new Headers(init.headers).get("if-match"),
        body: init.body instanceof Blob ? await init.body.text() : String(init.body ?? ""),
      });
    if (
      failCheck &&
      url === existing &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      failCheck = false;
      identityChecked = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const selected = await client.stat(existing);
  const error = await uploadFile(
    client,
    PRIVATE,
    // Same bytes and media type as the other writer, so the read-back certifies.
    new Blob(["new contents"], { type: "text/plain" }),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(raced).toBe(true);
  // The read-back certified the other writer's validator and the identity check used it.
  expect(identityChecked).toBe(true);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  // Compensation saw no receipt: the other writer's update is not reverted.
  expect(await (await f.pod.fetch(existing)).text()).toBe("new contents");
  expect(puts.filter(({ body }) => body === "secret contents")).toEqual([]);
});

it("refuses to adopt the validator of a placeholder that changed before it was read back", async () => {
  const { f, puts, client } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201) {
      response.headers.delete("etag");
      await f.pod.fetch(target, {
        method: "PUT",
        body: "someone else's bytes",
        headers: { "content-type": "text/plain" },
      });
    }
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(puts.map(({ ifMatch }) => ifMatch)).toEqual([null]);
  expect(await (await f.pod.fetch(target)).text()).toBe("someone else's bytes");
});

it("certifies an empty placeholder read-back whose response has no body", async () => {
  const { f, puts, client } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET" && puts.length === 1)
      return new Response(null, { status: 200, headers: response.headers });
    return response;
  });
  await uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt");
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(puts).toHaveLength(2);
  expect(puts[1]?.ifMatch).toMatch(/^"/);
});

it.each([
  ["a weak validator", (response: Response) => response.headers.set("etag", 'W/"weak"')],
  ["no validator", (response: Response) => response.headers.delete("etag")],
  [
    "a different media type",
    (response: Response) => response.headers.set("content-type", "text/html"),
  ],
  ["a failed read", () => new Response(null, { status: 503 })],
  [
    "a transport error",
    () => {
      throw new TypeError("read-back lost");
    },
  ],
  [
    "a body that errors mid-stream",
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new TypeError("body lost"));
          },
        }),
        { headers: { etag: '"x"', "content-type": "text/plain" } },
      ),
  ],
])("does not certify a placeholder read-back with %s", async (_case, alter) => {
  const { f, puts, client } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET")
      return (alter(response) as Response | undefined) ?? response;
    return response;
  });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(puts.map(({ ifMatch }) => ifMatch)).toEqual([null]);
  expect(await (await f.pod.fetch(target)).text()).toBe("");
});

it.each([
  ["different bytes of the same length", "NEW CONTENTS"],
  ["more bytes", "new contents, edited by someone else"],
  ["fewer bytes", "new"],
])("does not certify a content read-back holding %s, and keeps recovery", async (_case, replacement) => {
  const { f, client } = await cssLikePod(existing);
  f.after(async (url, method, response) => {
    if (url !== existing || method !== "PUT" || !response.ok) return response;
    response.headers.delete("etag");
    await f.pod.fetch(existing, {
      method: "PUT",
      body: replacement,
      headers: { "content-type": "text/plain" },
    });
    return response;
  });
  const selected = await client.stat(existing);
  const error = await uploadFile(
    client,
    PRIVATE,
    // Same media type as the other writer, so only the bytes can differ.
    new Blob(["new contents"], { type: "text/plain" }),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(await (await f.pod.fetch(existing)).text()).toBe(replacement);
});

it("treats a content read-back that throws as uncertified, never as a raw error", async () => {
  const { f, client } = await cssLikePod(existing);
  let written = false;
  f.after(async (url, method, response) => {
    if (url === existing && method === "PUT" && response.ok) {
      written = true;
      response.headers.delete("etag");
    }
    return response;
  });
  f.intercept(async (url, init) => {
    if (written && url === existing && (init?.method ?? "GET") === "GET" && !init?.method)
      throw new TypeError("read-back lost");
    return undefined;
  });
  const selected = await client.stat(existing);
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob(["new contents"]),
    "secret",
    "replace",
    selected,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect((error as DrivePartialFailureError).retainedDestinations.length).toBeGreaterThan(0);
});

it("still refuses copies into a placeholder without a PUT receipt (read-back covers uploads only)", async () => {
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  f.after(stripPutEtags(to, 201));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(await (await f.pod.fetch(`${PRIVATE}secret`)).text()).toBe("secret contents");
  expect(await (await f.pod.fetch(to)).text()).toBe("");
});
