// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it } from "vitest";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
  DriveUploadError,
} from "../src/apps/drive/lib/client/client";
import { isomorphicGraph } from "../src/apps/drive/lib/client/rdf";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

const target = `${PRIVATE}report.ttl`;
const sent = '@prefix ex: <https://example.org/>. <> ex:p [ ex:q "value" ]; ex:r <#item>.';
const stored = `
  @prefix other: <https://example.org/> .
  _:server other:q "value" .
  <${target}> other:r <${target}#item> ; other:p _:server .
`;

/** CSS-like PUTs have no receipt; GETs reserialize RDF while retaining the stored ETag. */
async function cssRdfPod(
  returned: string | null = stored,
  responseType: string | null = "text/turtle",
) {
  const f = await rdfPod();
  const puts: { ifMatch: string | null }[] = [];
  const readBacks: { accept: string | null; afterContent: boolean }[] = [];
  let contentWritten = false;
  f.intercept(async (url, init) => {
    if (url !== target) return undefined;
    if (init?.method === "PUT") {
      contentWritten =
        init.body instanceof Blob ? init.body.size > 0 : String(init.body ?? "") !== "";
      puts.push({ ifMatch: new Headers(init.headers).get("if-match") });
    }
    if ((init?.method ?? "GET") === "GET")
      readBacks.push({
        accept: new Headers(init?.headers).get("accept"),
        afterContent: contentWritten,
      });
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url !== target) return response;
    if (method === "PUT" && response.ok) response.headers.delete("etag");
    if (method !== "GET" || !contentWritten) return response;
    const current = new Response(returned, { status: response.status, headers: response.headers });
    if (responseType === null) current.headers.delete("content-type");
    else current.headers.set("content-type", responseType);
    return current;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  return { f, puts, readBacks, client };
}

it("certifies reserialized Turtle, renamed blank nodes and relative IRIs, and returns the next If-Match", async () => {
  const { client, puts, readBacks } = await cssRdfPod();
  const written = await client.write(
    target,
    new Blob([sent]),
    { contentType: "text/turtle; charset=utf-8", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(written.etag).toMatch(/^"/);
  if (!written.etag) throw new Error("Missing read-back validator");
  expect(puts).toHaveLength(2);
  expect(puts[1]?.ifMatch).toMatch(/^"/);
  expect(readBacks).toEqual([
    { accept: "text/turtle; charset=utf-8", afterContent: false },
    { accept: "text/turtle; charset=utf-8", afterContent: true },
  ]);
  await client.write(
    target,
    sent,
    { contentType: "text/turtle", ifMatch: written.etag },
    { kind: "protect-ancestors" },
  );
  expect(puts[2]?.ifMatch).toBe(written.etag);
});

it("certifies JSON-LD returned as Turtle using the target URL as both bases", async () => {
  const { client, readBacks } = await cssRdfPod();
  const jsonld = JSON.stringify({
    "@context": { ex: "https://example.org/" },
    "@id": "",
    "ex:p": { "ex:q": "value" },
    "ex:r": { "@id": "#item" },
  });
  await uploadFile(
    client,
    PRIVATE,
    new Blob([jsonld], { type: "application/ld+json" }),
    "report.ttl",
  );
  expect(readBacks.at(-1)).toEqual({ accept: "application/ld+json", afterContent: true });
});

it.each([
  "application/n-triples",
  "application/n-quads",
  "application/trig",
])("certifies %s returned in another RDF syntax", async (contentType) => {
  const triple = '<https://example.org/s> <https://example.org/p> "value" .';
  const { client } = await cssRdfPod('@prefix ex: <https://example.org/>. ex:s ex:p "value".');
  await uploadFile(client, PRIVATE, new Blob([triple], { type: contentType }), "report.ttl");
});

it("accepts a different RDF response syntax and media-type case/parameters", async () => {
  const triple = '<https://example.org/s> <https://example.org/p> "value" .';
  const { client } = await cssRdfPod(triple, "Application/N-Triples; charset=utf-8");
  await uploadFile(client, PRIVATE, new Blob([triple], { type: "text/turtle" }), "report.ttl");
});

it.each([
  ["one changed triple", stored.replace('"value"', '"different"'), "text/turtle"],
  [
    "different blank-node structure with the same triple count",
    `<> <https://example.org/p> _:a; <https://example.org/r> <#item>.
     _:b <https://example.org/q> "value".`,
    "text/turtle",
  ],
  ["invalid RDF", "this is not Turtle", "text/turtle"],
  ["non-RDF", stored, "text/plain"],
  ["no media type", stored, null],
])("does not certify %s and retains recovery copies", async (_reason, returned, contentType) => {
  const { client, f } = await cssRdfPod(returned, contentType);
  const error = await uploadFile(
    client,
    PRIVATE,
    new Blob([sent], { type: "text/turtle" }),
    "report.ttl",
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(error).toMatchObject({ cause: { kind: "upload-not-certified", tooLarge: false } });
  expect((error as DrivePartialFailureError).retainedDestinations.length).toBeGreaterThan(0);
  expect(await (await f.pod.fetch(target)).text()).toBe(sent);
});

it("does not certify an invalid sent graph even if the response is valid RDF", async () => {
  const { client } = await cssRdfPod();
  await expect(
    uploadFile(client, PRIVATE, new Blob(["not Turtle"], { type: "text/turtle" }), "report.ttl"),
  ).rejects.toMatchObject({ cause: { kind: "upload-not-certified", tooLarge: false } });
});

it("preserves the verification error even when recovery folder creation fails", async () => {
  const { client, f } = await cssRdfPod();
  let puts = 0;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok) {
      puts += 1;
      response.headers.delete("etag");
    }
    if (url === target && method === "GET" && puts === 2)
      return new Response("not RDF", { headers: response.headers });
    return response;
  });
  f.intercept(async (url, init) =>
    url.includes(".drive-recovery-") && init?.method === "PUT"
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(
    uploadFile(client, PRIVATE, new Blob([sent], { type: "text/turtle" }), "report.ttl"),
  ).rejects.toMatchObject({
    kind: "partial-failure",
    uploadFailure: { kind: "upload-not-certified", tooLarge: false },
    cause: { kind: "failed", status: 503 },
    retainedDestinations: [],
  });
});

it.each([
  "application/rdf+xml",
  "text/n3",
])("fails closed when parseRdf does not support the uploaded %s syntax", async (type) => {
  const { f, client, readBacks } = await cssRdfPod();
  // Bypass the empty placeholder so the uploaded syntax reaches content verification.
  await f.pod.fetch(target, { method: "PUT", body: "original" });
  const selected = await client.stat(target);
  await expect(
    uploadFile(client, PRIVATE, new Blob([sent], { type }), "report.ttl", "replace", selected),
  ).rejects.toMatchObject({ cause: { kind: "upload-not-certified", tooLarge: false } });
  expect(readBacks.filter((read) => read.afterContent)).toEqual([
    { accept: type, afterContent: true },
  ]);
});

it.each([
  null,
  'W/"weak"',
  "unquoted",
  "*",
])("refuses an RDF read-back without a strong ETag (%s)", async (etag) => {
  const { f, client } = await cssRdfPod();
  let written = false;
  // This response is an isomorphic graph, but its validator cannot confirm identity.
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok) {
      written = true;
      response.headers.delete("etag");
    }
    if (url !== target || method !== "GET" || !written) return response;
    const headers = new Headers(response.headers);
    if (etag === null) headers.delete("etag");
    else headers.set("etag", etag);
    return new Response(stored, { headers });
  });
  await f.pod.fetch(target, { method: "PUT", body: "original" });
  const selected = await client.stat(target);
  await expect(
    uploadFile(
      client,
      PRIVATE,
      new Blob([sent], { type: "text/turtle" }),
      "report.ttl",
      "replace",
      selected,
    ),
  ).rejects.toMatchObject({ cause: { kind: "upload-not-certified" } });
});

it("certifies empty RDF with a bodyless response", async () => {
  const { client } = await cssRdfPod(null);
  await uploadFile(
    client,
    PRIVATE,
    new Blob(["# empty graph"], { type: "text/turtle" }),
    "report.ttl",
  );
});

it("bounds expanded RDF responses as well as uploads", async () => {
  // Isomorphic to what was sent, so only the response byte budget can reject it.
  const { client } = await cssRdfPod(`${stored}\n#${" ".repeat(5 * 1024 * 1024)}`);
  await expect(
    uploadFile(client, PRIVATE, new Blob([sent], { type: "text/turtle" }), "report.ttl"),
  ).rejects.toMatchObject({ cause: { kind: "upload-not-certified", tooLarge: false } });
});

it.each([
  ["RDF", "text/turtle", 5 * 1024 * 1024],
  ["non-RDF", "application/octet-stream", 100 * 1024 * 1024],
])("skips content read-back above the %s cap and reports the size-specific error", async (_name, type, cap) => {
  const { client, readBacks } = await cssRdfPod();
  const file = new Blob([new Uint8Array(cap + 1)], { type });
  const error = await uploadFile(
    client,
    PRIVATE,
    file,
    "report.ttl",
    "fail",
    undefined,
    type,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const cause = (error as DrivePartialFailureError).cause;
  expect(cause).toBeInstanceOf(DriveUploadError);
  expect(cause).toMatchObject({ kind: "upload-not-certified", tooLarge: true });
  expect((cause as DriveUploadError).message).toBe(
    "Your storage didn't confirm this upload, and the file is too large to check. Try a smaller file or a different storage.",
  );
  expect(readBacks.filter((read) => read.afterContent)).toEqual([]);
});

it("allows RDF exactly at 5 MiB (UTF-8 bytes)", async () => {
  const cap = 5 * 1024 * 1024;
  const body = `${sent}\n#${"é".repeat((cap - new Blob([sent]).size - 2) / 2)}`;
  const { client, readBacks } = await cssRdfPod();
  const file = new Blob([body], { type: "text/turtle" });
  // Pad the odd remaining byte without changing the graph.
  const exact = new Blob([file, " ".repeat(cap - file.size)], { type: file.type });
  expect(exact.size).toBe(cap);
  await uploadFile(client, PRIVATE, exact, "report.ttl");
  expect(readBacks.some((read) => read.afterContent)).toBe(true);
});

it("does not read back oversized uploads when the PUT already has a strong ETag", async () => {
  const { client, f, readBacks } = await cssRdfPod();
  f.after(undefined);
  await uploadFile(
    client,
    PRIVATE,
    new Blob([new Uint8Array(100 * 1024 * 1024 + 1)], { type: "application/octet-stream" }),
    "report.ttl",
  );
  expect(readBacks).toEqual([]);
});

it("allows byte read-back for a non-RDF upload exactly at 100 MiB", async () => {
  const { client, f, readBacks } = await cssRdfPod();
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok) response.headers.delete("etag");
    return response;
  });
  await uploadFile(
    client,
    PRIVATE,
    new Blob([new Uint8Array(100 * 1024 * 1024)], { type: "application/octet-stream" }),
    "report.ttl",
    "fail",
    undefined,
    "application/octet-stream",
  );
  expect(readBacks).toContainEqual({ accept: null, afterContent: true });
});

