// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunBudget } from "../core/budget.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  demoImport,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { createGoogleDriveAdapter, DEFAULT_MAX_BYTES, googleDriveAdapter } from "./adapter.js";
import { DRIVE_API, type DriveFile, FILES, GOOGLE_APPS } from "./fixtures.js";
import { DriveMetadata } from "./vocab.js";

afterEach(() => vi.restoreAllMocks());

const ROOT = `${TEST_POD_ROOT}integrations/google-drive/`;
const path = (id: string) =>
  `drive/files/${encodeURIComponent(id).replace(/~/g, "%7E").replace(/%/g, "~")}/`;
const metaUrl = (id: string) => `${ROOT}${path(id)}meta.ttl`;
const contentUrl = (file: DriveFile, extension = "") =>
  `${ROOT}${path(file.id)}content-${createHash("sha256")
    .update(file.md5Checksum ?? file.modifiedTime ?? file.id)
    .digest("hex")
    .slice(0, 24)}${extension}`;
const mediaUrl = (id: string) => `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`;
const exportUrl = (id: string, mimeType: string) =>
  `${DRIVE_API}/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType })}`;
const bytes =
  (value = "data") =>
  () =>
    new Response(value);
const BINARY: DriveFile = FILES[1] as DriveFile;
const DOC: DriveFile = FILES[2] as DriveFile;
const full = (files: unknown = FILES): FixtureRoute[] => [
  { url: `${DRIVE_API}/changes/startPageToken`, json: { startPageToken: "1000" } },
  { url: `${DRIVE_API}/files`, json: { files } },
];
const changes = (json: unknown, status = 200): FixtureRoute => ({
  url: `${DRIVE_API}/changes`,
  json,
  status,
});
type Media = Record<string, () => Response | Promise<Response>>;
const CONTENT: Media = {
  [mediaUrl(BINARY.id)]: bytes(),
  [exportUrl(DOC.id, "application/pdf")]: bytes("%PDF-synthetic"),
  [exportUrl(DOC.id, "text/plain")]: bytes("Synthetic document"),
};

/** fixtureFetch stays JSON-only; just the test's media/export routes serve bytes. */
function fixtureMediaFetch(routes: readonly FixtureRoute[], media: Media): typeof fetch {
  const json = fixtureFetch("google-drive", routes);
  return (async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.searchParams.get("alt") === "media" || url.pathname.endsWith("/export")) {
      const answer = media[url.href];
      if (!answer) throw new Error(`Missing synthetic bytes for ${url.href}`);
      return answer();
    }
    return json(input, init);
  }) as typeof fetch;
}
function setup(maxBytes?: number) {
  const adapter =
    maxBytes === undefined ? googleDriveAdapter : createGoogleDriveAdapter({ maxBytes });
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: "google-drive",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const run = (
    routes: readonly FixtureRoute[],
    opts: {
      media?: Media;
      state?: ConnectorState;
      cursor?: string;
      onState?: (state: ConnectorState) => void;
    } = {},
  ) => {
    const api = vi.fn(fixtureMediaFetch(routes, opts.media ?? {}));
    return {
      api,
      result: runImport({
        adapter,
        mode: "live",
        sourceAuth: { fetch: api },
        podWriter,
        state: opts.state,
        cursor: opts.cursor,
        onState: opts.onState,
      }),
    };
  };
  const metadata = (id: string) =>
    new DriveMetadata(`${metaUrl(id)}#it`, pod.dataset(metaUrl(id)), DataFactory);
  return { pod, podWriter, run, metadata };
}

async function imported() {
  const ctx = setup();
  const report = await ctx.run(full(), { media: CONTENT }).result;
  return { ...ctx, state: report.state as ConnectorState };
}

