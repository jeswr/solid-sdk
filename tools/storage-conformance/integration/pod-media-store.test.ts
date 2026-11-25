// AUTHORED-BY Claude Sonnet 5.5
// Real-server proof for @jeswr/pod-media-store, on the harness every other CSS test here uses:
// `cssTarget` (file-backed CSS 7.2.0, in-process, loopback port, a seeded account, an owner-only
// root ACL and a DPoP client-credentials `auth.fetch`). Opt-in: `pnpm run test:media-store`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { parseRdf } from "@jeswr/fetch-rdf";
import { checkOwnerOnly } from "@jeswr/pod-access";
import {
  type Current,
  exposureFromOwnerOnly,
  type MediaStore,
  type MediaStoreOptions,
  openMediaStore,
} from "@jeswr/pod-media-store";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { serialize } from "@jeswr/rdf-serialize";
import { createPodClient } from "@jeswr/storage-client";
import { DataFactory } from "n3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cssTarget } from "../src/targets/css.js";
import type { RunningTarget } from "../src/types.js";

const { namedNode, literal, quad } = DataFactory;
type Quad = Parameters<typeof serialize>[0][number];
const SCHEMA = "https://schema.org/";
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const CLASS = `${SCHEMA}MediaObject`;
const s = (name: string) => namedNode(`${SCHEMA}${name}`);
const MiB = 1024 * 1024;
const AT = new Date("2026-05-17T10:00:00Z");

