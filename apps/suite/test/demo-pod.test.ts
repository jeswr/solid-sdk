// AUTHORED-BY Codex
import { DataFactory, Parser, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HILLS_PNG, REPORT_PDF, SUNSET_PNG } from "../src/lib/demo-pod/binaries";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  buildDemoSeed,
  DEMO_NAME,
  DEMO_ROOT,
  DEMO_WEBID,
  DRIVE_ROOT_CLASS,
} from "../src/lib/demo-pod/seed";

const NOW = Date.UTC(2026, 9, 26, 12);
const LDP = "http://www.w3.org/ns/ldp#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const POSIX = "http://www.w3.org/ns/posix/stat#";
const DCT = "http://purl.org/dc/terms/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const { namedNode } = DataFactory;

async function graph(response: Response, baseIRI: string): Promise<Store> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/turtle");
  return new Store(new Parser({ baseIRI }).parse(await response.text()));
}

function objects(store: Store, subject: string, predicate: string): string[] {
  return store.getObjects(namedNode(subject), namedNode(predicate), null).map((term) => term.value);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("demo seed and binary fixtures", () => {
  it("seeds a profile, owner-only ACL, empty type index and the Drive acceptance tree", async () => {
    const seed = await buildDemoSeed(NOW);
    const pod = createDemoPod({ root: DEMO_ROOT, seed, now: () => NOW });
    expect(seed).toHaveLength(10);
    expect(DRIVE_ROOT_CLASS).toBe("https://jeswr.org/ns/pod-drive#DriveRoot");
    for (const file of seed) {
      const url = new URL(file.path, DEMO_ROOT).href;
      expect(pod.has(url)).toBe(true);
      const response = await pod.fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("last-modified")).toBe(
        new Date(file.modified as number).toUTCString(),
      );
      if (!file.path.endsWith("/")) {
        expect(response.headers.get("content-type")).toBe(file.contentType);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          typeof file.body === "string" ? new TextEncoder().encode(file.body) : file.body,
        );
      }
    }
    const profile = await graph(await pod.fetch(`${DEMO_ROOT}profile/card`), DEMO_ROOT);
    expect(objects(profile, DEMO_WEBID, TYPE)).toEqual(["http://xmlns.com/foaf/0.1/Person"]);
    expect(objects(profile, DEMO_WEBID, "http://xmlns.com/foaf/0.1/name")).toEqual([DEMO_NAME]);
    expect(objects(profile, DEMO_WEBID, "http://www.w3.org/ns/pim/space#storage")).toEqual([
      DEMO_ROOT,
    ]);
    expect(
      objects(profile, DEMO_WEBID, "http://www.w3.org/ns/solid/terms#privateTypeIndex"),
    ).toEqual([`${DEMO_ROOT}settings/privateTypeIndex.ttl`]);
    const indexUrl = `${DEMO_ROOT}settings/privateTypeIndex.ttl`;
    const index = await graph(await pod.fetch(indexUrl), indexUrl);
    expect(index.size).toBe(2);
    expect(objects(index, indexUrl, TYPE)).toEqual([
      "http://www.w3.org/ns/solid/terms#TypeIndex",
      "http://www.w3.org/ns/solid/terms#UnlistedDocument",
    ]);
    const aclUrl = `${DEMO_ROOT}.acl`;
    const aclResponse = await pod.fetch(aclUrl);
    expect(aclResponse.headers.get("link")).not.toContain('rel="acl"');
    const acl = await graph(aclResponse, aclUrl);
    const owner = `${aclUrl}#owner`;
    const aclNs = "http://www.w3.org/ns/auth/acl#";
    expect(acl.size).toBe(7);
    expect(objects(acl, owner, TYPE)).toEqual([`${aclNs}Authorization`]);
    expect(objects(acl, owner, `${aclNs}agent`)).toEqual([DEMO_WEBID]);
    expect(objects(acl, owner, `${aclNs}accessTo`)).toEqual([DEMO_ROOT]);
    expect(objects(acl, owner, `${aclNs}default`)).toEqual([DEMO_ROOT]);
    expect(objects(acl, owner, `${aclNs}mode`)).toEqual([
      `${aclNs}Read`,
      `${aclNs}Write`,
      `${aclNs}Control`,
    ]);
    const contactUrl = `${DEMO_ROOT}drive/data.ttl`;
    const contact = await graph(await pod.fetch(contactUrl), contactUrl);
    expect(contact.size).toBe(4);
    expect(objects(contact, `${contactUrl}#it`, "http://www.w3.org/2006/vcard/ns#fn")).toEqual([
      "Bram Kerst",
    ]);
    expect(await (await pod.fetch(`${DEMO_ROOT}drive/notes.md`)).text()).toContain(
      "Book train to Ghent",
    );
    expect(await (await pod.fetch(`${DEMO_ROOT}drive/Work/Budget%202026.csv`)).text()).toContain(
      "Travel,1200,980",
    );
    expect((await graph(await pod.fetch(`${DEMO_ROOT}drive/Archive/`), DEMO_ROOT)).size).toBe(5);
  });

  it("provides distinct PNGs with image dimensions and a PDF with readable report content", () => {
    for (const png of [SUNSET_PNG, HILLS_PNG]) {
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
      expect(header.getUint32(16)).toBe(200);
      expect(header.getUint32(20)).toBe(120);
    }
    expect(SUNSET_PNG).not.toEqual(HILLS_PNG);
    const pdf = new TextDecoder().decode(REPORT_PDF);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Quarterly report");
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("propagates RDF serialization errors when building the seed", async () => {
    const error = new Error("seed serialization failed");
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => callback?.(error, ""));
    await expect(buildDemoSeed(NOW)).rejects.toBe(error);
  });
});