describe("Drive full sync", () => {
  it("maps metadata, hierarchy, binaries and exports, registering the drive root once", async () => {
    const { pod, run, metadata } = setup();
    const { api, result } = run(full(), { media: CONTENT });
    const report = await result;
    expect(report.cursor).toBe("1000");
    expect(report.categories).toEqual(["documents"]);
    expect(report.written).toHaveLength(3);
    expect(report.skipped).toBeUndefined();
    expect([...metadata("folder-1").types]).toEqual(["https://schema.org/Collection"]);
    const item = metadata(BINARY.id);
    expect([...item.types]).toEqual(["https://schema.org/DigitalDocument"]);
    expect(item.identifier).toBe(BINARY.id);
    expect(item.name).toBe(BINARY.name);
    expect(item.encodingFormat).toBe("image/png");
    expect(item.contentSize).toBe("4");
    expect(item.checksum).toBe(BINARY.md5Checksum);
    expect(item.sourceUrl).toBe(BINARY.webViewLink);
    expect(item.dateCreated?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
    expect(item.dateModified?.toISOString()).toBe("2026-06-12T09:00:00.000Z");
    expect([...item.parents]).toEqual([`${metaUrl("folder-1")}#it`]);
    expect([...item.encodings]).toEqual([contentUrl(BINARY)]);
    expect(pod.contentType(contentUrl(BINARY))).toBe("image/png");
    expect(new TextDecoder().decode(pod.bytes(contentUrl(BINARY)))).toBe("data");
    expect([...metadata(DOC.id).encodings]).toEqual([
      contentUrl(DOC, ".pdf"),
      contentUrl(DOC, ".txt"),
    ]);
    expect(pod.contentType(contentUrl(DOC, ".pdf"))).toBe("application/pdf");
    expect(pod.contentType(contentUrl(DOC, ".txt"))).toBe("text/plain");
    const index = pod.dataset(report.indexUrl);
    expect(
      index
        .getQuads(null, "http://www.w3.org/ns/solid/terms#instanceContainer", null, null)
        .map((q) => q.object.value),
    ).toEqual([`${ROOT}drive/`]);
    expect(pod.get(metaUrl(BINARY.id))).toContain("http://www.w3.org/ns/prov#wasDerivedFrom");
    const requests = api.mock.calls.map(([input]) => new URL(String(input)));
    expect(requests[0]?.pathname).toBe("/drive/v3/changes/startPageToken");
    expect(Object.fromEntries(requests[1]?.searchParams ?? [])).toMatchObject({
      q: "trashed = false",
      pageSize: "1000",
      spaces: "drive",
    });
    expect(requests[1]?.searchParams.get("fields")).toContain(
      "md5Checksum,modifiedTime,createdTime,ownedByMe,webViewLink,trashed",
    );
    const quads = [...pod.dataset(metaUrl(BINARY.id))].filter(
      (q) => !q.predicate.value.startsWith("http://www.w3.org/ns/prov#"),
    );
    quads.sort((a, b) =>
      `${a.subject.value} ${a.predicate.value} ${a.object.value}`.localeCompare(
        `${b.subject.value} ${b.predicate.value} ${b.object.value}`,
      ),
    );
    await expect(
      `# AUTHORED-BY Codex GPT-6.1-Sol\n${new Writer({ format: "N-Triples" }).quadsToString(quads)}`,
    ).toMatchFileSnapshot("./__snapshots__/mapping.ttl");
  });

  it("provides a JSON-only metadata demo and validates cap options", async () => {
    const { report } = await demoImport(googleDriveAdapter);
    expect(report.written).toHaveLength(3);
    expect(DEFAULT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(createGoogleDriveAdapter().oauth?.scopes).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
    for (const maxBytes of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => createGoogleDriveAdapter({ maxBytes })).toThrow("maxBytes");
    expect(createGoogleDriveAdapter({ maxBytes: 0 })).toBeDefined();
  });

  it("paginates, escapes ids, omits unsafe IRIs, and counts only malformed source items", async () => {
    const { run, pod, metadata } = setup();
    const odd: DriveFile = {
      id: "x/<>~#",
      name: "Literal <name>",
      parents: ["a/b", "..", "", null as unknown as string],
      webViewLink: "https://bad.test/> . <s> <p> <o",
      createdTime: "invalid",
      modifiedTime: "invalid",
      size: "invalid",
      ownedByMe: false,
    };
    const { api, result } = run([
      full()[0] as FixtureRoute,
      {
        url: `${DRIVE_API}/files`,
        json: {
          files: [null, {}, { id: ".." }, { id: "." }, { id: "\ud800" }, { id: 8 }, odd],
          nextPageToken: "p/2",
        },
      },
      { url: `${DRIVE_API}/files`, json: { files: [FILES[0]] } },
    ]);
    expect((await result).skipped).toBe(6);
    expect(metadata(odd.id).identifier).toBe(odd.id);
    expect(metadata(odd.id).sourceUrl).toBeUndefined();
    expect(metadata(odd.id).dateCreated).toBeUndefined();
    expect(metadata(odd.id).contentSize).toBeUndefined();
    expect([...metadata(odd.id).parents]).toEqual([`${metaUrl("a/b")}#it`]);
    expect(pod.get(metaUrl(odd.id))).toContain("Literal <name>");
    expect(api.mock.calls.map(([u]) => new URL(String(u)).searchParams.get("pageToken"))).toEqual([
      null,
      null,
      "p/2",
    ]);
  });

  it("reuses unchanged content and replaces changed bytes or changed MIME types", async () => {
    const { pod, run, state, metadata } = await imported();
    const before = pod.urls();
    const rerun = run(full());
    await rerun.result;
    expect(rerun.api.mock.calls).toHaveLength(2);
    expect(pod.urls()).toEqual(before);
    const renamed = { ...BINARY, name: "Renamed", parents: ["folder-2"] };
    await run(
      [changes({ changes: [{ fileId: BINARY.id, file: renamed }], newStartPageToken: "1001" })],
      { state },
    ).result;
    expect(metadata(BINARY.id).name).toBe("Renamed");
    expect([...metadata(BINARY.id).parents]).toEqual([`${metaUrl("folder-2")}#it`]);
    const changed = { ...BINARY, md5Checksum: "new", modifiedTime: "2026-06-13T09:00:00Z" };
    await run(full([changed]), { media: { [mediaUrl(BINARY.id)]: bytes("next") } }).result;
    expect(new TextDecoder().decode(pod.bytes(contentUrl(changed)))).toBe("next");
    expect(pod.bytes(contentUrl(BINARY))).toBeUndefined();
    const rdf = { ...changed, mimeType: "text/turtle; charset=utf-8", md5Checksum: "rdf" };
    await run(full([rdf]), { media: { [mediaUrl(BINARY.id)]: bytes("<x> <y> <z>.") } }).result;
    expect(pod.contentType(contentUrl(rdf))).toBe("application/octet-stream");
  });

  it("downloads again without version fields or when one version field changes", async () => {
    const { run } = setup();
    const bare = { ...BINARY, md5Checksum: undefined, modifiedTime: undefined };
    await run(full([bare]), { media: CONTENT }).result;
    const next = run(full([bare]), { media: CONTENT });
    await next.result;
    expect(next.api.mock.calls).toHaveLength(3);
    await run(full([BINARY]), { media: CONTENT }).result;
    const changedTime = run(full([{ ...BINARY, modifiedTime: "2026-06-14T00:00:00Z" }]), {
      media: CONTENT,
    });
    await changedTime.result;
    expect(changedTime.api.mock.calls).toHaveLength(3);
  });
});

describe("Drive content policy", () => {
  it.each([
    [{ ownedByMe: false }, "not-owned"],
    [{ ownedByMe: undefined }, "not-owned"],
    [{ size: "5" }, "size-cap-exceeded"],
    [{ size: "9007199254740993" }, "size-cap-exceeded"],
    [{ size: undefined }, "unknown-size"],
    [{ size: "-1" }, "unknown-size"],
    [{ mimeType: undefined }, "missing-mime-type"],
    [{ mimeType: " " }, "missing-mime-type"],
    [{ mimeType: `${GOOGLE_APPS}form` }, "unsupported-google-apps-type"],
  ] as const)("keeps explanatory metadata for %j", async (patch, reason) => {
    const { run, metadata } = setup(4);
    const { result, api } = run(full([{ ...BINARY, ...patch }]));
    expect((await result).skipped).toBeUndefined();
    expect(metadata(BINARY.id).contentSkipped).toBe(reason);
    expect([...metadata(BINARY.id).encodings]).toEqual([]);
    expect(api.mock.calls).toHaveLength(2);
  });

  it("accepts bytes exactly at the cap and zero-length files at zero", async () => {
    const { run, pod } = setup(4);
    await run(full([BINARY]), { media: CONTENT }).result;
    expect(pod.bytes(contentUrl(BINARY))).toHaveLength(4);
    const empty = setup(0);
    await empty.run(full([{ ...BINARY, size: "0" }]), {
      media: { [mediaUrl(BINARY.id)]: bytes("") },
    }).result;
    expect(empty.pod.bytes(contentUrl(BINARY))).toHaveLength(0);
  });

  it("stops and cancels an unadvertised oversized stream without writing bytes", async () => {
    const { run, metadata, pod } = setup(4);
    const cancel = vi.fn();
    const { api, result } = run(full([BINARY]), {
      media: {
        [mediaUrl(BINARY.id)]: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.enqueue(new Uint8Array([4, 5]));
              },
              cancel,
            }),
          ),
      },
    });
    await result;
    const signal = api.mock.calls[2]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(metadata(BINARY.id).contentSkipped).toBe("size-cap-exceeded");
    expect(pod.bytes(contentUrl(BINARY))).toBeUndefined();
  });

  it("rejects an oversized advertised body before reading it", async () => {
    const { run, metadata } = setup(4);
    const cancel = vi.fn();
    await run(full([BINARY]), {
      media: {
        [mediaUrl(BINARY.id)]: () =>
          new Response(new ReadableStream({ cancel }), { headers: { "content-length": "5" } }),
      },
    }).result;
    expect(cancel).toHaveBeenCalledOnce();
    expect(metadata(BINARY.id).contentSkipped).toBe("size-cap-exceeded");
  });

  it.each(["spreadsheet", "presentation", "drawing"])("exports %s as PDF only", async (type) => {
    const { run, pod, metadata } = setup();
    const { api, result } = run(full([{ ...DOC, mimeType: `${GOOGLE_APPS}${type}` }]), {
      media: CONTENT,
    });
    await result;
    expect(api.mock.calls).toHaveLength(3);
    expect([...metadata(DOC.id).encodings]).toEqual([contentUrl(DOC, ".pdf")]);
    expect(pod.bytes(contentUrl(DOC, ".txt"))).toBeUndefined();
  });

  it("removes old copies when ownership, eligibility, or file kind changes", async () => {
    const { run, pod, metadata } = await imported();
    await run(
      full([
        { ...BINARY, ownedByMe: false },
        { ...DOC, mimeType: `${GOOGLE_APPS}folder` },
      ]),
    ).result;
    expect(pod.bytes(contentUrl(BINARY))).toBeUndefined();
    expect(metadata(BINARY.id).contentSkipped).toBe("not-owned");
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".txt"))).toBeUndefined();
    expect([...metadata(DOC.id).types]).toEqual(["https://schema.org/Collection"]);
  });

  it("switches representations and removes obsolete content files", async () => {
    const { run, pod } = await imported();
    const changed = { ...DOC, mimeType: "text/plain", size: "4", md5Checksum: "changed" };
    await run(full([changed]), {
      media: { [mediaUrl(DOC.id)]: bytes() },
    }).result;
    expect(pod.bytes(contentUrl(changed))).toHaveLength(4);
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".txt"))).toBeUndefined();
  });

  it.each([
    "application/pdf",
    "text/plain",
  ])("keeps metadata only when %s exceeds Google's export limit", async (type) => {
    const { run, pod, metadata } = setup();
    const media: Media = {
      ...CONTENT,
      [exportUrl(DOC.id, type)]: () =>
        Response.json(
          { error: { errors: [{ reason: "exportSizeLimitExceeded" }] } },
          { status: 403 },
        ),
    };
    const report = await run(full([DOC]), { media }).result;
    expect(report.skipped).toBeUndefined();
    expect(metadata(DOC.id).contentSkipped).toBe("exportSizeLimitExceeded");
    expect([...metadata(DOC.id).encodings]).toEqual([]);
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".txt"))).toBeUndefined();
  });
});