// ---- tiny valid fixtures, generated here ---------------------------------------------------

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real 1x1 RGB PNG; `extra` bytes ride in a private ancillary chunk (still a valid PNG). */
function pngBytes(seed: number, extra = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const pixel = deflateSync(Buffer.from([0, seed & 0xff, (seed >> 8) & 0xff, 0x40]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(extra > 0 ? [chunk("prVt", Buffer.alloc(extra, 0x61))] : []),
    chunk("IDAT", pixel),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

/** ftyp + a moov holding a version-0 mvhd (no tracks): a structurally valid, empty MP4. */
function mp4Bytes(seed: number): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from("isom"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from("isomiso2"),
  ]);
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(seed, 4); // creation time
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(0x00010000, 20); // rate
  mvhd.writeUInt16BE(0x0100, 24); // volume
  mvhd.writeUInt32BE(0x00010000, 36); // matrix a
  mvhd.writeUInt32BE(0x00010000, 52); // matrix d
  mvhd.writeUInt32BE(0x40000000, 68); // matrix w
  mvhd.writeUInt32BE(1, 96); // next track id
  return Buffer.concat([box("ftyp", ftyp), box("moov", box("mvhd", mvhd))]);
}

/** A glTF 2.0 binary container with the minimal JSON chunk and no BIN chunk. */
function glbBytes(seed: number): Buffer {
  let json = JSON.stringify({ asset: { version: "2.0", generator: `fixture-${seed}` } });
  while (Buffer.byteLength(json) % 4 !== 0) json += " ";
  const jsonBytes = Buffer.from(json);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBytes.length, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  return Buffer.concat([header, jsonBytes]);
}

function plyBytes(seed: number): Buffer {
  return Buffer.from(
    `ply\nformat ascii 1.0\ncomment fixture ${seed}\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n${seed} 0 0\n`,
  );
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---- the injected description model, serialised through the SDK's own writer ---------------

interface Model {
  id: string;
  name: string;
  binaryUrl: string;
  thumbnailUrl?: string;
  encodingFormat?: string;
  comment?: string;
}
interface Input {
  name: string;
}

const PREFIXES = { schema: SCHEMA };
const turtle = async (quads: Quad[]) => ({
  body: await serialize(quads, { prefixes: PREFIXES }),
  contentType: "text/turtle",
});

const build: MediaStoreOptions<Model, Input>["build"] = async (url, binaryUrl, input, context) => {
  const it = namedNode(`${url}#it`);
  const quads = [
    quad(it, RDF_TYPE, namedNode(CLASS)),
    quad(it, s("name"), literal(input.name)),
    quad(it, s("contentUrl"), namedNode(binaryUrl)),
    quad(it, s("encodingFormat"), literal(context.contentType)),
    quad(it, s("identifier"), literal(context.sha256)),
  ];
  if (context.thumbnailUrl !== undefined) {
    quads.push(quad(it, s("thumbnailUrl"), namedNode(context.thumbnailUrl)));
  }
  return turtle(quads);
};

const parse: MediaStoreOptions<Model, Input>["parse"] = async (url, body, contentType) => {
  const data = await parseRdf(body, contentType, { baseIRI: url });
  const it = namedNode(`${url}#it`);
  const one = (name: string) => [...data.match(it, s(name))][0]?.object.value;
  if (![...data.match(it, RDF_TYPE, namedNode(CLASS))].length) return undefined;
  const binaryUrl = one("contentUrl");
  const name = one("name");
  if (binaryUrl === undefined || name === undefined) return undefined;
  return {
    id: url,
    name,
    binaryUrl,
    thumbnailUrl: one("thumbnailUrl"),
    encodingFormat: one("encodingFormat"),
    comment: one("comment"),
  };
};

/** Rewrite a stored description with n3 quads: parse what is there, change it, serialise it. */
async function edit(
  current: Current,
  change: (quads: Quad[], it: ReturnType<typeof namedNode>) => Quad[],
) {
  const data = await parseRdf(current.body, current.contentType, { baseIRI: current.url });
  return turtle(change([...data], namedNode(`${current.url}#it`)));
}

// ---- observation of what the store really sent and what the server really answered ----------

interface Exchange {
  method: string;
  path: string;
  status: number;
  /** Request headers of interest. */
  request: Record<string, string>;
  response: Record<string, string>;
  /** `strong`, `weak` or `none`. */
  etag: string;
  requestBytes: number | null;
}

function recorder(root: string, inner: typeof fetch) {
  const log: Exchange[] = [];
  const fetchRecorded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await inner(input, init);
    const request = new Request(input instanceof Request ? input : String(input), {
      method: init?.method,
      headers: init?.headers,
    });
    const body = init?.body;
    const pick = (headers: Headers, names: string[]) =>
      Object.fromEntries(
        names.flatMap((n) => (headers.has(n) ? [[n, headers.get(n) as string]] : [])),
      );
    const etag = response.headers.get("etag");
    log.push({
      method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
      path: response.url.replace(root, "/") || String(input).replace(root, "/"),
      status: response.status,
      request: pick(request.headers, [
        "if-match",
        "if-none-match",
        "slug",
        "content-type",
        "accept",
        "link",
      ]),
      response: pick(response.headers, ["content-type", "location", "link", "allow", "accept-put"]),
      etag: etag === null ? "none" : etag.startsWith("W/") ? "weak" : "strong",
      requestBytes:
        body instanceof Blob ? body.size : typeof body === "string" ? body.length : null,
    });
    return response;
  }) as typeof fetch;
  return { fetch: fetchRecorded, log };
}

/** A ceiling sampler for process memory while an upload is in flight. */
function sampleMemory() {
  const start = process.memoryUsage();
  const peak = { ...start };
  const take = () => {
    const now = process.memoryUsage();
    for (const key of ["rss", "heapUsed", "external", "arrayBuffers"] as const) {
      peak[key] = Math.max(peak[key], now[key]);
    }
  };
  const timer = setInterval(take, 4);
  return () => {
    clearInterval(timer);
    take();
    const mb = (n: number) => Math.round((n / MiB) * 10) / 10;
    return {
      startRssMiB: mb(start.rss),
      peakRssMiB: mb(peak.rss),
      startArrayBuffersMiB: mb(start.arrayBuffers),
      peakArrayBuffersMiB: mb(peak.arrayBuffers),
      peakHeapUsedMiB: mb(peak.heapUsed),
    };
  };
}

