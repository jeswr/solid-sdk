// AUTHORED-BY Codex
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  DriveError,
  nameOf,
  parentOf,
} from "../src/apps/drive/lib/client/client";
import { REPORT_PDF } from "../src/lib/demo-pod/binaries";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT } from "../src/lib/demo-pod/seed";

const NOW = Date.UTC(2026, 9, 26, 12);
const DRIVE = `${DEMO_ROOT}drive/`;

async function setup() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
  const client = createSolidDriveClient({ storageUrl: DEMO_ROOT, fetch: pod.fetch });
  return { pod, client };
}

function stubClient(fetch: typeof globalThis.fetch) {
  return createSolidDriveClient({ storageUrl: DEMO_ROOT, fetch });
}

afterEach(() => vi.restoreAllMocks());

describe("Drive URL helpers", () => {
  it.each([
    [DEMO_ROOT, "alice.demo.pod"],
    [`${DRIVE}Work/`, "Work"],
    [`${DRIVE}Work/Budget%202026.csv?download=1#it`, "Budget 2026.csv"],
    [`${DRIVE}Caf%C3%A9%20%F0%9F%92%A1.txt`, "Café 💡.txt"],
    [`${DRIVE}bad%zz`, "bad%zz"],
  ])("extracts the display name of %s", (url, expected) => expect(nameOf(url)).toBe(expected));

  it.each([
    [DEMO_ROOT, undefined],
    [DRIVE, DEMO_ROOT],
    [`${DRIVE}Work/`, DRIVE],
    [`${DRIVE}notes.md`, DRIVE],
  ])("finds the parent of %s", (url, expected) => expect(parentOf(url)).toBe(expected));
});