describe("Drive incremental sync", () => {
  it("follows changes pages, keeps unchanged files, and applies the final change per id", async () => {
    const { run, pod, state, metadata } = await imported();
    const renamed = { ...BINARY, name: "Updated" };
    const { api, result } = run(
      [
        changes({
          changes: [
            { fileId: BINARY.id, removed: true },
            { fileId: DOC.id, file: DOC },
          ],
          nextPageToken: "page-2",
        }),
        changes({ changes: [{ fileId: BINARY.id, file: renamed }], newStartPageToken: "2000" }),
      ],
      { state },
    );
    const report = await result;
    expect(report.cursor).toBe("2000");
    expect(metadata(BINARY.id).name).toBe("Updated");
    expect(pod.get(metaUrl("folder-1"))).toBeDefined();
    expect(
      api.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("pageToken")),
    ).toEqual(["1000", "page-2"]);
    expect(new URL(String(api.mock.calls[0]?.[0])).searchParams.get("fields")).toContain(
      "changes(fileId,removed,file(",
    );
  });

  it("removes metadata and every possible content representation, including repeat deletions", async () => {
    const { run, pod, state } = await imported();
    const routes = [
      changes({
        changes: [
          { fileId: BINARY.id, removed: true },
          { fileId: DOC.id, file: { ...DOC, trashed: true } },
        ],
        newStartPageToken: "2000",
      }),
    ];
    await run(routes, { state }).result;
    await run(routes, { state }).result;
    for (const id of [BINARY.id, DOC.id]) {
      expect(pod.get(metaUrl(id))).toBeUndefined();
      expect(pod.urls().filter((url) => url.startsWith(`${ROOT}${path(id)}content`))).toEqual([]);
    }
  });

  it("counts malformed changes and allows empty incremental pages", async () => {
    const { run } = setup();
    const report = await run(
      [
        changes({
          changes: [
            null,
            {},
            { fileId: ".." },
            { fileId: "x", file: { id: "other" } },
            { fileId: "missing" },
          ],
          nextPageToken: "2",
        }),
        changes({ changes: [], newStartPageToken: "3" }),
      ],
      { cursor: "1" },
    ).result;
    expect(report.skipped).toBe(5);
    expect(report.cursor).toBe("3");
  });

  it.each([
    404, 410,
  ])("does one full resync after HTTP %i, discarding partially fetched changes", async (status) => {
    const { run, pod, state } = await imported();
    const { api, result } = run(
      [
        changes({ changes: [{ fileId: "folder-1", removed: true }], nextPageToken: "next" }),
        changes({}, status),
        ...full(),
      ],
      { state },
    );
    expect((await result).cursor).toBe("1000");
    expect(pod.get(metaUrl("folder-1"))).toBeDefined();
    expect(
      api.mock.calls.filter(([u]) => String(u).includes("/changes/startPageToken")),
    ).toHaveLength(1);
  });

  it("treats trashed full-list entries as deletions", async () => {
    const { run, pod } = await imported();
    await run(full([{ ...BINARY, trashed: true }])).result;
    expect(pod.get(metaUrl(BINARY.id))).toBeUndefined();
  });

  it.each([401, 403, 429, 500])("preserves the host checkpoint on HTTP %i", async (status) => {
    const { run, state } = await imported();
    const onState = vi.fn();
    await expect(run([changes({}, status)], { state, onState }).result).rejects.toMatchObject({
      status,
    });
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor, lastOutcome: "error", counts: state.counts }),
    );
  });

  it("does not interpret a failed media request as an expired changes token", async () => {
    const { run } = setup();
    await expect(
      run([changes({ changes: [{ fileId: BINARY.id, file: BINARY }], newStartPageToken: "2" })], {
        cursor: "1",
        media: { [mediaUrl(BINARY.id)]: () => new Response(null, { status: 404 }) },
      }).result,
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    null,
    {},
    { startPageToken: "" },
  ])("refuses a missing initial checkpoint: %j", async (json) => {
    const { run } = setup();
    await expect(
      run([{ url: `${DRIVE_API}/changes/startPageToken`, json }]).result,
    ).rejects.toThrow("start page token");
  });
  it.each([
    { changes: [] },
    { changes: [], newStartPageToken: 7 },
  ])("refuses a missing changes checkpoint: %j", async (json) => {
    const { run } = setup();
    await expect(run([changes(json)], { cursor: "1" }).result).rejects.toThrow(
      /new start page token|newStartPageToken/,
    );
  });
  it("rejects repeated list and changes page tokens", async () => {
    const { run } = setup();
    await expect(
      run([
        full()[0] as FixtureRoute,
        { url: `${DRIVE_API}/files`, json: { files: [], nextPageToken: "same" } },
      ]).result,
    ).rejects.toThrow("repeated a page token");
    await expect(
      run([changes({ changes: [], nextPageToken: "same" })], { cursor: "same" }).result,
    ).rejects.toThrow("repeated a page token");
  });
  it("surfaces full-resync failures without trying another resync", async () => {
    const { run } = setup();
    const { result, api } = run(
      [changes({}, 410), { url: `${DRIVE_API}/changes/startPageToken`, json: {}, status: 410 }],
      { cursor: "1" },
    );
    await expect(result).rejects.toMatchObject({ status: 410 });
    expect(api.mock.calls).toHaveLength(2);
  });
});