// ---- the suite -----------------------------------------------------------------------------

const facts: Record<string, unknown> = {};
let running: RunningTarget;
let raw: typeof fetch;
let log: Exchange[];
let store: MediaStore<Model, Input>;
let storage: Awaited<ReturnType<typeof createPodClient>>["storage"];
let features: Awaited<ReturnType<typeof createPodClient>>["features"];
let typeIndexFor: () => ReturnType<typeof createTypeIndex>;
const items: Record<
  string,
  { descriptionUrl: string; binaryUrl: string; thumbnailUrl?: string; sha256: string }
> = {};

const fetchOf = (url: string, init: RequestInit = {}) => raw(url, init);

/** Every member under a container, found through raw GETs of its listing (not the store). */
async function walk(container: string): Promise<{ containers: string[]; resources: string[] }> {
  const out = { containers: [container], resources: [] as string[] };
  const response = await fetchOf(container, { headers: { accept: "text/turtle" } });
  assert.equal(response.status, 200);
  const data = await parseRdf(await response.text(), response.headers.get("content-type"), {
    baseIRI: container,
  });
  const contains = namedNode("http://www.w3.org/ns/ldp#contains");
  for (const member of data.match(namedNode(container), contains)) {
    const url = member.object.value;
    if (url.endsWith("/")) {
      const inner = await walk(url);
      out.containers.push(...inner.containers);
      out.resources.push(...inner.resources);
    } else out.resources.push(url);
  }
  return out;
}