describe("Drive client against a seeded demo pod", () => {
  it("lists typed files and folders, includes hidden names and forwards cancellation", async () => {
    const { pod, client } = await setup();
    expect(client.storageUrl).toBe(DEMO_ROOT);
    const items = await client.list(DRIVE);
    expect(items.map((item) => [item.name, item.kind])).toEqual([
      ["Archive", "folder"],
      ["Photos", "folder"],
      ["Work", "folder"],
      ["data.ttl", "file"],
      ["notes.md", "file"],
    ]);
    expect(items.find((item) => item.name === "notes.md")).toEqual({
      url: `${DRIVE}notes.md`,
      name: "notes.md",
      kind: "file",
      contentType: "text/markdown",
      size: new TextEncoder().encode(await (await pod.fetch(`${DRIVE}notes.md`)).text()).byteLength,
      modified: new Date(NOW - 86_400_000),
    });
    expect(items.find((item) => item.name === "Archive")).toEqual({
      url: `${DRIVE}Archive/`,
      name: "Archive",
      kind: "folder",
      modified: new Date(NOW - 30 * 86_400_000),
    });
    expect(await client.list(`${DRIVE}Archive/`)).toEqual([]);
    expect((await client.list(DEMO_ROOT)).some((item) => item.name === ".acl")).toBe(true);
    const signal = new AbortController().signal;
    const fetch = vi.fn<typeof globalThis.fetch>(pod.fetch);
    const withSignal = stubClient(fetch);
    expect((await withSignal.list(`${DRIVE}Work/`, { signal })).map((item) => item.name)).toEqual([
      "Budget 2026.csv",
      "Report.pdf",
    ]);
    expect(fetch).toHaveBeenCalledWith(`${DRIVE}Work/`, expect.objectContaining({ signal }));
  });

  it("stats files/folders with HEAD and reads the original bytes as Blobs", async () => {
    const { client } = await setup();
    const pdf = `${DRIVE}Work/Report.pdf`;
    expect(await client.stat(pdf)).toEqual({
      url: pdf,
      name: "Report.pdf",
      kind: "file",
      contentType: "application/pdf",
      size: REPORT_PDF.byteLength,
      modified: new Date(NOW - 2 * 86_400_000),
      etag: expect.stringMatching(/^"demo-/),
    });
    const folder = await client.stat(`${DRIVE}Archive/`);
    expect(folder).toMatchObject({
      kind: "folder",
      name: "Archive",
      etag: expect.any(String),
      modified: expect.any(Date),
    });
    expect(folder).not.toHaveProperty("size");
    expect(folder).not.toHaveProperty("contentType");
    const blob = await client.read(pdf);
    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(REPORT_PDF);
  });

  it("reads RDF datasets with their ETag and returns undefined for missing RDF", async () => {
    const { pod, client } = await setup();
    const url = `${DRIVE}data.ttl`;
    const result = await client.readRdf(url);
    expect(result?.etag).toBe((await client.stat(url)).etag);
    expect(result?.dataset.size).toBeGreaterThan(0);
    expect([...(result?.dataset ?? [])].some((quad) => quad.subject.value === `${url}#it`)).toBe(
      true,
    );
    expect(await client.readRdf(`${DRIVE}absent.ttl`)).toBeUndefined();
    // An otherwise valid response with a missing validator is still readable.
    const withoutEtag = stubClient(async (input, init) => {
      const response = await pod.fetch(input, init);
      response.headers.delete("etag");
      return response;
    });
    const unvalidated = await withoutEtag.readRdf(url);
    expect(unvalidated).not.toHaveProperty("etag");
    expect([...(unvalidated?.dataset ?? [])]).toEqual([...(result?.dataset ?? [])]);
  });

  it.each([401, 403, 409, 410, 412, 500])("maps readRdf HTTP %i failures", async (status) => {
    const client = stubClient(async () => new Response(null, { status }));
    const url = `${DRIVE}data.ttl`;
    await expect(client.readRdf(url)).rejects.toEqual(
      await client.stat(url).catch((error: unknown) => error),
    );
  });

  it("preserves readRdf parsing and network failures without an HTTP status", async () => {
    const error = new Error("offline");
    const offline = stubClient(async () => {
      throw error;
    });
    await expect(offline.readRdf(`${DRIVE}data.ttl`)).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: error,
      status: undefined,
    });
    const malformed = stubClient(
      async () =>
        new Response("invalid Turtle", {
          headers: { "content-type": "text/turtle" },
        }),
    );
    await expect(malformed.readRdf(`${DRIVE}data.ttl`)).rejects.toBeInstanceOf(RdfFetchError);
    await expect(malformed.readRdf(`${DRIVE}data.ttl`)).rejects.not.toBeInstanceOf(DriveError);
  });

  it("writes strings and Blobs with conditional create/overwrite and creates normalized folders", async () => {
    const { pod, client } = await setup();
    const url = `${DRIVE}New/fresh.txt`;
    const first = await client.write(url, "first", {
      contentType: "text/plain; charset=utf-8",
      ifNoneMatch: "*",
    });
    expect(first.etag).toMatch(/^"demo-/);
    expect(await client.stat(url)).toMatchObject({
      contentType: "text/plain",
      size: 5,
      etag: first.etag,
    });
    await expect(
      client.write(url, "collision", { contentType: "text/plain", ifNoneMatch: "*" }),
    ).rejects.toMatchObject({ kind: "conflict", status: 412, url });
    await expect(
      client.write(url, "stale", { contentType: "text/plain", ifMatch: '"stale"' }),
    ).rejects.toMatchObject({ kind: "conflict", status: 412 });
    const second = await client.write(url, new Blob(["second"]), {
      contentType: "text/plain",
      ifMatch: first.etag as string,
    });
    expect(second.etag).not.toBe(first.etag);
    expect(await (await client.read(url)).text()).toBe("second");
    await client.createFolder(`${DRIVE}Created`);
    await client.createFolder(`${DRIVE}Created/Nested/`);
    expect(pod.has(`${DRIVE}Created/Nested/`)).toBe(true);
    await expect(client.createFolder(`${DRIVE}Created/`)).rejects.toMatchObject({
      kind: "conflict",
      status: 412,
    });
    await expect(client.createFolder(url)).rejects.toMatchObject({ kind: "conflict", status: 409 });
  });

  it("copies files and recursive folder trees while preserving bytes and media types", async () => {
    const { client } = await setup();
    await client.copy(`${DRIVE}Work/Report.pdf`, `${DRIVE}report-copy.pdf`);
    expect(
      new Uint8Array(await (await client.read(`${DRIVE}report-copy.pdf`)).arrayBuffer()),
    ).toEqual(REPORT_PDF);
    expect(await client.stat(`${DRIVE}report-copy.pdf`)).toMatchObject({
      contentType: "application/pdf",
    });
    await expect(
      client.copy(`${DRIVE}Work/Report.pdf`, `${DRIVE}report-copy.pdf`),
    ).rejects.toMatchObject({ status: 412, kind: "conflict" });
    await client.createFolder(`${DRIVE}Work/Nested/Empty/`);
    await client.write(`${DRIVE}Work/Nested/file`, "nested", { contentType: "text/plain" });
    await client.copy(`${DRIVE}Work/`, `${DRIVE}Work%20copy/`);
    expect((await client.list(`${DRIVE}Work%20copy/`)).map((item) => item.name)).toEqual([
      "Budget 2026.csv",
      "Nested",
      "Report.pdf",
    ]);
    expect(await (await client.read(`${DRIVE}Work%20copy/Nested/file`)).text()).toBe("nested");
    expect(await client.list(`${DRIVE}Work%20copy/Nested/Empty/`)).toEqual([]);
    expect(await client.list(`${DRIVE}Work/`)).toHaveLength(3);
  });

  it("moves files and recursive folders, rejects moving a folder inside itself, and removes trees", async () => {
    const { pod, client } = await setup();
    const source = `${DRIVE}notes.md`;
    const target = `${DRIVE}renamed.md`;
    const original = await (await client.read(source)).text();
    expect(await client.move(source, target)).toBe(target);
    expect(pod.has(source)).toBe(false);
    expect(await (await client.read(target)).text()).toBe(original);
    await expect(client.move(`${DRIVE}Work/`, `${DRIVE}Work/Nested/`)).rejects.toEqual(
      new DriveError("conflict", 409, `${DRIVE}Work/Nested/`),
    );
    await expect(client.move(`${DRIVE}Work/`, `${DRIVE}Work/`)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(await client.move(`${DRIVE}Work/`, `${DRIVE}Moved/`)).toBe(`${DRIVE}Moved/`);
    expect(pod.has(`${DRIVE}Work/`)).toBe(false);
    await expect(client.remove(`${DRIVE}Moved/`)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    await client.remove(`${DRIVE}Moved/`, { recursive: true });
    expect(pod.has(`${DRIVE}Moved/`)).toBe(false);
    expect(pod.has(`${DRIVE}Moved/Report.pdf`)).toBe(false);
    await client.remove(target);
    expect(pod.has(target)).toBe(false);
  });

  it.each([
    false,
    true,
  ])("rolls back a copied move when source deletion fails (rollback fails: %s)", async (rollbackFails) => {
    const { pod } = await setup();
    const from = `${DRIVE}notes.md`;
    const to = `${DRIVE}destination.md`;
    const requests: string[] = [];
    const client = stubClient(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        requests.push(url);
        if (url === from || rollbackFails) return new Response(null, { status: 403 });
      }
      return pod.fetch(input, init);
    });
    await expect(client.move(from, to)).rejects.toMatchObject({
      kind: rollbackFails ? "partial-failure" : "forbidden",
      status: rollbackFails ? 409 : 403,
      url: from,
    });
    expect(requests).toEqual([from, to]);
    expect(pod.has(from)).toBe(true);
    expect(pod.has(to)).toBe(rollbackFails);
  });
});