describe("Drive full-snapshot reconciliation", () => {
  it("prunes files absent after an expired cursor and resets discarded skip counts", async () => {
    const { run, pod, state } = await imported();
    const report = await run(
      [
        changes({ changes: [null], nextPageToken: "expired" }),
        changes({}, 410),
        ...full([FILES[0]]),
      ],
      { state },
    ).result;
    expect(report.skipped).toBeUndefined();
    expect(pod.get(metaUrl(BINARY.id))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeUndefined();
    expect(pod.get(metaUrl("folder-1"))).toBeDefined();
  });

  it("keeps existing files when a full snapshot contains malformed items", async () => {
    const { run, pod } = await imported();
    const report = await run(full([null])).result;
    expect(report.skipped).toBe(1);
    expect(pod.get(metaUrl(BINARY.id))).toBeDefined();
    await expect(run(full("invalid")).result).rejects.toThrow("invalid files page");
    expect(pod.get(metaUrl(BINARY.id))).toBeDefined();
  });

  it("ignores foreign, nested and orphan listing entries instead of following them", async () => {
    const { run, podWriter } = setup();
    const base = `${ROOT}drive/files/`;
    const dataset = new Store();
    const container = new Container(base, dataset, DataFactory);
    for (const url of [
      "https://outside.test/private/",
      `${base}deep/path/`,
      `${base}orphan/`,
      `${base}../`,
      `${base}bad~zz/`,
      `${base}raw%2Fid/`,
    ])
      container.contains.add(new Resource(url, dataset, DataFactory));
    const originalRead = podWriter.read;
    const read = vi
      .spyOn(podWriter, "read")
      .mockImplementation(async (slug) =>
        slug === "drive/files/" ? { dataset, etag: '"v1"' } : originalRead(slug),
      );
    await run(full([])).result;
    expect(read.mock.calls.map(([slug]) => slug)).toContain("drive/files/orphan/meta.ttl");
    expect(read.mock.calls.map(([slug]) => slug)).not.toContain("drive/files/deep/path/meta.ttl");
    expect(read.mock.calls.some(([slug]) => slug.includes("outside.test"))).toBe(false);
  });

  it("ignores a canonical local path whose metadata has a different source id", async () => {
    const { run, pod, podWriter } = setup();
    const slug = `${path("mismatch")}meta.ttl`;
    const dataset = new Store();
    const item = new DriveMetadata(`${ROOT}${slug}#it`, dataset, DataFactory);
    item.identifier = "other";
    await podWriter.write({
      slug,
      dataset,
      category: "documents",
      forClass: "https://schema.org/DigitalDocument",
    });
    await run(full([])).result;
    expect(pod.get(`${ROOT}${slug}`)).toBeDefined();
  });

  it("does not prune existing files if a later full-list page fails", async () => {
    const { run, pod } = await imported();
    await expect(
      run([
        full()[0] as FixtureRoute,
        { url: `${DRIVE_API}/files`, json: { files: [], nextPageToken: "2" } },
        { url: `${DRIVE_API}/files`, json: {}, status: 500 },
      ]).result,
    ).rejects.toMatchObject({ status: 500 });
    expect(pod.get(metaUrl(BINARY.id))).toBeDefined();
  });
});

describe("Drive malformed snapshots", () => {
  const invalid = [null, [], "invalid", 7, false, {}, { error: "unexpected" }];
  const invalidTokens = [null, 7, false, {}, [], ""];
  const filePages = [
    ...invalid,
    ...[null, {}, "invalid", 7, false].map((files) => ({ files })),
    ...invalidTokens.map((nextPageToken) => ({ files: [], nextPageToken })),
  ];
  const changePages = [
    ...invalid,
    ...[undefined, null, {}, "invalid", 7, false].map((changes) => ({
      changes,
      newStartPageToken: "2000",
    })),
    ...invalidTokens.map((nextPageToken) => ({
      changes: [],
      nextPageToken,
      newStartPageToken: "2000",
    })),
    ...invalidTokens.map((newStartPageToken) => ({ changes: [], newStartPageToken })),
    { changes: [], nextPageToken: "next", newStartPageToken: "2000" },
  ];

  it.each(filePages)("rejects a malformed full-list page without pruning: %j", async (json) => {
    const { run, pod, state, podWriter } = await imported();
    const before = pod.urls();
    const remove = vi.spyOn(podWriter, "remove");
    const read = vi.spyOn(podWriter, "read");
    const onState = vi.fn();
    await expect(
      run(
        [
          changes({}, 410),
          full()[0] as FixtureRoute,
          { url: `${DRIVE_API}/files`, json: { files: [], nextPageToken: "next" } },
          { url: `${DRIVE_API}/files`, json },
        ],
        { state, onState },
      ).result,
    ).rejects.toThrow(/invalid/);
    expect(remove).not.toHaveBeenCalled();
    expect(read.mock.calls.map(([slug]) => slug)).not.toContain("drive/files/");
    expect(pod.urls()).toEqual(before);
    expect(pod.bytes(contentUrl(BINARY))).toBeDefined();
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor, counts: state.counts, lastOutcome: "error" }),
    );
  });

  it.each(
    changePages,
  )("rejects a malformed changes page before applying mutations: %j", async (json) => {
    const { run, pod, state, podWriter } = await imported();
    const remove = vi.spyOn(podWriter, "remove");
    const onState = vi.fn();
    await expect(
      run(
        [
          changes({ changes: [{ fileId: BINARY.id, removed: true }], nextPageToken: "next" }),
          changes(json),
        ],
        { state, onState },
      ).result,
    ).rejects.toThrow(/invalid|conflicting/);
    expect(remove).not.toHaveBeenCalled();
    expect(pod.get(metaUrl(BINARY.id))).toBeDefined();
    expect(pod.bytes(contentUrl(BINARY))).toBeDefined();
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor, lastOutcome: "error" }),
    );
  });

  it("counts every source request and page item on one budget, including a full fallback", async () => {
    const requests = vi.spyOn(RunBudget.prototype, "request");
    const items = vi.spyOn(RunBudget.prototype, "items");
    const { run } = setup();
    await run(
      [changes({ changes: [null], nextPageToken: "expired" }), changes({}, 410), ...full()],
      { cursor: "old", media: CONTENT },
    ).result;
    expect(requests).toHaveBeenCalledTimes(7);
    expect(items.mock.calls).toEqual([[1], [FILES.length]]);
    expect(new Set([...requests.mock.contexts, ...items.mock.contexts]).size).toBe(1);
  });
});

