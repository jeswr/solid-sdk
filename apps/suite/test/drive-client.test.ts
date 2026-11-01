// AUTHORED-BY Codex
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { Container } from "@solid/object";
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
      verifyHeaders: expect.any(Function),
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

  it.each([401, 403, 409, 412, 500])("maps readRdf HTTP %i failures", async (status) => {
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
    const first = await client.write(
      url,
      "first",
      {
        contentType: "text/plain; charset=utf-8",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    expect(first.etag).toMatch(/^"demo-/);
    expect(await client.stat(url)).toMatchObject({
      contentType: "text/plain",
      size: 5,
      etag: first.etag,
    });
    await expect(
      client.write(
        url,
        "collision",
        { contentType: "text/plain", ifNoneMatch: "*" },
        { kind: "protect-ancestors" },
      ),
    ).rejects.toMatchObject({ kind: "conflict", status: 412, url });
    await expect(
      client.write(
        url,
        "stale",
        { contentType: "text/plain", ifMatch: '"stale"' },
        { kind: "protect-ancestors" },
      ),
    ).rejects.toMatchObject({ kind: "conflict", status: 412 });
    const second = await client.write(
      url,
      new Blob(["second"]),
      {
        contentType: "text/plain",
        ifMatch: first.etag as string,
      },
      { kind: "protect-ancestors" },
    );
    expect(second.etag).not.toBe(first.etag);
    expect(await (await client.read(url)).text()).toBe("second");
    await client.createFolder(`${DRIVE}Created`, { kind: "inherit-verified" });
    await client.createFolder(`${DRIVE}Created/Nested/`, { kind: "inherit-verified" });
    expect(pod.has(`${DRIVE}Created/Nested/`)).toBe(true);
    await expect(
      client.createFolder(`${DRIVE}Created/`, { kind: "inherit-verified" }),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 412,
    });
    await expect(client.createFolder(url, { kind: "inherit-verified" })).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
  });

  it("copies files and recursive folder trees while preserving bytes and media types", async () => {
    const { client } = await setup();
    await client.copy(`${DRIVE}Work/Report.pdf`, `${DRIVE}report-copy.pdf`, {
      kind: "preserve-source",
    });
    expect(
      new Uint8Array(await (await client.read(`${DRIVE}report-copy.pdf`)).arrayBuffer()),
    ).toEqual(REPORT_PDF);
    expect(await client.stat(`${DRIVE}report-copy.pdf`)).toMatchObject({
      contentType: "application/pdf",
    });
    await expect(
      client.copy(`${DRIVE}Work/Report.pdf`, `${DRIVE}report-copy.pdf`, {
        kind: "preserve-source",
      }),
    ).rejects.toMatchObject({ status: 412, kind: "conflict" });
    await client.createFolder(`${DRIVE}Work/Nested/Empty/`, { kind: "inherit-verified" });
    await client.write(
      `${DRIVE}Work/Nested/file`,
      "nested",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    );
    await client.copy(`${DRIVE}Work/`, `${DRIVE}Work%20copy/`, { kind: "preserve-source" });
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
    expect(await client.move(source, target, { kind: "confirm-move" })).toEqual({
      url: target,
      etag: (await client.stat(target)).etag,
      verifyHeaders: expect.any(Function),
    });
    expect(pod.has(source)).toBe(false);
    expect(await (await client.read(target)).text()).toBe(original);
    await expect(
      client.move(`${DRIVE}Work/`, `${DRIVE}Work/Nested/`, { kind: "confirm-move" }),
    ).rejects.toEqual(new DriveError("conflict", 409, `${DRIVE}Work/Nested/`));
    await expect(
      client.move(`${DRIVE}Work/`, `${DRIVE}Work/`, { kind: "confirm-move" }),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(await client.move(`${DRIVE}Work/`, `${DRIVE}Moved/`, { kind: "confirm-move" })).toEqual({
      url: `${DRIVE}Moved/`,
      etag: (await client.stat(`${DRIVE}Moved/`)).etag,
      verifyHeaders: expect.any(Function),
      children: [`${DRIVE}Moved/Budget%202026.csv`, `${DRIVE}Moved/Report.pdf`],
      tree: [
        {
          url: `${DRIVE}Moved/`,
          etag: expect.any(String),
          verifyHeaders: expect.any(Function),
          children: [`${DRIVE}Moved/Budget%202026.csv`, `${DRIVE}Moved/Report.pdf`],
        },
        {
          url: `${DRIVE}Moved/Budget%202026.csv`,
          etag: expect.any(String),
          verifyHeaders: expect.any(Function),
        },
        {
          url: `${DRIVE}Moved/Report.pdf`,
          etag: expect.any(String),
          verifyHeaders: expect.any(Function),
        },
      ],
    });
    expect(pod.has(`${DRIVE}Work/`)).toBe(false);
    await client.remove(`${DRIVE}Moved/`, { recursive: true });
    expect(pod.has(`${DRIVE}Moved/`)).toBe(false);
    expect(pod.has(`${DRIVE}Moved/Report.pdf`)).toBe(false);
    await client.remove(target);
    expect(pod.has(target)).toBe(false);
  });

  it.each([
    403, 409, 412,
  ])("retains a copied move and surfaces a definitive DELETE refusal %s", async (status) => {
    const { pod } = await setup();
    const from = `${DRIVE}notes.md`;
    const to = `${DRIVE}destination.md`;
    const requests: string[] = [];
    const client = stubClient(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        requests.push(url);
        if (url === from) return new Response(null, { status });
      }
      return pod.fetch(input, init);
    });
    await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toMatchObject({
      kind: "partial-failure",
      status: 409,
      url: from,
      cause: { status },
    });
    expect(requests).toEqual([from]);
    expect(pod.has(from)).toBe(true);
    expect(pod.has(to)).toBe(true);
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
    const client = stubClient(async (input, init) =>
      [DEMO_ROOT, DRIVE].includes(String(input)) && init?.method === "HEAD"
        ? new Response(null, { headers: { "x-solid-demo-access-control": "none" } })
        : new Response(null, { status }),
    );
    const url = `${DRIVE}missing/`;
    for (const [operation, requestUrl] of [
      [() => client.list(url), url],
      [() => client.stat(url), url],
      [() => client.read(url), url],
      [
        () => client.write(url, "", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
        url,
      ],
      [() => client.createFolder(url, { kind: "inherit-verified" }), url],
      [
        () => client.copy(`${DRIVE}missing`, `${DRIVE}copy`, { kind: "preserve-source" }),
        `${DRIVE}missing`,
      ],
    ] as const) {
      await expect(operation()).rejects.toMatchObject({
        name: "DriveError",
        kind,
        status,
        url: requestUrl,
        message: `${kind} (${status}) at ${requestUrl}`,
      });
    }
    if (status === 404 || status === 410) await client.remove(url);
    else await expect(client.remove(url)).rejects.toMatchObject({ kind, status });
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
    let versioned = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") return new Response(null, { status: 201 });
      if (String(input) === `${DRIVE}new`)
        return new Response(null, {
          status: 404,
          headers: { "x-solid-demo-access-control": "none" },
        });
      return new Response(method === "HEAD" ? null : new Uint8Array([0, 255]), {
        headers: {
          "x-solid-demo-access-control": "none",
          ...(versioned ? { etag: '"source"' } : {}),
        },
      });
    });
    const client = stubClient(fetch);
    const file = `${DRIVE}file`;
    expect(await client.stat(file)).toEqual({
      url: file,
      name: "file",
      kind: "file",
      verifyHeaders: expect.any(Function),
    });
    expect(await client.stat(DRIVE)).toEqual({
      url: DRIVE,
      name: "drive",
      kind: "folder",
      verifyHeaders: expect.any(Function),
    });
    await expect(
      client.write(file, "", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
    ).rejects.toMatchObject({ kind: "missing-validator" });
    await expect(
      client.write(`${DRIVE}new`, "", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
    ).rejects.toMatchObject({ kind: "partial-failure" });
    await expect(
      client.copy(file, `${DRIVE}copy`, { kind: "preserve-source" }),
    ).rejects.toMatchObject({ kind: "missing-validator" });
    versioned = true;
    await expect(
      client.copy(file, `${DRIVE}copy`, { kind: "preserve-source" }),
    ).rejects.toMatchObject({
      kind: "partial-failure",
      cause: { kind: "missing-validator" },
    });
    const copied = fetch.mock.calls.filter(([, init]) => init?.method === "PUT").at(-1);
    expect(
      copied && [
        copied[0],
        { ...copied[1], headers: Object.fromEntries(new Headers(copied[1]?.headers)) },
      ],
    ).toEqual([
      `${DRIVE}copy`,
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "if-none-match": "*" },
        body: expect.any(Blob),
      }),
    ]);
    const copiedBody = copied?.[1]?.body as Blob;
    expect(new Uint8Array(await copiedBody.arrayBuffer())).toEqual(new Uint8Array([0, 255]));
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
    const failure = new Error("broken container accessor");
    vi.spyOn(Container.prototype, "contains", "get").mockImplementation(() => {
      throw failure;
    });
    const client = stubClient(
      async () =>
        new Response(
          `
      @prefix ldp: <http://www.w3.org/ns/ldp#>.
      <> ldp:contains <file>.
    `,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    await expect(client.list(DRIVE)).rejects.toThrow();
    await expect(client.list(DRIVE)).rejects.not.toBeInstanceOf(RdfFetchError);
    await expect(client.list(DRIVE)).rejects.not.toBeInstanceOf(DriveError);
  });
});