describe("Drive error handling and foreign server responses", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [410, "not-found"],
    [409, "conflict"],
    [412, "conflict"],
    [500, "failed"],
  ])("maps HTTP %i for both RDF listings and direct requests", async (status, kind) => {
    const client = stubClient(async () => new Response(null, { status }));
    const url = `${DRIVE}missing/`;
    for (const [operation, requestUrl] of [
      [() => client.list(url), url],
      [() => client.stat(url), url],
      [() => client.read(url), url],
      [() => client.write(url, "", { contentType: "text/plain" }), url],
      [() => client.createFolder(url), url],
      [() => client.copy(`${DRIVE}missing`, `${DRIVE}copy`), `${DRIVE}missing`],
      [() => client.remove(url), url],
    ] as const) {
      await expect(operation()).rejects.toMatchObject({
        name: "DriveError",
        kind,
        status,
        url: requestUrl,
        message: `${kind} (${status}) at ${requestUrl}`,
      });
    }
  });

  it("preserves network failures and RdfFetchErrors without a status", async () => {
    const error = new Error("offline");
    const client = stubClient(async () => {
      throw error;
    });
    await expect(client.read(`${DRIVE}file`)).rejects.toBe(error);
    await expect(client.list(DRIVE)).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: error,
      status: undefined,
    });
    const malformed = stubClient(
      async () =>
        new Response("this is not Turtle", { headers: { "content-type": "text/turtle" } }),
    );
    await expect(malformed.list(DRIVE)).rejects.toBeInstanceOf(RdfFetchError);
    await expect(malformed.list(DRIVE)).rejects.not.toBeInstanceOf(DriveError);
  });

  it("handles missing HEAD/write headers and the fallback copy media type", async () => {
    const responses = [
      new Response(null),
      new Response(null),
      new Response(null, { status: 201 }),
      new Response(new Uint8Array([0, 255])),
      new Response(null, { status: 201 }),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    });
    const client = stubClient(fetch);
    const file = `${DRIVE}file`;
    expect(await client.stat(file)).toEqual({ url: file, name: "file", kind: "file" });
    expect(await client.stat(DRIVE)).toEqual({ url: DRIVE, name: "drive", kind: "folder" });
    expect(await client.write(file, "", { contentType: "text/plain" })).toEqual({});
    await client.copy(file, `${DRIVE}copy`);
    expect(fetch).toHaveBeenLastCalledWith(
      `${DRIVE}copy`,
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "if-none-match": "*" },
        body: expect.any(Blob),
      }),
    );
    const copiedBody = fetch.mock.calls[4]?.[1]?.body as Blob;
    expect(new Uint8Array(await copiedBody.arrayBuffer())).toEqual(new Uint8Array([0, 255]));
    expect(responses).toHaveLength(0);
  });

  it("omits malformed optional metadata while preserving listing entries", async () => {
    // Foreign/malformed RDF is intentional here; parse it through the real RDF reader.
    const listing = `
      @prefix ldp: <http://www.w3.org/ns/ldp#>.
      @prefix posix: <http://www.w3.org/ns/posix/stat#>.
      @prefix dct: <http://purl.org/dc/terms/>.
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
      <> ldp:contains <missing>, <wrong>, <invalid-date>, <folder/>.
      <wrong> posix:size <urn:not-a-literal>; dct:modified <urn:not-a-literal>.
      <invalid-date> dct:modified "not-a-date"^^xsd:dateTime.
      <folder/> posix:size 123.
    `;
    const client = stubClient(
      async () => new Response(listing, { headers: { "content-type": "text/turtle" } }),
    );
    expect(await client.list(DRIVE)).toEqual([
      { url: `${DRIVE}missing`, name: "missing", kind: "file" },
      { url: `${DRIVE}wrong`, name: "wrong", kind: "file" },
      { url: `${DRIVE}invalid-date`, name: "invalid-date", kind: "file" },
      { url: `${DRIVE}folder/`, name: "folder", kind: "folder" },
    ]);
  });

  it("rethrows non-RdfFetchError listing errors unchanged", async () => {
    const client = stubClient(
      async () =>
        new Response(
          `
      @prefix ldp: <http://www.w3.org/ns/ldp#>.
      <> ldp:contains <file>.
      <file> a "invalid type literal".
    `,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    await expect(client.list(DRIVE)).rejects.toThrow();
    await expect(client.list(DRIVE)).rejects.not.toBeInstanceOf(RdfFetchError);
    await expect(client.list(DRIVE)).rejects.not.toBeInstanceOf(DriveError);
  });
});
