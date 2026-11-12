// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { strToU8, zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { type FileImportAdapter, type ImportFile, runFileImport } from "../core/file-import.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fileImport,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import { fileAdapterById } from "../file-adapters.js";
import { SPOTIFY_FILE_LIMITS, spotifyFileAdapter } from "./file-adapter.js";
import { BASIC_HISTORY, EXTENDED_HISTORY } from "./file-fixtures.js";
import { CORE, MEDIA, TIME } from "./vocab.js";

const ROOT = `${TEST_POD_ROOT}integrations/spotify/`;
const DOC = `${ROOT}music/history/2026-10.ttl`;
const json = (rows: unknown) => memoryFile("StreamingHistory_music_0.json", JSON.stringify(rows));
function archive(entries: Record<string, string>, level: 0 | 6 = 6): ImportFile {
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])),
    { level },
  );
  return blobFile(bytes);
}
function blobFile(bytes: Uint8Array): ImportFile {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  return {
    name: "spotify.zip",
    size: bytes.length,
    type: "application/zip",
    text: vi.fn(async () => {
      throw new Error("whole archive text forbidden");
    }),
    stream: () => blob.stream(),
    slice: (start, end) => blob.slice(start, end),
  };
}
function writer(pod = createMemoryPod()) {
  return createFetchPodWriter({
    adapterId: "spotify",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
}
const plays = (pod: ReturnType<typeof createMemoryPod>, url = DOC) =>
  pod
    .dataset(url)
    .getSubjects(
      DataFactory.namedNode(`${NS.RDF}type`),
      DataFactory.namedNode(`${MEDIA}PlaybackEvent`),
      null,
    );

describe("Spotify history export", () => {
  it("registers the hybrid under the existing Spotify id", () => {
    expect(fileAdapterById("spotify")).toBe(spotifyFileAdapter);
  });
  it("maps extended audio and episode/video plays into monthly scrobble graphs and drops PII", async () => {
    const { pod, report } = await fileImport(spotifyFileAdapter, json(EXTENDED_HISTORY));
    expect(report.written.map((entry) => entry.url)).toEqual([
      DOC,
      `${ROOT}music/history/2026-11.ttl`,
    ]);
    expect(plays(pod)).toHaveLength(1);
    const dataset = pod.dataset(DOC);
    const subject = plays(pod)[0];
    if (!subject) throw new Error("Missing playback");
    // solid-listening's scrobble shape, stored under the canonical suite namespaces.
    const one = (s: string, p: string) => {
      const objects = dataset.getObjects(DataFactory.namedNode(s), DataFactory.namedNode(p), null);
      expect(objects).toHaveLength(1);
      return objects[0]?.value;
    };
    const root = subject.value;
    expect(root).toMatch(new RegExp(`^${DOC}#scrobble-[0-9a-f]{64}$`));
    expect(one(root, `${MEDIA}playedWork`)).toBe(`${root}-track`);
    expect(one(root, `${CORE}atTime`)).toBe(`${root}-instant`);
    expect(one(root, `${MEDIA}msPlayed`)).toBe("120000");
    expect(one(`${root}-track`, `${NS.RDF}type`)).toBe(`${MEDIA}Track`);
    expect(one(`${root}-track`, `${NS.DCT}title`)).toBe("Synthetic Song");
    expect(one(`${root}-track`, `${MEDIA}performedByArtist`)).toBe(`${root}-artist`);
    expect(one(`${root}-track`, `${MEDIA}inAlbum`)).toBe(`${root}-album`);
    expect(one(`${root}-artist`, `${NS.FOAF}name`)).toBe("Fixture Artist");
    expect(one(`${root}-album`, `${NS.DCT}title`)).toBe("Fixture Album");
    expect(one(`${root}-instant`, `${NS.RDF}type`)).toBe(`${TIME}Instant`);
    expect(pod.get(DOC)).not.toContain("w3id.org");
    expect(pod.get(DOC)).toContain("Synthetic Song");
    expect(pod.get(DOC)).toContain("Fixture Artist");
    expect(pod.get(DOC)).toContain("Fixture Album");
    expect(
      dataset.getObjects(null, DataFactory.namedNode(`${TIME}inXSDDateTime`), null)[0]?.value,
    ).toBe("2026-10-01T12:00:00.000Z");
    expect(pod.get(report.indexUrl)).toContain(`${MEDIA}PlaybackEvent`);
    for (const url of pod.urls())
      for (const privateValue of [
        "ip_addr",
        "conn_country",
        "platform",
        "192.0.2.42",
        "SYNTHETIC-DEVICE-PRIVATE",
        '"ZZ"',
      ])
        expect(pod.get(url)).not.toContain(privateValue);
    expect(pod.get(`${ROOT}music/history/2026-11.ttl`)).toContain("Fixture Episode");
    expect(pod.get(`${ROOT}music/history/2026-11.ttl`)).toContain("Fixture Show");
  });
  it("accepts basic history, interprets endTime as UTC and keeps plays below 30 seconds", async () => {
    const { pod, report } = await fileImport(spotifyFileAdapter, json(BASIC_HISTORY));
    expect(plays(pod)).toHaveLength(1);
    expect(report.skipped).toBeUndefined();
    expect(pod.get(DOC)).toContain("2026-10-02T12:00:00.000Z");
    expect(pod.get(DOC)).toContain("500");
  });

  it.each([
    0, 1, 29_999, 30_000,
  ])("keeps a %i ms play regardless of source skip flags", async (ms) => {
    const { pod, report } = await fileImport(
      spotifyFileAdapter,
      json([{ ...EXTENDED_HISTORY[0], ms_played: ms, skipped: true }]),
    );
    expect(plays(pod)).toHaveLength(1);
    expect(report.skipped).toBeUndefined();
  });

  it("drops hostile URI values rather than storing or following them", async () => {
    const { pod } = await fileImport(
      spotifyFileAdapter,
      json([{ ...EXTENDED_HISTORY[0], spotify_track_uri: "https://private.example/DO-NOT-STORE" }]),
    );
    expect(plays(pod)).toHaveLength(1);
    expect(pod.get(DOC)).not.toContain("private.example");
  });
  it.each([
    0, 6,
  ] as const)("imports a synthetic ZIP (compression %i), merging overlapping files idempotently", async (level) => {
    const file = archive(
      {
        "Spotify Extended Streaming History/Streaming_History_Audio_2026_0.json": JSON.stringify([
          EXTENDED_HISTORY[0],
        ]),
        "Spotify Extended Streaming History/Streaming_History_Video_2026_0.json": JSON.stringify([
          EXTENDED_HISTORY[1],
        ]),
        "StreamingHistory_music_0.json": JSON.stringify(BASIC_HISTORY),
        "unrelated.json": JSON.stringify([{ ip_addr: "DO-NOT-IMPORT" }]),
      },
      level,
    );
    const { pod } = await fileImport(spotifyFileAdapter, file);
    const before = plays(pod)
      .map((term) => term.value)
      .sort();
    await fileImport(spotifyFileAdapter, file, { pod });
    expect(
      plays(pod)
        .map((term) => term.value)
        .sort(),
    ).toEqual(before);
    expect(plays(pod)).toHaveLength(2);
    expect(file.text).not.toHaveBeenCalled();
    // Smaller subsequent exports must never remove existing history.
    await fileImport(spotifyFileAdapter, json(BASIC_HISTORY), { pod });
    expect(plays(pod)).toHaveLength(2);
  });
  it("ids depend only on timestamp and URI or names, ignoring playback flags and file order", async () => {
    const { pod } = await fileImport(spotifyFileAdapter, json(EXTENDED_HISTORY));
    await fileImport(
      spotifyFileAdapter,
      json([
        { ...EXTENDED_HISTORY[0], reason_end: "changed", platform: "different", ms_played: 42 },
      ]),
      { pod },
    );
    expect(plays(pod)).toHaveLength(1);
    expect(
      pod
        .dataset(DOC)
        .getObjects(null, DataFactory.namedNode(`${MEDIA}msPlayed`), null)
        .map((n) => n.value),
    ).toEqual(["42"]);
    const { pod: names } = await fileImport(
      spotifyFileAdapter,
      json([...BASIC_HISTORY, ...BASIC_HISTORY]),
    );
    expect(plays(names)).toHaveLength(1);
  });
  it("writes one play for rows sharing an id within an import, keeping the last row", async () => {
    const { pod } = await fileImport(
      spotifyFileAdapter,
      json([BASIC_HISTORY[0], { ...BASIC_HISTORY[0], msPlayed: 7 }]),
    );
    expect(plays(pod)).toHaveLength(1);
    expect(
      pod
        .dataset(DOC)
        .getObjects(null, DataFactory.namedNode(`${MEDIA}msPlayed`), null)
        .map((n) => n.value),
    ).toEqual(["7"]);
  });
  it("skips malformed dates, names and durations, retaining valid rows", async () => {
    const good = BASIC_HISTORY[0];
    const bad = [
      null,
      [],
      {},
      { ...good, msPlayed: -1 },
      { ...good, msPlayed: 1.1 },
      { ...good, msPlayed: "100" },
      { ...good, trackName: "" },
      { ...good, trackName: "x".repeat(4097) },
      { ...good, endTime: "2026-02-30 12:00" },
      { ...good, endTime: "2026-10-01T25:00:00Z" },
    ];
    const { pod, report } = await fileImport(spotifyFileAdapter, json([...bad, good]));
    expect(report.skipped).toBe(bad.length);
    expect(plays(pod)).toHaveLength(1);
  });
  it.each([
    "[",
    "{}",
    "[] trailing",
    '[{"ts":',
  ])("rejects invalid or empty exports %s", async (text) => {
    await expect(
      fileImport(spotifyFileAdapter, memoryFile("history.json", text)),
    ).rejects.toThrow();
  });
  it("bounds rows across archive entries, counting invalid records, before any history writes", async () => {
    const limited: FileImportAdapter = {
      ...spotifyFileAdapter,
      importFile: (file, ctx) => spotifyFileAdapter.importFile(file, { ...ctx, maxRows: 2 }),
    };
    const pod = createMemoryPod();
    await expect(
      fileImport(
        limited,
        archive({
          "StreamingHistory_music_0.json": JSON.stringify([BASIC_HISTORY[0], null]),
          "StreamingHistory_music_1.json": JSON.stringify(BASIC_HISTORY),
        }),
        { pod },
      ),
    ).rejects.toThrow("record limit");
    expect(pod.get(DOC)).toBeUndefined();
  });
  it("refuses archive size lies, excessive entries, deep JSON, traversal and missing range ports", async () => {
    await expect(
      fileImport(spotifyFileAdapter, { ...json([]), size: SPOTIFY_FILE_LIMITS.archiveBytes + 1 }),
    ).rejects.toThrow("512 MiB");
    await expect(
      fileImport(
        spotifyFileAdapter,
        memoryFile("history.json", `${"[".repeat(66)}0${"]".repeat(66)}`),
      ),
    ).rejects.toThrow("deeply");
    await expect(
      fileImport(
        spotifyFileAdapter,
        archive({ "../StreamingHistory_music_0.json": JSON.stringify(BASIC_HISTORY) }),
      ),
    ).rejects.toThrow("No importable");
    const excessive = Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => [`unused${i}`, ""]),
    );
    await expect(fileImport(spotifyFileAdapter, archive(excessive))).rejects.toThrow();
    const { slice: _slice, ...noRange } = archive({ "StreamingHistory_music_0.json": "[]" });
    await expect(fileImport(spotifyFileAdapter, noRange)).rejects.toThrow("slice");
  });
  it("fails closed on a corrupt entry after a valid entry, before writing either month", async () => {
    const bytes = zipSync(
      {
        "StreamingHistory_music_0.json": strToU8(JSON.stringify(BASIC_HISTORY)),
        "StreamingHistory_music_1.json": strToU8(JSON.stringify(EXTENDED_HISTORY)),
      },
      { level: 0 },
    );
    const at = new TextDecoder().decode(bytes).indexOf("Synthetic Song");
    bytes[at] = 88;
    const pod = createMemoryPod();
    await expect(fileImport(spotifyFileAdapter, blobFile(bytes), { pod })).rejects.toThrow("crc");
    expect(pod.get(DOC)).toBeUndefined();
  });
  it("honours cancellation while parsing, before writing and between months", async () => {
    const controller = new AbortController();
    const podWriter = writer();
    const write = vi.spyOn(podWriter, "write");
    await expect(
      runFileImport({
        adapter: spotifyFileAdapter,
        file: json(EXTENDED_HISTORY),
        podWriter,
        signal: controller.signal,
        onProgress: (value) => {
          if (value.label.startsWith("Saving")) controller.abort(new Error("stop"));
        },
      }),
    ).rejects.toThrow("stop");
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["textBytes", "metadata limit"],
    ["months", "month limit"],
    ["inflatedBytes", "total-inflated-cap"],
  ] as const)("enforces the shared %s budget before history writes", async (key, message) => {
    const previous = SPOTIFY_FILE_LIMITS[key];
    const pod = createMemoryPod();
    // Lower the production ceiling so the boundary can be tested without giant fixtures.
    Object.assign(SPOTIFY_FILE_LIMITS, { [key]: 1 });
    try {
      await expect(
        fileImport(
          spotifyFileAdapter,
          archive({
            "StreamingHistory_music_0.json": JSON.stringify(EXTENDED_HISTORY),
          }),
          { pod },
        ),
      ).rejects.toThrow(message);
      expect(pod.get(DOC)).toBeUndefined();
    } finally {
      Object.assign(SPOTIFY_FILE_LIMITS, { [key]: previous });
    }
  });

  it("counts an oversized JSON token as a skipped row and keeps following records", async () => {
    const { pod, report } = await fileImport(
      spotifyFileAdapter,
      json([{ ignored: "x".repeat(1024 * 1024 + 1) }, BASIC_HISTORY[0]]),
    );
    expect(report.skipped).toBe(1);
    expect(plays(pod)).toHaveLength(1);
  });

  it("aborts a pending streamed read and cancels its source", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const file = {
      ...json([]),
      stream: () =>
        new ReadableStream<Uint8Array>({
          start() {
            queueMicrotask(() => controller.abort(new Error("stream cancelled")));
          },
          cancel,
        }),
    };
    await expect(
      runFileImport({
        adapter: spotifyFileAdapter,
        file,
        podWriter: writer(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("stream cancelled");
    expect(cancel).toHaveBeenCalled();
  });
});