describe("demo pod HTTP contract", () => {
  it("lists direct children with typed metadata and advertises the storage root", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
    const response = await pod.fetch(DEMO_ROOT);
    expect(response.headers.get("link")).toContain(
      '<http://www.w3.org/ns/pim/space#Storage>; rel="type"',
    );
    expect(response.headers.get("link")).toContain(`<${DEMO_ROOT}.acl>; rel="acl"`);
    expect(response.headers.get("wac-allow")).toBe('user="read write append control",public=""');
    const rootGraph = await graph(response, DEMO_ROOT);
    expect(objects(rootGraph, DEMO_ROOT, TYPE)).toEqual([
      `${LDP}Container`,
      `${LDP}BasicContainer`,
      `${LDP}Resource`,
      "http://www.w3.org/ns/pim/space#Storage",
    ]);
    expect(objects(rootGraph, DEMO_ROOT, `${LDP}contains`)).toEqual([
      `${DEMO_ROOT}.acl`,
      `${DEMO_ROOT}drive/`,
      `${DEMO_ROOT}profile/`,
      `${DEMO_ROOT}settings/`,
    ]);
    const work = `${DEMO_ROOT}drive/Work/`;
    const listing = await graph(await pod.fetch(work), work);
    expect(objects(listing, work, `${LDP}contains`)).toEqual([
      `${work}Budget%202026.csv`,
      `${work}Report.pdf`,
    ]);
    const pdf = `${work}Report.pdf`;
    expect(new Set(objects(listing, pdf, TYPE))).toEqual(
      new Set(["http://www.w3.org/ns/iana/media-types/application/pdf#Resource", `${LDP}Resource`]),
    );
    const size = listing.getObjects(namedNode(pdf), namedNode(`${POSIX}size`), null)[0];
    expect(size).toEqual(
      DataFactory.literal(String(REPORT_PDF.byteLength), namedNode(`${XSD}integer`)),
    );
    expect(objects(listing, pdf, `${DCT}modified`)).toEqual([
      new Date(NOW - 2 * 86_400_000).toISOString(),
    ]);
    expect(objects(listing, pdf, `${POSIX}mtime`)).toEqual([String((NOW - 2 * 86_400_000) / 1000)]);
    for (const url of [DEMO_ROOT, work, pdf]) {
      const get = await pod.fetch(url);
      const head = await pod.fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect([...head.headers]).toEqual([...get.headers]);
      expect(await head.text()).toBe("");
    }
  });

  it("creates parents, preserves creation time and enforces ETag preconditions", async () => {
    let clock = NOW;
    const pod = createDemoPod({ root: DEMO_ROOT, now: () => clock });
    const url = `${DEMO_ROOT}one/two/file`;
    const first = await pod.fetch(url, {
      method: "PUT",
      body: "one",
      headers: { "if-none-match": "*" },
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("location")).toBe(url);
    expect(pod.has(`${DEMO_ROOT}one/`)).toBe(true);
    expect(pod.has(`${DEMO_ROOT}one/two/`)).toBe(true);
    const firstTag = first.headers.get("etag") as string;
    for (const headers of [
      { "if-none-match": "*" },
      { "if-none-match": `, W/${firstTag},` },
      { "if-match": '"wrong"' },
    ])
      expect((await pod.fetch(url, { method: "PUT", headers, body: "blocked" })).status).toBe(412);
    expect(
      (await pod.fetch(`${url}-missing`, { method: "PUT", headers: { "if-match": "*" } })).status,
    ).toBe(412);
    clock += 5_000;
    const overwrite = await pod.fetch(url, {
      method: "PUT",
      body: "two",
      headers: { "if-match": `"wrong", W/${firstTag}, `, "if-none-match": '"other"' },
    });
    expect(overwrite.status).toBe(205);
    expect(await overwrite.text()).toBe("");
    expect(overwrite.headers.get("etag")).not.toBe(firstTag);
    expect(await (await pod.fetch(url)).text()).toBe("two");
    expect(pod.snapshot().resources[0]?.[1]).toMatchObject({ created: NOW, modified: clock });
    const match = await pod.fetch(url, {
      method: "PUT",
      headers: { "if-match": overwrite.headers.get("etag") as string },
    });
    expect(match.status).toBe(205);
    expect((await pod.fetch(url, { method: "PUT", headers: { "if-match": "*" } })).status).toBe(
      205,
    );
    const folder = `${DEMO_ROOT}one/`;
    expect(
      (await pod.fetch(folder, { method: "PUT", headers: { "if-none-match": "*" } })).status,
    ).toBe(412);
    expect(
      (
        await pod.fetch(folder, {
          method: "PUT",
          headers: { "if-match": (await pod.fetch(folder)).headers.get("etag") as string },
        })
      ).status,
    ).toBe(205);
  });

  it.each([
    "child",
    "child/",
    "nested/child",
    "nested/child/",
  ])("rejects PUT through an existing file to %s without changing state", async (suffix) => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const file = `${DEMO_ROOT}file`;
    await pod.fetch(file, { method: "PUT", body: "original" });
    const before = pod.snapshot();
    expect((await pod.fetch(`${file}/${suffix}`, { method: "PUT" })).status).toBe(409);
    expect(pod.snapshot()).toEqual(before);
  });

  it("rejects same-named file/container replacements in both directions", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    expect((await pod.fetch(`${DEMO_ROOT}file`, { method: "PUT" })).status).toBe(201);
    expect((await pod.fetch(`${DEMO_ROOT}file/`, { method: "PUT" })).status).toBe(409);
    expect((await pod.fetch(`${DEMO_ROOT}folder/`, { method: "PUT" })).status).toBe(201);
    expect((await pod.fetch(`${DEMO_ROOT}folder`, { method: "PUT" })).status).toBe(409);
  });

  it.each([
    [undefined, ""],
    ['<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"', "/"],
  ] as const)("POST creates children and resolves repeated Slugs (%s)", async (link, suffix) => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    for (const n of [0, 1, 2]) {
      const response = await pod.fetch(DEMO_ROOT, {
        method: "POST",
        body: "hello",
        headers: { slug: " A/B\\C ", "content-type": "text/plain", ...(link ? { link } : {}) },
      });
      const url = `${DEMO_ROOT}A-B-C${n ? `-${n}` : ""}${suffix}`;
      expect(response.status).toBe(201);
      expect(response.headers.get("location")).toBe(url);
      expect(pod.has(url)).toBe(true);
      if (!suffix) expect(await (await pod.fetch(url)).text()).toBe("hello");
    }
    expect((await pod.fetch(`${DEMO_ROOT}absent/`, { method: "POST" })).status).toBe(404);
  });

  it("generates a Slug when omitted and defaults the content type", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const response = await pod.fetch(DEMO_ROOT, { method: "POST" });
    expect(response.status).toBe(201);
    const location = response.headers.get("location") as string;
    expect(location).toMatch(/^https:\/\/alice\.demo\.pod\/[\da-f-]{36}$/);
    const stored = await pod.fetch(location);
    expect(stored.headers.get("content-type")).toBe("application/octet-stream");
    expect(await stored.text()).toBe("");
  });

  it("deletes files and empty containers, protects nonempty containers and root, and notifies subscribers", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, now: () => NOW });
    const changed = vi.fn();
    const unsubscribe = pod.subscribe(changed);
    const folder = `${DEMO_ROOT}folder/`;
    const file = `${folder}file`;
    await pod.fetch(folder, { method: "PUT" });
    await pod.fetch(file, { method: "PUT", body: "first" });
    await pod.fetch(file, { method: "PUT", body: "second" });
    expect((await pod.fetch(folder, { method: "DELETE" })).status).toBe(409);
    expect((await pod.fetch(DEMO_ROOT, { method: "DELETE" })).status).toBe(405);
    expect((await pod.fetch(file, { method: "DELETE" })).status).toBe(205);
    expect(pod.has(file)).toBe(false);
    expect((await pod.fetch(folder, { method: "DELETE" })).status).toBe(205);
    expect(pod.has(folder)).toBe(false);
    expect((await pod.fetch(file, { method: "DELETE" })).status).toBe(404);
    expect(changed.mock.calls).toEqual([[folder], [file], [file], [file], [folder]]);
    unsubscribe();
    await pod.fetch(file, { method: "PUT" });
    await pod.fetch(file, { method: "DELETE" });
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it("handles missing/outside URLs, OPTIONS, unknown methods, queries and fragments", async () => {
    const pod = createDemoPod({ root: `${DEMO_ROOT}storage/`, now: () => NOW });
    expect(() => createDemoPod({ root: `${DEMO_ROOT}storage` })).toThrow("must end with '/'");
    for (const url of [
      `${pod.root}missing`,
      DEMO_ROOT,
      "https://other.example/",
      `${DEMO_ROOT}storage-elsewhere/file`,
    ]) {
      expect((await pod.fetch(url)).status).toBe(404);
    }
    const options = await pod.fetch(pod.root, { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(await options.text()).toBe("");
    const unsupported = await pod.fetch(pod.root, { method: "PATCH" });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe(options.headers.get("allow"));
    expect(options.headers.get("allow")).toBe("GET, HEAD, PUT, POST, DELETE, OPTIONS");
    const url = new URL("file?download=1#fragment", pod.root);
    expect((await pod.fetch(url, { method: "put", body: "clean URL" })).status).toBe(201);
    expect(pod.has(`${pod.root}file`)).toBe(true);
    expect(await (await pod.fetch(url)).text()).toBe("clean URL");
  });

  it.each([
    [undefined, []],
    [null, []],
    ["café", [...new TextEncoder().encode("café")]],
    [new Uint8Array([0, 255, 42]), [0, 255, 42]],
    [new Uint8Array([1, 2]).buffer, [1, 2]],
    [new DataView(new Uint8Array([9, 3, 4, 9]).buffer, 1, 2), [3, 4]],
    [new Blob(["blob"]), [98, 108, 111, 98]],
  ])("stores BodyInit bytes exactly (%j)", async (body, expected) => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const url = `${DEMO_ROOT}bytes`;
    const response = await pod.fetch(url, {
      method: "PUT",
      ...(body === undefined ? {} : { body }),
    });
    expect(response.status).toBe(201);
    expect([...new Uint8Array(await (await pod.fetch(url)).arrayBuffer())]).toEqual(expected);
  });

  it("takes method, headers and body from Request objects, with explicit init overrides", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const url = `${DEMO_ROOT}request`;
    expect(
      (
        await pod.fetch(
          new Request(url, {
            method: "PUT",
            body: "request",
            headers: { "content-type": "text/plain" },
          }),
        )
      ).status,
    ).toBe(201);
    const get = await pod.fetch(new Request(url));
    expect(get.headers.get("content-type")).toBe("text/plain");
    expect(await get.text()).toBe("request");
    expect(await (await pod.fetch(new Request(url, { method: "HEAD" }))).text()).toBe("");
    expect(
      (
        await pod.fetch(new Request(url, { method: "POST", body: "ignored" }), {
          method: "PUT",
          body: "init",
          headers: { "content-type": "text/custom" },
        })
      ).status,
    ).toBe(205);
    const overridden = await pod.fetch(url);
    expect(overridden.headers.get("content-type")).toBe("text/custom");
    expect(await overridden.text()).toBe("init");
  });

  it("round-trips snapshot bytes, metadata and ETag sequence and ignores a seed on restore", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
    await pod.fetch(`${DEMO_ROOT}extra`, { method: "PUT", body: new Uint8Array([0, 255, 10]) });
    const snapshot = pod.snapshot();
    const restored = createDemoPod({
      root: DEMO_ROOT,
      snapshot,
      seed: [{ path: "ignored", body: "ignored", contentType: "text/plain" }],
      now: () => NOW,
    });
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.has(`${DEMO_ROOT}ignored`)).toBe(false);
    for (const [url] of [...snapshot.resources, ...snapshot.containers]) {
      const original = await pod.fetch(url);
      const copy = await restored.fetch(url);
      expect([...copy.headers]).toEqual([...original.headers]);
      expect(await copy.arrayBuffer()).toEqual(await original.arrayBuffer());
    }
    const write = await restored.fetch(`${DEMO_ROOT}new`, { method: "PUT", body: "new" });
    expect(snapshot.resources.map(([, resource]) => resource.etag)).not.toContain(
      write.headers.get("etag"),
    );
    expect(restored.snapshot().etagSeq).toBe(snapshot.etagSeq + 1);
    expect(pod.has(`${DEMO_ROOT}new`)).toBe(false);
    snapshot.resources[0]?.[1].body.fill(0);
    expect(await (await restored.fetch(`${DEMO_ROOT}profile/card`)).text()).toContain(DEMO_NAME);
  });

  it("uses the injected latency before handling a request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const pod = createDemoPod({ root: DEMO_ROOT, latency: 50 });
    const complete = vi.fn();
    const pending = pod.fetch(DEMO_ROOT).then(complete);
    await vi.advanceTimersByTimeAsync(49);
    expect(complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
  });

  it("deletes an orphan resource restored without parent metadata", async () => {
    const url = `${DEMO_ROOT}missing-parent/file`;
    const pod = createDemoPod({
      root: DEMO_ROOT,
      now: () => NOW,
      snapshot: {
        version: 1,
        etagSeq: 1,
        containers: [],
        resources: [
          [
            url,
            {
              body: new Uint8Array([42]),
              contentType: "application/octet-stream",
              etag: '"demo-1"',
              created: NOW,
              modified: NOW,
            },
          ],
        ],
      },
    });
    expect((await pod.fetch(url, { method: "DELETE" })).status).toBe(205);
    expect(pod.has(url)).toBe(false);
    expect(pod.has(DEMO_ROOT)).toBe(true);
  });

  it("omits invalid media-type classes and normalizes valid media-type parameters", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: [
        { path: "valid", body: "yes", contentType: "Text/Plain; charset=utf-8" },
        { path: "invalid", body: "no", contentType: "invalid" },
      ],
    });
    const listing = await graph(await pod.fetch(DEMO_ROOT), DEMO_ROOT);
    expect(objects(listing, `${DEMO_ROOT}valid`, TYPE)).toContain(
      "http://www.w3.org/ns/iana/media-types/text/plain#Resource",
    );
    expect(objects(listing, `${DEMO_ROOT}invalid`, TYPE)).toEqual([`${LDP}Resource`]);
  });

  it("propagates listing serialization failures", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const error = new Error("listing serialization failed");
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => callback?.(error, ""));
    await expect(pod.fetch(DEMO_ROOT)).rejects.toBe(error);
  });
});