it("never compensates using an isomorphic concurrent writer's RDF read-back validator", async () => {
  const { f, client } = await cssRdfPod();
  await f.pod.fetch(target, {
    method: "PUT",
    body: "original",
    headers: { "content-type": "text/plain" },
  });
  const puts: string[] = [];
  let raced = false;
  let failCheck = false;
  let identityChecked = false;
  f.after(async (url, method, response) => {
    if (url === target && method === "PUT" && response.ok && !raced) {
      raced = true;
      response.headers.delete("etag");
      await f.pod.fetch(target, {
        method: "PUT",
        body: stored,
        headers: { "content-type": "text/turtle" },
      });
      failCheck = true;
    }
    return response;
  });
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "PUT")
      puts.push(init.body instanceof Blob ? await init.body.text() : String(init.body));
    if (
      failCheck &&
      url === target &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      failCheck = false;
      identityChecked = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const selected = await client.stat(target);
  await expect(
    uploadFile(
      client,
      PRIVATE,
      new Blob([sent], { type: "text/turtle" }),
      "report.ttl",
      "replace",
      selected,
    ),
  ).rejects.toBeInstanceOf(DrivePartialFailureError);
  expect(raced).toBe(true);
  expect(identityChecked).toBe(true);
  expect(await (await f.pod.fetch(target)).text()).toBe(stored);
  expect(puts).toEqual([sent]);
});

