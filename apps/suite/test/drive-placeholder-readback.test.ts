// AUTHORED-BY Claude Opus 5.5
// sst-2vvz: Community Solid Server 7 answers a creating PUT with 201 and no ETag.
// Drive reads the empty placeholder back and adopts its strong validator only while
// the placeholder is still empty; anything else keeps the missing-validator refusal.
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const target = `${PRIVATE}report.txt`;

async function cssLikePod() {
  const f = await rdfPod();
  const ifMatch: (string | null)[] = [];
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "PUT")
      ifMatch.push(new Headers(init.headers).get("if-match"));
    return undefined;
  });
  return { f, ifMatch };
}

it("uploads when the placeholder PUT has no ETag but reads back empty with a strong one", async () => {
  const { f, ifMatch } = await cssLikePod();
  let readback: string | null = null;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET" && readback === null)
      readback = response.headers.get("etag");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt");
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  // The content PUT is conditional on the read-back placeholder's validator.
  expect(readback).toMatch(/^"/);
  expect(ifMatch).toEqual([null, readback]);
});

it("refuses to adopt the validator of a placeholder that changed before it was read back", async () => {
  const { f, ifMatch } = await cssLikePod();
  let raced = false;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201) {
      response.headers.delete("etag");
      // A concurrent writer replaces the empty placeholder before Drive reads it back.
      raced = true;
      await f.pod.fetch(target, {
        method: "PUT",
        body: "someone else's bytes",
        headers: { "content-type": "text/plain" },
      });
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(raced).toBe(true);
  expect(ifMatch).toEqual([null]);
  expect(await (await f.pod.fetch(target)).text()).toBe("someone else's bytes");
});

it("refuses a weak read-back validator", async () => {
  const { f, ifMatch } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET") response.headers.set("etag", 'W/"weak"');
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(ifMatch).toEqual([null]);
  expect(await (await f.pod.fetch(target)).text()).toBe("");
});

it("copies into a protected placeholder that reads back empty with a strong validator", async () => {
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.status === 201) response.headers.delete("etag");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" });
  expect(await (await f.pod.fetch(to)).text()).toBe(
    await (await f.pod.fetch(`${PRIVATE}secret`)).text(),
  );
  expect((await f.anonymous(to)).status).toBe(403);
});

it("uploads when neither the placeholder PUT nor the content PUT returns an ETag", async () => {
  const { f, ifMatch } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok) response.headers.delete("etag");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt");
  expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
  expect(ifMatch).toHaveLength(2);
});

it.each([
  ["different bytes of the same length", "SECRET CONTENTS"],
  ["a different length", "secret contents, edited"],
])("does not certify a content PUT whose read-back holds %s", async (_case, replacement) => {
  const { f } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url !== target || method !== "PUT" || !response.ok) return response;
    response.headers.delete("etag");
    if (response.status !== 201)
      await f.pod.fetch(target, {
        method: "PUT",
        body: replacement,
        headers: { "content-type": "text/plain" },
      });
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toThrow();
  expect(await (await f.pod.fetch(target)).text()).toBe(replacement);
});

it("keeps the missing-validator refusal when the read-back itself fails", async () => {
  const { f, ifMatch } = await cssLikePod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.status === 201)
      response.headers.delete("etag");
    if (url === target && method === "GET") return new Response(null, { status: 503 });
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(
    uploadFile(client, PRIVATE, new Blob(["secret contents"]), "report.txt"),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(ifMatch).toEqual([null]);
});