describe("Drive staged representations", () => {
  it("keeps mutations queued until a failed predecessor has finished rollback", async () => {
    const { podWriter, pod, run, metadata } = await imported();
    const first = { ...BINARY, md5Checksum: "first" };
    const second = { ...BINARY, md5Checksum: "second" };
    const committing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const write = podWriter.write;
    let failFirst = true;
    vi.spyOn(podWriter, "write").mockImplementation(async (doc, conditions) => {
      if (doc.slug === `${path(BINARY.id)}meta.ttl` && failFirst) {
        failFirst = false;
        committing.resolve();
        await resume.promise;
        throw new Error("Interrupted metadata write");
      }
      return write(doc, conditions);
    });
    const firstResult = run(full([first]), { media: CONTENT }).result;
    const failed = expect(firstResult).rejects.toThrow("Interrupted metadata write");
    await committing.promise;
    const downloaded = Promise.withResolvers<void>();
    const secondResult = run(full([second]), {
      media: {
        [mediaUrl(BINARY.id)]: () => {
          downloaded.resolve();
          return new Response("next");
        },
      },
    }).result;
    await downloaded.promise;
    // Drain the response reader and hash microtasks so the second mutation is queued.
    await setImmediate();
    expect(pod.bytes(contentUrl(second))).toBeUndefined();
    resume.resolve();
    await failed;
    await secondResult;
    expect(pod.bytes(contentUrl(first))).toBeUndefined();
    expect(new TextDecoder().decode(pod.bytes(contentUrl(second)))).toBe("next");
    expect([...metadata(BINARY.id).encodings]).toEqual([contentUrl(second)]);
  });

  it.each([
    false,
    true,
  ])("preserves the winner when an older import commits last (same version: %s)", async (sameVersion) => {
    const { pod, podWriter, run, metadata, state } = await imported();
    const older = { ...BINARY, md5Checksum: "older", modifiedTime: "2026-07-01T00:00:00Z" };
    const newer = {
      ...older,
      name: "Newer metadata",
      md5Checksum: sameVersion ? older.md5Checksum : "newer",
      modifiedTime: sameVersion ? older.modifiedTime : "2026-07-02T00:00:00Z",
    };
    const downloading = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const oldRun = run(
      [changes({ changes: [{ fileId: BINARY.id, file: older }], newStartPageToken: "old" })],
      {
        state,
        media: {
          [mediaUrl(BINARY.id)]: async () => {
            downloading.resolve();
            await resume.promise;
            return new Response("old!");
          },
        },
      },
    );
    const failed = expect(oldRun.result).rejects.toMatchObject({ status: 412 });
    await downloading.promise;
    const write = vi.spyOn(podWriter, "write");
    const read = vi.spyOn(podWriter, "read");
    const newRoutes = [
      changes({ changes: [{ fileId: BINARY.id, file: newer }], newStartPageToken: "new" }),
    ];
    await run(newRoutes, { state, media: { [mediaUrl(BINARY.id)]: bytes("new!") } }).result;
    const winningMetadata = pod.get(metaUrl(BINARY.id));
    expect(read.mock.calls.map(([slug]) => slug)).toContain(`${path(BINARY.id)}meta.ttl`);
    resume.resolve();
    await failed;
    expect(
      write.mock.calls.filter(([doc]) => doc.slug === `${path(BINARY.id)}meta.ttl`),
    ).toHaveLength(2);
    expect(pod.get(metaUrl(BINARY.id))).toBe(winningMetadata);
    expect(metadata(BINARY.id).name).toBe("Newer metadata");
    expect([...metadata(BINARY.id).encodings]).toEqual([contentUrl(newer)]);
    expect(new TextDecoder().decode(pod.bytes(contentUrl(newer)))).toBe("new!");
    if (!sameVersion) expect(pod.bytes(contentUrl(older))).toBeUndefined();
    // The unchanged retry must still find the winning bytes, without another media request.
    expect((await run(newRoutes, { state }).result).cursor).toBe("new");
    expect(new TextDecoder().decode(pod.bytes(contentUrl(newer)))).toBe("new!");
  });

  it("does not stage a PDF when the later text download fails", async () => {
    const { pod, run } = setup();
    await expect(
      run(full([DOC]), {
        media: {
          ...CONTENT,
          [exportUrl(DOC.id, "text/plain")]: () => new Response(null, { status: 500 }),
        },
      }).result,
    ).rejects.toMatchObject({ status: 500 });
    expect(pod.get(metaUrl(DOC.id))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeUndefined();
  });

  it.each([
    "ownership",
    "eligibility",
    "folder",
  ])("cleans abandoned exports on a metadata-only %s retry", async (policy) => {
    const { pod, podWriter, run, metadata } = setup();
    const writeBinary = podWriter.writeBinary;
    const remove = podWriter.remove;
    if (!writeBinary || !remove) throw new Error("Expected memory Pod binary and delete ports");
    const failedWrite = vi.spyOn(podWriter, "writeBinary").mockImplementation(async (doc) => {
      if (doc.slug.endsWith(".txt")) throw new Error("Interrupted export");
      return writeBinary(doc);
    });
    // Simulate a connection outage that also prevents best-effort rollback.
    const failedCleanup = vi.spyOn(podWriter, "remove").mockRejectedValue(new Error("Offline"));
    await expect(run(full([DOC]), { media: CONTENT }).result).rejects.toThrow("Interrupted export");
    expect(pod.get(metaUrl(DOC.id))).toBeUndefined();
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeDefined();
    failedWrite.mockRestore();
    failedCleanup.mockRestore();
    // Include a legacy orphan from before versioned paths were introduced.
    await writeBinary({
      slug: `${path(DOC.id)}content.pdf`,
      contentType: "application/pdf",
      body: new Uint8Array([1]),
    });
    const retry = {
      ...DOC,
      ...(policy === "ownership"
        ? { ownedByMe: false }
        : {
            mimeType: `${GOOGLE_APPS}${policy === "folder" ? "folder" : "form"}`,
          }),
    };
    await run(full([retry])).result;
    expect(metadata(DOC.id).identifier).toBe(DOC.id);
    expect([...metadata(DOC.id).encodings]).toEqual([]);
    expect(pod.urls().filter((url) => url.startsWith(`${ROOT}${path(DOC.id)}content`))).toEqual([]);
  });

  it("rolls back partial writes and preserves previously committed representations", async () => {
    const { pod, podWriter, run, metadata } = await imported();
    const newer = { ...DOC, modifiedTime: "2026-07-02T00:00:00Z" };
    const writeBinary = podWriter.writeBinary;
    if (!writeBinary) throw new Error("Expected memory Pod binary port");
    vi.spyOn(podWriter, "writeBinary").mockImplementation(async (doc) => {
      const result = await writeBinary(doc);
      if (doc.slug.endsWith(".txt")) throw new Error("Lost PUT response");
      return result;
    });
    await expect(run(full([newer]), { media: CONTENT }).result).rejects.toThrow(
      "Lost PUT response",
    );
    expect([...metadata(DOC.id).encodings]).toEqual([
      contentUrl(DOC, ".pdf"),
      contentUrl(DOC, ".txt"),
    ]);
    expect(pod.bytes(contentUrl(DOC, ".pdf"))).toBeDefined();
    expect(pod.bytes(contentUrl(DOC, ".txt"))).toBeDefined();
    expect(pod.bytes(contentUrl(newer, ".pdf"))).toBeUndefined();
    expect(pod.bytes(contentUrl(newer, ".txt"))).toBeUndefined();
  });

  it("keeps committed content when a metadata-only write fails", async () => {
    const { pod, podWriter, run, metadata } = await imported();
    const write = podWriter.write;
    vi.spyOn(podWriter, "write").mockImplementation(async (doc, conditions) => {
      if (doc.slug === `${path(BINARY.id)}meta.ttl`) throw new Error("Metadata failure");
      return write(doc, conditions);
    });
    const remove = vi.spyOn(podWriter, "remove");
    await expect(run(full([{ ...BINARY, ownedByMe: false }])).result).rejects.toThrow(
      "Metadata failure",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(metadata(BINARY.id).contentSkipped).toBeUndefined();
    expect(pod.bytes(contentUrl(BINARY))).toBeDefined();
  });

  it("retries orphan cleanup even if the previous metadata commit already succeeded", async () => {
    const { pod, podWriter, run, metadata, state } = await imported();
    const next = { ...BINARY, md5Checksum: "next" };
    const remove = vi.spyOn(podWriter, "remove").mockRejectedValue(new Error("Cleanup failure"));
    const onState = vi.fn();
    const routes = [
      changes({ changes: [{ fileId: BINARY.id, file: next }], newStartPageToken: "2000" }),
    ];
    await expect(run(routes, { state, media: CONTENT, onState }).result).rejects.toThrow(
      "Cleanup failure",
    );
    expect(metadata(BINARY.id).checksum).toBe("next");
    expect(pod.bytes(contentUrl(BINARY))).toBeDefined();
    expect(pod.bytes(contentUrl(next))).toBeDefined();
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor, lastOutcome: "error" }),
    );
    remove.mockRestore();
    const retry = run(routes, { state });
    expect((await retry.result).cursor).toBe("2000");
    expect(retry.api).toHaveBeenCalledOnce();
    expect(pod.bytes(contentUrl(BINARY))).toBeUndefined();
    expect(pod.bytes(contentUrl(next))).toBeDefined();
  });

  it("only cleans canonical representation children of the file's own container", async () => {
    const { podWriter, run } = setup();
    const base = `${ROOT}${path(BINARY.id)}`;
    const listing = new Store();
    const container = new Container(base, listing, DataFactory);
    const valid = ["content", "content.pdf", "content.txt", `content-${"a".repeat(24)}.pdf`];
    const foreign = [
      "https://outside.test/content.pdf",
      `${base}../content.pdf`,
      `${base}nested/content.pdf`,
      `${base}content.pdf#fragment`,
      `${base}content.pdf?query`,
      `${base}content.pdf\n`,
      `${base}content-%61.pdf`,
      `${base}meta.ttl`,
      `${base}notes.txt`,
      `${base}content-invalid.pdf`,
    ];
    for (const url of [...valid.map((name) => `${base}${name}`), ...foreign])
      container.contains.add(new Resource(url, listing, DataFactory));
    const read = podWriter.read;
    vi.spyOn(podWriter, "read").mockImplementation(async (slug) =>
      slug === path(BINARY.id) ? { dataset: listing, etag: '"listing"' } : read(slug),
    );
    const remove = vi.spyOn(podWriter, "remove");
    await run(full([{ ...BINARY, ownedByMe: false }])).result;
    expect(remove.mock.calls.map(([slug]) => slug)).toEqual(
      valid.map((name) => `${path(BINARY.id)}${name}`),
    );
  });
});