it("rejects graphs whose blank-node hashes collide without an isomorphism", async () => {
  // One six-node blank cycle versus two three-node cycles: every node has the same
  // local signature, so hash-only matching pairs them up.
  const six = await parseRdf(
    "@prefix ex: <https://example.org/>. _:a ex:p _:b. _:b ex:p _:c. _:c ex:p _:d. _:d ex:p _:e. _:e ex:p _:f. _:f ex:p _:a.",
    "text/turtle",
  );
  const threes = await parseRdf(
    "@prefix ex: <https://example.org/>. _:a ex:p _:b. _:b ex:p _:c. _:c ex:p _:a. _:d ex:p _:e. _:e ex:p _:f. _:f ex:p _:d.",
    "text/turtle",
  );
  expect(isomorphic([...six], [...threes])).toBe(true);
  expect(isomorphicGraph(six, threes)).toBe(false);
  const relabelled = await parseRdf(
    "@prefix ex: <https://example.org/>. _:x ex:p _:y. _:y ex:p _:z. _:z ex:p _:u. _:u ex:p _:v. _:v ex:p _:w. _:w ex:p _:x.",
    "text/turtle",
  );
  expect(isomorphicGraph(six, relabelled)).toBe(true);
  expect(isomorphicGraph(six, new Store([...six].slice(1)))).toBe(false);
});