const put = (input: {
  bytes: Blob | Uint8Array;
  contentType: string;
  extension: string;
  name: string;
  thumbnail?: Uint8Array;
}) =>
  store.put({
    bytes: input.bytes,
    contentType: input.contentType,
    extension: input.extension,
    createdAt: AT,
    description: { name: input.name },
    ...(input.thumbnail ? { thumbnail: { bytes: input.thumbnail } } : {}),
  });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`store refused: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * The same storage, but told (as `pod-access` asks callers to be told, like `acpDialect`) that this
 * deployment uses WAC. CSS 7.2.0 advertises no access-control model, so with discovered
 * capabilities alone `checkOwnerOnly` answers "unsupported-model".
 */
function informed(client: typeof storage): typeof storage {
  const features = {
    ...client.features,
    accessControl: {
      state: "available" as const,
      evidence: "caller knowledge: CSS file.json config is WAC",
      detail: { model: "wac" as const },
    },
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === "features") return features;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const ownerOnlyVia = (view: typeof storage) =>
  exposureFromOwnerOnly((url) => checkOwnerOnly({ storage: view, url, ownerWebId: running.webId }));

const openStore = (extra: Partial<MediaStoreOptions<Model, Input>> = {}) =>
  openMediaStore<Model, Input>({
    storage,
    features,
    typeIndex: typeIndexFor(),
    classes: [CLASS],
    defaultContainerName: "media",
    parse,
    build,
    locate: (model) => ({ binaryUrl: model.binaryUrl, thumbnailUrl: model.thumbnailUrl }),
    maxBytes: 64 * MiB,
    ...extra,
  });

describe("pod-media-store against a real Community Solid Server", () => {
  beforeAll(async () => {
    running = await cssTarget.start();
    const recorded = recorder(running.root, running.fetch);
    raw = recorded.fetch;
    log = recorded.log;
    const client = await createPodClient({ fetch: raw, storage: running.root });
    storage = client.storage;
    features = client.features;
    typeIndexFor = () => createTypeIndex({ storage, features, profile: running.webId, fetch: raw });
    store = ok(await openStore({ exposure: ownerOnlyVia(informed(storage)) }));
  }, 180_000);

  afterAll(async () => {
    facts.exchanges = summarise(log);
    const out = process.env.MEDIA_STORE_FACTS_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(facts, null, 2)}\n`);
    console.log(`MEDIA_STORE_FACTS ${JSON.stringify(facts)}`);
    await running?.stop();
  }, 60_000);

  it("with only discovered capabilities the real owner-only check cannot tell, so ensureLibrary creates nothing", async () => {
    const strict = ok(await openStore({ exposure: ownerOnlyVia(storage) }));
    expect(ok(await strict.checkExposure())).toBe("unknown");
    const before = log.filter((x) => x.method !== "GET" && x.method !== "HEAD").length;
    const status = ok(await strict.ensureLibrary());
    expect(status).toEqual({
      url: null,
      created: false,
      exposure: "unknown",
      probed: running.root,
    });
    // Nothing was created on the way (no PUT/POST/PATCH/DELETE reached the server), and the
    // Type Index has no entry yet.
    expect(log.filter((x) => x.method !== "GET" && x.method !== "HEAD").length).toBe(before);
    expect(strict.library).toBeNull();
    facts.discoveredAccessControl = features.accessControl.state;
  });

  it("ensureLibrary creates and privately registers the library, writes no media, probes it", async () => {
    expect(store.library).toBeNull();
    const before = log.length;
    const status = ok(await store.ensureLibrary());
    expect(status.created).toBe(true);
    expect(status.url).toBe(`${running.root}media/`);
    expect(status.exposure).toBe("private");
    // Nothing but the container was created: no media resource.
    const writes = log.slice(before).filter((x) => ["PUT", "POST", "PATCH"].includes(x.method));
    facts.ensureLibraryWrites = writes.map((x) => `${x.method} ${x.path} -> ${x.status}`);
    expect(await walk(status.url as string)).toEqual({ containers: [status.url], resources: [] });
    // A second store (a fresh session) finds it through the Type Index, privately registered.
    const again = ok(await openStore());
    expect(again.library).toBe(status.url);
    expect(ok(await store.checkExposure())).toBe("private");
  });

  it("puts a PNG, an MP4, a GLB and a PLY with real sniffing and an SDK-written description", async () => {
    const cases = [
      ["png", pngBytes(1), "image/png", ".png", "image/png"],
      ["mp4", mp4Bytes(2), "video/mp4", ".mp4", "video/mp4"],
      ["glb", glbBytes(3), "model/gltf-binary", ".glb", "model/gltf-binary"],
      ["ply", plyBytes(4), "application/octet-stream", ".ply", "application/octet-stream"],
    ] as const;
    for (const [key, bytes, type, extension, stored] of cases) {
      const out = ok(await put({ bytes, contentType: type, extension, name: `fixture ${key}` }));
      expect(out.existed).toBe(false);
      expect(out.sha256).toBe(sha(bytes));
      expect(out.binaryUrl.endsWith(`/${out.sha256}${extension}`)).toBe(true);
      items[key] = { ...out, thumbnailUrl: out.thumbnailUrl };
      const served = await fetchOf(out.binaryUrl);
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toBe(stored);
      expect(sha(new Uint8Array(await served.arrayBuffer()))).toBe(sha(bytes));
      const description = await fetchOf(out.descriptionUrl, { headers: { accept: "text/turtle" } });
      expect(description.headers.get("content-type")).toContain("text/turtle");
      const parsed = await parse(out.descriptionUrl, await description.text(), "text/turtle");
      expect(parsed).toMatchObject({ name: `fixture ${key}`, binaryUrl: out.binaryUrl });
    }
  });

  it("re-puts the same bytes (verified existing), then a thumbnail at put and attachThumbnail", async () => {
    const again = ok(
      await put({
        bytes: pngBytes(1),
        contentType: "image/png",
        extension: ".png",
        name: "other name",
      }),
    );
    expect(again.existed).toBe(true);
    expect(again.descriptionUrl).toBe(items.png?.descriptionUrl);
    expect(again.thumbnailMissing).toBe(false);
    // Same bytes, now with a thumbnail, against a description that has none: adopted, flagged.
    const flagged = ok(
      await put({
        bytes: pngBytes(1),
        contentType: "image/png",
        extension: ".png",
        name: "x",
        thumbnail: pngBytes(90),
      }),
    );
    expect(flagged).toMatchObject({
      existed: true,
      thumbnailMissing: true,
      thumbnailUrl: undefined,
    });
    // A new item with a thumbnail at put.
    const withThumb = ok(
      await put({
        bytes: mp4Bytes(5),
        contentType: "video/mp4",
        extension: ".mp4",
        name: "clip with thumbnail",
        thumbnail: pngBytes(91),
      }),
    );
    expect(withThumb.existed).toBe(false);
    expect(withThumb.thumbnailUrl?.endsWith(`/${withThumb.sha256}-thumb.png`)).toBe(true);
    items.clip = { ...withThumb, thumbnailUrl: withThumb.thumbnailUrl };
    // attachThumbnail on the GLB (put without one).
    const glb = items.glb as (typeof items)[string];
    const attached = ok(
      await store.attachThumbnail(glb.descriptionUrl, {
        bytes: pngBytes(92),
        mutate: (current, thumbnailUrl) =>
          edit(current, (quads, it) => [
            ...quads,
            quad(it, s("thumbnailUrl"), namedNode(thumbnailUrl)),
          ]),
      }),
    );
    expect(attached.thumbnailUrl).toBe(`${glb.binaryUrl.replace(/\.glb$/, "")}-thumb.png`);
    glb.thumbnailUrl = attached.thumbnailUrl;
    const thumb = await fetchOf(attached.thumbnailUrl as string);
    expect(thumb.headers.get("content-type")).toBe("image/png");
  });

  it("lists, gets, updates (conditional, with a concurrent edit) and reports a lost race", async () => {
    const listed = ok(await store.list({ limit: 10 }));
    expect(listed.items.map((item) => item.descriptionUrl).sort()).toEqual(
      Object.values(items)
        .map((item) => item.descriptionUrl)
        .sort(),
    );
    expect(listed.next).toBeNull();
    expect(listed.skipped).toEqual({ foreign: 0, unparseable: 0, pending: 0, outOfScope: 0 });
    for (const item of listed.items) {
      expect(item.etag).toMatch(/^(W\/)?"/);
      facts.listedModifiedPresent = item.modified !== null;
    }
    const ply = items.ply as (typeof items)[string];
    const got = ok(await store.get(ply.descriptionUrl));
    expect(got.value.name).toBe("fixture ply");

    // Simulated concurrent edit: another writer (raw, conditional on the same ETag) changes the
    // description between the store's read and its write.
    let calls = 0;
    const updated = ok(
      await store.update(ply.descriptionUrl, async (current) => {
        calls++;
        if (calls === 1) {
          const head = await fetchOf(ply.descriptionUrl, { method: "HEAD" });
          const other = await edit(current, (quads, it) => [
            ...quads,
            quad(it, s("comment"), literal("edited by another app")),
          ]);
          const response = await fetchOf(ply.descriptionUrl, {
            method: "PUT",
            headers: {
              "content-type": "text/turtle",
              "if-match": head.headers.get("etag") as string,
            },
            body: other.body,
          });
          expect(response.status).toBeLessThan(300);
        }
        return edit(current, (quads, it) => [
          ...quads.filter((q) => !(q.subject.equals(it) && q.predicate.equals(s("name")))),
          quad(it, s("name"), literal("renamed ply")),
        ]);
      }),
    );
    expect(calls).toBe(2);
    expect(updated.value.name).toBe("renamed ply");
    expect(updated.value.comment).toBe("edited by another app");
    facts.updateRetriesAfterConcurrentEdit = calls - 1;

    // With a single attempt the same race is a clean conflict and the other edit survives.
    const strict = ok(await openStore({ updateAttempts: 1 }));
    const lost = await strict.update(ply.descriptionUrl, async (current) => {
      const head = await fetchOf(ply.descriptionUrl, { method: "HEAD" });
      const other = await edit(current, (quads, it) => [
        ...quads,
        quad(it, s("comment"), literal("second concurrent edit")),
      ]);
      await fetchOf(ply.descriptionUrl, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-match": head.headers.get("etag") as string },
        body: other.body,
      });
      return edit(current, (quads) => quads);
    });
    expect(lost).toMatchObject({ ok: false, error: { kind: "conflict" } });
    const survived = await fetchOf(ply.descriptionUrl, { headers: { accept: "text/turtle" } });
    expect(await survived.text()).toContain("second concurrent edit");
  });

  it("an update that loses the description to a concurrent delete does not resurrect it", async () => {
    const out = ok(
      await put({
        bytes: pngBytes(31),
        contentType: "image/png",
        extension: ".png",
        name: "doomed",
      }),
    );
    const result = await store.update(out.descriptionUrl, async (current) => {
      const head = await fetchOf(out.descriptionUrl, { method: "HEAD" });
      const gone = await fetchOf(out.descriptionUrl, {
        method: "DELETE",
        headers: { "if-match": head.headers.get("etag") as string },
      });
      expect(gone.status).toBeLessThan(300);
      return edit(current, (quads) => quads);
    });
    facts.updateAfterConcurrentDelete = JSON.stringify(result);
    const after = await fetchOf(out.descriptionUrl, { method: "HEAD" });
    facts.descriptionAfterConcurrentDelete = after.status;
    expect(result.ok).toBe(false);
    expect(after.status).toBe(404);
    // Clean up the item's binary, which a delete of the description alone leaves behind.
    await fetchOf(out.binaryUrl, { method: "DELETE" });
  });

  it("removes every item and leaves nothing on the server; sweeps planted orphans", async () => {
    const library = store.library as string;
    const shard = `${library}2026/05/`;
    for (const [key, item] of Object.entries(items)) {
      ok(await store.remove(item.descriptionUrl));
      for (const url of [
        item.descriptionUrl,
        item.binaryUrl,
        ...(item.thumbnailUrl ? [item.thumbnailUrl] : []),
      ]) {
        expect((await fetchOf(url, { method: "HEAD" })).status, `${key} ${url}`).toBe(404);
        // Auxiliary resources next to a removed resource are gone too.
        expect((await fetchOf(`${url}.meta`, { method: "HEAD" })).status).toBe(404);
        expect((await fetchOf(`${url}.acl`, { method: "HEAD" })).status).toBe(404);
      }
    }
    const left = await walk(library);
    facts.leftoversAfterRemoveAll = left;
    expect(left.resources).toEqual([]);
    expect(ok(await store.list()).items).toEqual([]);

    // Plant an orphan binary (no description) and an abandoned empty description shell.
    const orphan = pngBytes(77);
    const orphanUrl = `${shard}${sha(orphan)}.png`;
    const shellUrl = `${shard}${sha(Buffer.from("shell"))}`;
    const planted = await fetchOf(orphanUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Blob([orphan as Uint8Array<ArrayBuffer>]),
    });
    expect(planted.status).toBe(201);
    const shell = await fetchOf(shellUrl, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
    facts.plantedEmptyShellStatus = shell.status;
    // A genuine item must survive the sweep.
    const keeper = ok(
      await put({
        bytes: pngBytes(78),
        contentType: "image/png",
        extension: ".png",
        name: "keeper",
      }),
    );
    // Younger than the grace period: retained.
    const young = ok(await store.sweepOrphans({ minAgeMs: 24 * 3600_000 }));
    expect(young.deleted).toBe(0);
    expect(young.retained).toBe(1);
    const swept = ok(await store.sweepOrphans({ minAgeMs: 0 }));
    facts.sweep = { young, swept };
    expect(swept.shardsSkipped).toBe(0);
    expect((await fetchOf(orphanUrl, { method: "HEAD" })).status).toBe(404);
    expect((await fetchOf(shellUrl, { method: "HEAD" })).status).toBe(404);
    expect((await fetchOf(keeper.descriptionUrl, { method: "HEAD" })).status).toBe(200);
    expect((await fetchOf(keeper.binaryUrl, { method: "HEAD" })).status).toBe(200);
    ok(await store.remove(keeper.descriptionUrl));
  });

  it("puts a body above 16 MiB through the real authenticated fetch", async () => {
    const bytes = pngBytes(100, 20 * MiB);
    expect(bytes.length).toBeGreaterThan(16 * MiB);
    const before = log.length;
    const stop = sampleMemory();
    const started = Date.now();
    const result = await put({
      bytes: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      contentType: "image/png",
      extension: ".png",
      name: "twenty MiB png",
    });
    const memory = stop();
    const out = ok(result);
    const elapsedMs = Date.now() - started;
    // What the server holds is byte-identical (streamed through a hash, not buffered).
    const stored = await fetchOf(out.binaryUrl);
    const hash = createHash("sha256");
    let received = 0;
    for await (const part of stored.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(part);
      received += part.length;
    }
    expect(received).toBe(bytes.length);
    expect(hash.digest("hex")).toBe(sha(bytes));
    const sent = log
      .slice(before)
      .filter((x) => x.method === "PUT" || x.method === "POST")
      .find((x) => (x.requestBytes ?? 0) > 16 * MiB);
    expect(sent?.status).toBeLessThan(300);
    // A second put of the same bytes is verified as already stored (bounded read of the stored copy).
    const stop2 = sampleMemory();
    const again = ok(
      await put({
        bytes: new Blob([bytes as Uint8Array<ArrayBuffer>]),
        contentType: "image/png",
        extension: ".png",
        name: "twenty MiB png",
      }),
    );
    const existingCheckMemory = stop2();
    expect(again.existed).toBe(true);
    // Above the limit: a Uint8Array handed straight to the authenticated fetch (not through the
    // store), to show what auth.fetch itself does with a non-Blob body this large.
    const probeUrl = `${store.library as string}probe-${Date.now()}.bin`;
    const direct = await (async () => {
      try {
        const response = await fetchOf(probeUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: new Uint8Array(17 * MiB),
        });
        return `status ${response.status}`;
      } catch (error) {
        return `threw ${(error as Error).name}: ${String((error as Error).message).slice(0, 140)}`;
      }
    })();
    facts.largeBody = {
      bytes: bytes.length,
      storeErrorKind: null,
      requestBytesSeen: sent?.requestBytes,
      requestStatus: sent?.status,
      elapsedMs,
      putMemory: memory,
      existingCheckMemory,
      uint8ArrayAbove16MiBDirectToAuthFetch: direct,
      note: "CSS runs in this same process, so RSS includes the server's own handling of the upload",
    };
    ok(await store.remove(out.descriptionUrl));
    await fetchOf(probeUrl, { method: "DELETE" });
  }, 180_000);

  it("records the HTTP facts the memory pod does not model", async () => {
    const base = `${store.library as string}facts/`;
    const probes: Record<string, string> = {};
    const status = async (label: string, url: string, init: RequestInit = {}) => {
      const response = await fetchOf(url, init);
      await response.body?.cancel();
      const etag = response.headers.get("etag");
      probes[label] =
        `${response.status}${etag ? ` etag=${etag.startsWith("W/") ? "weak" : "strong"}` : ""}${
          response.headers.get("location")
            ? ` location=${response.headers.get("location")?.replace(running.root, "/")}`
            : ""
        }`;
      return response;
    };
    await status("PUT container (create)", base, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
    });
    await status("PUT container (already exists)", base, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
    });
    const one = `${base}one.txt`;
    await status("PUT create-if-absent (new)", one, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-none-match": "*" },
      body: "one",
    });
    await status("PUT create-if-absent (exists)", one, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-none-match": "*" },
      body: "again",
    });
    const head = await status("HEAD resource", one, { method: "HEAD" });
    const tag = head.headers.get("etag") as string;
    await status("PUT If-Match stale", one, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-match": '"stale"' },
      body: "x",
    });
    await status("PUT If-Match current", one, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-match": tag },
      body: "two",
    });
    await status("PUT If-Match on missing", `${base}absent.txt`, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-match": tag },
      body: "x",
    });
    await status("DELETE If-Match stale", one, { method: "DELETE", headers: { "if-match": tag } });
    await status("POST Slug (new)", base, {
      method: "POST",
      headers: { "content-type": "text/plain", slug: "slugged.txt" },
      body: "s",
    });
    await status("POST Slug (taken)", base, {
      method: "POST",
      headers: { "content-type": "text/plain", slug: "slugged.txt" },
      body: "s2",
    });
    await status("POST Slug with space and unicode", base, {
      method: "POST",
      headers: { "content-type": "text/plain", slug: "a b é.txt" },
      body: "s3",
    });
    await status("POST Slug container", base, {
      method: "POST",
      headers: {
        "content-type": "text/turtle",
        slug: "child",
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
    });
    await status("POST Slug with dot segment", base, {
      method: "POST",
      headers: { "content-type": "text/plain", slug: ".." },
      body: "s4",
    });
    for (const accept of [
      "text/turtle",
      "application/ld+json",
      "application/n-triples",
      "*/*",
      "application/json",
    ]) {
      const response = await fetchOf(base, { headers: { accept } });
      probes[`GET container Accept: ${accept}`] =
        `${response.status} ${response.headers.get("content-type")} etag=${
          response.headers.get("etag")
            ? response.headers.get("etag")?.startsWith("W/")
              ? "weak"
              : "strong"
            : "none"
        }`;
      await response.body?.cancel();
    }
    const members = await walk(base);
    probes["listing members"] = [...members.containers, ...members.resources]
      .map((url) => url.replace(base, ""))
      .join(" | ");
    // Auxiliary resources: does a listing show them, and does the server create them on its own?
    const rootListing = await walk(running.root);
    probes["root listing shows .acl"] = String(
      [...rootListing.resources, ...rootListing.containers].some((url) =>
        /\.(acl|meta)$/.test(url),
      ),
    );
    await status("HEAD root .acl", `${running.root}.acl`, { method: "HEAD" });
    await status("HEAD library .meta", `${store.library}.meta`, { method: "HEAD" });
    await status("HEAD container", base, { method: "HEAD" });
    facts.probes = probes;
    expect(Object.keys(probes).length).toBeGreaterThan(10);
  });
});

function summarise(exchanges: Exchange[]) {
  const rows = new Map<
    string,
    { count: number; statuses: Set<number>; etags: Set<string>; types: Set<string> }
  >();
  for (const x of exchanges) {
    const conditional = [
      x.request["if-match"] ? "If-Match" : "",
      x.request["if-none-match"] ? `If-None-Match:${x.request["if-none-match"]}` : "",
      x.request.slug ? "Slug" : "",
    ]
      .filter(Boolean)
      .join("+");
    const key = `${x.method}${conditional ? ` [${conditional}]` : ""}`;
    const row = rows.get(key) ?? {
      count: 0,
      statuses: new Set(),
      etags: new Set(),
      types: new Set(),
    };
    row.count++;
    row.statuses.add(x.status);
    row.etags.add(x.etag);
    if (x.response["content-type"])
      row.types.add(x.response["content-type"].split(";")[0] as string);
    rows.set(key, row);
  }
  return Object.fromEntries(
    [...rows].map(([key, row]) => [
      key,
      {
        count: row.count,
        statuses: [...row.statuses].sort(),
        etag: [...row.etags],
        contentTypes: [...row.types],
      },
    ]),
  );
}
