// AUTHORED-BY Codex GPT-6.1-Sol
import { Container, Resource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
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

const ROOT = `${TEST_POD_ROOT}integrations/google-drive/`;
const path = (id: string) =>
  `drive/files/${encodeURIComponent(id).replace(/~/g, "%7E").replace(/%/g, "~")}/`;
const metaUrl = (id: string) => `${ROOT}${path(id)}meta.ttl`;
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
type Media = Record<string, () => Response>;
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
    expect([...item.encodings]).toEqual([`${ROOT}${path(BINARY.id)}content`]);
    expect(pod.contentType(`${ROOT}${path(BINARY.id)}content`)).toBe("image/png");
    expect(new TextDecoder().decode(pod.bytes(`${ROOT}${path(BINARY.id)}content`))).toBe("data");
    expect([...metadata(DOC.id).encodings]).toEqual([
      `${ROOT}${path(DOC.id)}content.pdf`,
      `${ROOT}${path(DOC.id)}content.txt`,
    ]);
    expect(pod.contentType(`${ROOT}${path(DOC.id)}content.pdf`)).toBe("application/pdf");
    expect(pod.contentType(`${ROOT}${path(DOC.id)}content.txt`)).toBe("text/plain");
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

  it.each([null, {}, { files: "invalid" }])("accepts empty or sparse lists: %j", async (json) => {
    const { run } = setup();
    const report = await run([full()[0] as FixtureRoute, { url: `${DRIVE_API}/files`, json }])
      .result;
    expect(report.written).toEqual([]);
    expect(report.cursor).toBe("1000");
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
    expect(new TextDecoder().decode(pod.bytes(`${ROOT}${path(BINARY.id)}content`))).toBe("next");
    const rdf = { ...changed, mimeType: "text/turtle; charset=utf-8" };
    await run(full([rdf]), { media: { [mediaUrl(BINARY.id)]: bytes("<x> <y> <z>.") } }).result;
    expect(pod.contentType(`${ROOT}${path(BINARY.id)}content`)).toBe("application/octet-stream");
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
    expect(pod.bytes(`${ROOT}${path(BINARY.id)}content`)).toHaveLength(4);
    const empty = setup(0);
    await empty.run(full([{ ...BINARY, size: "0" }]), {
      media: { [mediaUrl(BINARY.id)]: bytes("") },
    }).result;
    expect(empty.pod.bytes(`${ROOT}${path(BINARY.id)}content`)).toHaveLength(0);
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
    expect(pod.bytes(`${ROOT}${path(BINARY.id)}content`)).toBeUndefined();
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
    expect([...metadata(DOC.id).encodings]).toEqual([`${ROOT}${path(DOC.id)}content.pdf`]);
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.txt`)).toBeUndefined();
  });

  it("removes old copies when ownership, eligibility, or file kind changes", async () => {
    const { run, pod, metadata } = await imported();
    await run(
      full([
        { ...BINARY, ownedByMe: false },
        { ...DOC, mimeType: `${GOOGLE_APPS}folder` },
      ]),
    ).result;
    expect(pod.bytes(`${ROOT}${path(BINARY.id)}content`)).toBeUndefined();
    expect(metadata(BINARY.id).contentSkipped).toBe("not-owned");
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.pdf`)).toBeUndefined();
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.txt`)).toBeUndefined();
    expect([...metadata(DOC.id).types]).toEqual(["https://schema.org/Collection"]);
  });

  it("switches representations and removes obsolete content files", async () => {
    const { run, pod } = await imported();
    await run(full([{ ...DOC, mimeType: "text/plain", size: "4", md5Checksum: "changed" }]), {
      media: { [mediaUrl(DOC.id)]: bytes() },
    }).result;
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content`)).toHaveLength(4);
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.pdf`)).toBeUndefined();
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.txt`)).toBeUndefined();
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
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.pdf`)).toBeUndefined();
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.txt`)).toBeUndefined();
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
      for (const name of ["content", "content.pdf", "content.txt"])
        expect(pod.bytes(`${ROOT}${path(id)}${name}`)).toBeUndefined();
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
        changes({ newStartPageToken: "3" }),
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
    null,
    {},
    { newStartPageToken: 7 },
  ])("refuses a missing changes checkpoint: %j", async (json) => {
    const { run } = setup();
    await expect(run([changes(json)], { cursor: "1" }).result).rejects.toThrow(
      "new start page token",
    );
  });
  it("rejects repeated list and changes page tokens", async () => {
    const { run } = setup();
    await expect(
      run([
        full()[0] as FixtureRoute,
        { url: `${DRIVE_API}/files`, json: { nextPageToken: "same" } },
      ]).result,
    ).rejects.toThrow("repeated a page token");
    await expect(
      run([changes({ nextPageToken: "same" })], { cursor: "same" }).result,
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
    expect(pod.bytes(`${ROOT}${path(DOC.id)}content.pdf`)).toBeUndefined();
    expect(pod.get(metaUrl("folder-1"))).toBeDefined();
  });

  it("keeps existing files when a full snapshot contains malformed items", async () => {
    const { run, pod } = await imported();
    const report = await run(full([null])).result;
    expect(report.skipped).toBe(1);
    expect(pod.get(metaUrl(BINARY.id))).toBeDefined();
    await run(full("invalid")).result;
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
