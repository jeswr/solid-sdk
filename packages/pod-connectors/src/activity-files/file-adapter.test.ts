// AUTHORED-BY Codex GPT-6.1-Sol
import { zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  END,
  FIT_START,
  FitEncoder,
  GARMIN_GPX,
  GARMIN_TCX,
  START,
  STRAVA_GPX,
  syntheticFit,
  U8,
  U32,
} from "../../test/activity-fixtures.js";
import { type ImportFile, runFileImport } from "../core/file-import.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { Provenance } from "../core/provenance.js";
import {
  createMemoryPod,
  fileImport,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import { CLASSES, SCHEMA } from "../core/vocab.js";
import { fileAdapterById } from "../file-adapters.js";
import { allCatalogEntries, statusOf } from "../registry.js";
import { activityFilesAdapter, createActivityFilesAdapter } from "./file-adapter.js";
import { digest, formatDuration, originIri } from "./mapping.js";
import { ACTIVITY_LIMITS } from "./model.js";
import { ActivityResource } from "./vocab.js";

const encoder = new TextEncoder();
function file(bytes: Uint8Array, name = "export.bin", piece = 65536): ImportFile {
  const stream = (data: Uint8Array) => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        if (offset >= data.length) c.close();
        else {
          c.enqueue(data.subarray(offset, offset + piece));
          offset += piece;
        }
      },
    });
  };
  return {
    name,
    type: "",
    size: bytes.length,
    text: async () => {
      throw new Error("Do not decode binary through text().");
    },
    stream: () => stream(bytes),
    slice: (start, end) => ({ stream: () => stream(bytes.subarray(start, end)) }),
  };
}
const docs = (pod: ReturnType<typeof createMemoryPod>) =>
  pod.urls().filter((u) => /\/activities\/[a-f0-9]{64}\.ttl$/.test(u));
function values(pod: ReturnType<typeof createMemoryPod>, predicate: string) {
  return [...pod.dataset(docs(pod)[0] as string)]
    .filter((q) => q.predicate.value === `${SCHEMA}${predicate}`)
    .map((q) => q.object.value);
}
function action(pod: ReturnType<typeof createMemoryPod>) {
  const url = docs(pod)[0] as string;
  return new ActivityResource(`${url}#activity`, pod.dataset(url), DataFactory);
}

describe("activity-files file contract", () => {
  it("registers one Tier C adapter and advertises all formats", () => {
    expect(fileAdapterById("activity-files")).toBe(activityFilesAdapter);
    expect(statusOf(allCatalogEntries().find((e) => e.id === "activity-files") as never)).toBe(
      "export-file",
    );
    for (const ext of [".gpx", ".tcx", ".fit", ".zip"])
      expect(activityFilesAdapter.accept).toContain(ext);
  });
  it.each([
    ["Strava", STRAVA_GPX],
    ["Garmin", GARMIN_GPX],
    ["TCX", GARMIN_TCX],
  ])("imports synthetic %s export, using content rather than extension", async (_name, xml) => {
    const { pod, report } = await fileImport(
      activityFilesAdapter,
      file(encoder.encode(xml), "misleading.fit", 1),
    );
    expect(report.warnings).toEqual([]);
    expect(docs(pod)).toHaveLength(1);
    expect(action(pod).types.has(CLASSES.ExerciseAction)).toBe(true);
    expect(action(pod).startTime?.getTime()).toBe(Date.parse(START));
    expect(action(pod).end?.getTime()).toBe(Date.parse(END));
    expect(action(pod).duration).toBe("PT60S");
    expect(action(pod).exerciseType).toBe("running");
    expect(values(pod, "line")[0]).toBe("51.5 -0.12 51.501 -0.12");
    const [original] = [...action(pod).originals];
    expect(pod.bytes(original as string)).toEqual(encoder.encode(xml));
    const prov = new Provenance(
      `${docs(pod)[0]}#activity`,
      pod.dataset(docs(pod)[0] as string),
      DataFactory,
    );
    const hash = await digest(encoder.encode(xml));
    expect([...prov.derivedFrom]).toEqual([await originIri("misleading.fit", hash)]);
    expect([...prov.derivedFrom][0]).toMatch(/^urn:sha256:[a-f0-9]{64}$/);
    expect(values(pod, "name")).toContain("misleading.fit");
    expect(prov.generatedBy.size).toBe(1);
    expect(pod.get(report.indexUrl)).toContain(CLASSES.ExerciseAction);
  });
  it("maps GPX Garmin extensions into metrics and compact samples", async () => {
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("garmin.gpx", GARMIN_GPX));
    const samples = JSON.parse(values(pod, "text")[0] as string);
    expect(samples[0].slice(3, 7)).toEqual([10, 150, 90, 18]);
    expect(values(pod, "name")).toContain("Average heart rate");
    expect(values(pod, "value")).toEqual(expect.arrayContaining(["5", "150"]));
  });
  it("sums TCX laps, uses weighted HR and retains creator", async () => {
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("garmin", GARMIN_TCX));
    expect(action(pod).distance).toBe("111 m");
    expect(action(pod).calories).toBe("11 kcal");
    expect(values(pod, "value")).toEqual(expect.arrayContaining(["150", "180"]));
    expect(values(pod, "creator")).toEqual(["Synthetic Garmin / 42"]);
    expect(JSON.parse(values(pod, "text")[0] as string)[0].slice(4, 10)).toEqual([
      140,
      85,
      null,
      0,
      3.2,
      200,
    ]);
  });
  it("imports FIT data with compressed timestamps, developer data and enhanced fields", async () => {
    const bytes = syntheticFit();
    const { pod } = await fileImport(activityFilesAdapter, file(bytes, "wrong.gpx", 3));
    const samples = JSON.parse(values(pod, "text")[0] as string);
    expect(samples).toHaveLength(3);
    expect(samples[0][0]).toBeCloseTo(51.5, 5);
    expect(samples[0][1]).toBeCloseTo(-0.12, 5);
    expect(samples[0].slice(3, 10)).toEqual([12, 140, 85, -2, 0, 3.2, 200]);
    expect(samples[1][2]).toBe(Date.parse(START) + 5000);
    expect(action(pod).duration).toBe("PT60S");
    expect(action(pod).calories).toBe("11 kcal");
    expect(values(pod, "creator")).toEqual(["1:100 / 42"]);
  });
  it("reimports idempotently without duplicate activity documents, tracks or binary files", async () => {
    const input = file(syntheticFit());
    const { pod } = await fileImport(activityFilesAdapter, input);
    const before = pod.urls();
    const id = docs(pod)[0];
    await fileImport(activityFilesAdapter, input, { pod });
    expect(pod.urls()).toEqual(before);
    expect(docs(pod)).toEqual([id]);
    expect(action(pod).originals.size).toBe(1);
  });
  it("deduplicates GPX/TCX/FIT across independent runs and preserves originals and metrics", async () => {
    const { pod } = await fileImport(activityFilesAdapter, file(syntheticFit()));
    await fileImport(activityFilesAdapter, memoryFile("run.tcx", GARMIN_TCX), { pod });
    await fileImport(activityFilesAdapter, memoryFile("run.gpx", STRAVA_GPX), { pod });
    expect(docs(pod)).toHaveLength(1);
    expect(action(pod).originals.size).toBe(3);
    expect(action(pod).calories).toBe("11 kcal");
  });
  it.each([
    [-2, -2, 1],
    [2, 2, 1],
    [2.001, 0, 2],
    [0, 2.001, 2],
  ])("dedup tolerates start %s s, duration %s s (%s docs)", async (startDelta, durationDelta, count) => {
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("a.gpx", STRAVA_GPX));
    const shift = (iso: string, seconds: number) =>
      new Date(Date.parse(iso) + seconds * 1000).toISOString();
    // TCX elapsed duration is the trackpoint span, not the laps' timer time.
    const other = GARMIN_TCX.replaceAll(START, shift(START, startDelta)).replaceAll(
      END,
      shift(END, startDelta + durationDelta),
    );
    await fileImport(activityFilesAdapter, memoryFile("b.tcx", other), { pod });
    expect(docs(pod)).toHaveLength(count);
  });
  it("keeps distinct sports and maps rides to Mobility", async () => {
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("a.gpx", STRAVA_GPX));
    const { report } = await fileImport(
      activityFilesAdapter,
      memoryFile("b.gpx", STRAVA_GPX.replace("running", "cycling")),
      { pod },
    );
    expect(docs(pod)).toHaveLength(2);
    expect(report.categories).toEqual(["mobility"]);
  });
  it("imports a mixed ZIP by content, skips corrupt/hostile entries, and does not fetch export links", async () => {
    const bytes = zipSync({
      "run.gpx": encoder.encode(STRAVA_GPX),
      "garmin.tcx": encoder.encode(GARMIN_TCX),
      "watch.fit": syntheticFit(),
      "actual-gpx.dat": encoder.encode(GARMIN_GPX),
      "bad.gpx": encoder.encode("<gpx>"),
      "notes.txt": encoder.encode("https://example.test/export"),
      "../escape.gpx": encoder.encode(STRAVA_GPX),
    });
    const { pod, report } = await fileImport(activityFilesAdapter, file(bytes, "anything.bin", 7));
    expect(docs(pod)).toHaveLength(1);
    expect(action(pod).originals.size).toBe(4);
    expect(report.skipped).toBe(3);
    expect(report.warnings).toEqual(
      expect.arrayContaining(["invalid-activity-file", "unsafe-archive-path"]),
    );
    expect(pod.urls().every((u) => u.startsWith(TEST_POD_ROOT))).toBe(true);
  });
  it("supports GPX 1.0, prefixed roots and multiple segments without joining segment gaps", async () => {
    const xml = STRAVA_GPX.replace('version="1.1"', 'version="1.0"')
      .replace("<gpx ", "<g:gpx ")
      .replace("</gpx>", "</g:gpx>")
      .replace("<trk>", "<trk>")
      .replace(
        "</trkseg>",
        '</trkseg><trkseg><trkpt lat="0" lon="0"><time>2026-06-01T06:32:00Z</time></trkpt></trkseg>',
      );
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("run", xml));
    expect(Number.parseFloat(action(pod).distance as string)).toBeLessThan(120);
  });
  it("downsamples to at most 2,000 points and keeps endpoints", async () => {
    const points = Array.from(
      { length: 6001 },
      (_, i) =>
        `<trkpt lat="${i / 10000}" lon="0"><time>${new Date(Date.parse(START) + i * 1000).toISOString()}</time></trkpt>`,
    ).join("");
    const { pod } = await fileImport(
      activityFilesAdapter,
      memoryFile("run.gpx", `<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`),
    );
    const samples = JSON.parse(values(pod, "text")[0] as string);
    expect(samples.length).toBeLessThanOrEqual(ACTIVITY_LIMITS.trackPoints);
    expect(samples[0][0]).toBe(0);
    expect(samples.at(-1)[0]).toBe(0.6);
  });
  it.each([
    "<gpx><trk></gpx>",
    `<gpx>${"<x>".repeat(65)}`,
    '<!DOCTYPE gpx [<!ENTITY xx SYSTEM "https://example.test/">]><gpx/>',
    "<other><gpx><trk/></gpx></other>",
    `${STRAVA_GPX}<junk/>`,
    STRAVA_GPX.replace('lat="51.5"', 'lat="51.5" bogus'),
    `<gpx><trk><name>${"x".repeat(65537)}</name></trk></gpx>`,
  ])("rejects hostile XML without writing activities (case %#)", async (xml) => {
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile("attack.gpx", xml));
    expect(docs(pod)).toEqual([]);
    expect(report.warnings).toContain("invalid-activity-file");
  });
  it.each([
    "crc",
    "truncated",
    "size",
  ])("rejects FIT %s before writing activities", async (kind) => {
    let bytes = syntheticFit().slice();
    if (kind === "crc") bytes[bytes.length - 1] ^= 1;
    if (kind === "truncated") bytes = bytes.subarray(0, -10);
    if (kind === "size") new DataView(bytes.buffer).setUint32(4, 0xffffffff, true);
    const { pod, report } = await fileImport(activityFilesAdapter, file(bytes));
    expect(docs(pod)).toEqual([]);
    expect(report.warnings).toContain("invalid-activity-file");
  });
  it.each([
    { records: 1 },
    { points: 1 },
    { messages: 30 },
  ])("reports truncation with lowered policy %j", async (limits) => {
    const { report } = await fileImport(
      createActivityFilesAdapter(limits),
      memoryFile("run", GARMIN_GPX),
    );
    expect(report.warnings?.some((w) => w.endsWith("cap-exceeded"))).toBe(true);
  });
  it("bounds actual bytes even if size lies, cancelling its reader", async () => {
    const input = file(encoder.encode(STRAVA_GPX), "run");
    const { report, pod } = await fileImport(createActivityFilesAdapter({ fileBytes: 32 }), {
      ...input,
      size: 1,
    });
    expect(docs(pod)).toEqual([]);
    expect(report.warnings).toEqual(["file-byte-cap-exceeded"]);
  });
  it("caps archive entries and reports oversized entries", async () => {
    const bytes = zipSync({ "run.gpx": encoder.encode(STRAVA_GPX) });
    const { report } = await fileImport(createActivityFilesAdapter({ fileBytes: 32 }), file(bytes));
    expect(report.warnings).toContain("file-byte-cap-exceeded");
  });
  it("reports missing timestamps without inventing activity identities", async () => {
    const { pod, report } = await fileImport(
      activityFilesAdapter,
      memoryFile("run", STRAVA_GPX.replace(/<time>[^<]+<\/time>/g, "")),
    );
    expect(docs(pod)).toEqual([]);
    expect(report.warnings).toContain("activity-missing-start");
  });
  it.each([0, -1, Infinity, NaN, 2001])("refuses an invalid track-point cap %s", (limit) => {
    expect(() => createActivityFilesAdapter({ trackPoints: limit })).toThrow(
      "Invalid activity limit",
    );
  });
  it("rejects cancellation before any Pod writes", async () => {
    const pod = createMemoryPod();
    const signal = AbortSignal.abort(new Error("cancelled"));
    await expect(
      runFileImport({
        adapter: activityFilesAdapter,
        file: memoryFile("run", STRAVA_GPX),
        signal,
        podWriter: createFetchPodWriter({
          adapterId: "activity-files",
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch: pod.fetch,
        }),
      }),
    ).rejects.toThrow("cancelled");
    expect(pod.putCount).toBe(0);
  });
  it("stops at a cancellation that lands during a deduplication read", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const writer = createFetchPodWriter({
      adapterId: "activity-files",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    const read = writer.read;
    writer.read = vi.fn(async (slug) => {
      const value = await read(slug);
      controller.abort(new Error("cancelled"));
      return value;
    });
    await expect(
      runFileImport({
        adapter: activityFilesAdapter,
        file: memoryFile("run", STRAVA_GPX),
        signal: controller.signal,
        podWriter: writer,
      }),
    ).rejects.toThrow("cancelled");
    // The original is stored lazily, after the reads, so nothing was written.
    expect(pod.putCount).toBe(0);
  });
});

it("cancels a pending input stream promptly and releases it", async () => {
  const pod = createMemoryPod();
  const controller = new AbortController();
  const cancel = vi.fn();
  const input: ImportFile = {
    name: "pending.fit",
    type: "",
    size: 1,
    text: async () => "",
    stream: () =>
      new ReadableStream({
        start() {
          queueMicrotask(() => controller.abort(new Error("cancelled")));
        },
        cancel,
      }),
  };
  await expect(
    runFileImport({
      adapter: activityFilesAdapter,
      file: input,
      signal: controller.signal,
      podWriter: createFetchPodWriter({
        adapterId: "activity-files",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: pod.fetch,
      }),
    }),
  ).rejects.toThrow("cancelled");
  expect(cancel).toHaveBeenCalledOnce();
  expect(pod.putCount).toBe(0);
});

it("retains the first deduplication anchor instead of chaining two-second drifts", async () => {
  const { pod } = await fileImport(activityFilesAdapter, memoryFile("a.gpx", STRAVA_GPX));
  for (const offset of [2, 4]) {
    const xml = GARMIN_TCX.replaceAll(
      START,
      new Date(Date.parse(START) + offset * 1000).toISOString(),
    );
    await fileImport(activityFilesAdapter, memoryFile(`${offset}.tcx`, xml), { pod });
  }
  expect(docs(pod)).toHaveLength(2);
});

it("bounds the compressed archive size before reading its directory", async () => {
  const input = file(zipSync({ "run.gpx": encoder.encode(STRAVA_GPX) }));
  const { report, pod } = await fileImport(createActivityFilesAdapter({ totalBytes: 64 }), input);
  expect(report.warnings).toEqual(["archive-byte-cap-exceeded"]);
  expect(docs(pod)).toEqual([]);
});

it("keeps a previously complete activity when a later policy truncates its records", async () => {
  const input = memoryFile("run.gpx", GARMIN_GPX);
  const { pod } = await fileImport(activityFilesAdapter, input);
  const before = values(pod, "text");
  const { report } = await fileImport(createActivityFilesAdapter({ records: 1 }), input, { pod });
  expect(values(pod, "text")).toEqual(before);
  expect(report.warnings).toContain("retained-previous-activity");
});

it("keeps previous successful connector state on a Pod write failure", async () => {
  const pod = createMemoryPod();
  const previous = {
    connectedAt: START,
    lastSync: START,
    lastOutcome: "success" as const,
    cursor: "previous",
    counts: { documents: 1, items: 1, skipped: 0 },
  };
  const onState = vi.fn();
  const writer = createFetchPodWriter({
    adapterId: "activity-files",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  writer.write = vi.fn().mockRejectedValue(new Error("storage failed"));
  await expect(
    runFileImport({
      adapter: activityFilesAdapter,
      file: memoryFile("run", STRAVA_GPX),
      podWriter: writer,
      state: previous,
      onState,
    }),
  ).rejects.toThrow("storage failed");
  expect(onState).toHaveBeenCalledWith({ ...previous, lastOutcome: "error" });
});

it("bounds the original-file history across many independent service exports", async () => {
  const { pod } = await fileImport(activityFilesAdapter, memoryFile("first", STRAVA_GPX));
  for (let i = 1; i < 32; i++)
    await fileImport(
      activityFilesAdapter,
      memoryFile(`export-${i}.gpx`, STRAVA_GPX.replace("StravaGPX", `Synthetic-${i}`)),
      { pod },
    );
  const { report } = await fileImport(
    activityFilesAdapter,
    memoryFile("overflow.gpx", GARMIN_GPX),
    { pod },
  );
  expect(action(pod).originals.size).toBe(32);
  expect(report.warnings).toContain("activity-source-cap-exceeded");
  expect(docs(pod)).toHaveLength(1);
}, 30000);

it("caps deduplication buckets without dropping the activities themselves", async () => {
  const tracks = Array.from(
    { length: 33 },
    (_, i) =>
      `<trk><type>sport-${i}</type><trkseg><trkpt lat="0" lon="0"><time>${START}</time></trkpt><trkpt lat="0" lon="0"><time>${END}</time></trkpt></trkseg></trk>`,
  ).join("");
  const { pod, report } = await fileImport(
    activityFilesAdapter,
    memoryFile("many.gpx", `<gpx>${tracks}</gpx>`),
  );
  expect(docs(pod)).toHaveLength(33);
  expect(report.warnings).toContain("deduplication-bucket-cap-exceeded");
});

it("does not lose explicit zero values in TCX lap summaries", async () => {
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Other"><Id>${START}</Id><Lap><TotalTimeSeconds>0</TotalTimeSeconds><DistanceMeters>0</DistanceMeters><Calories>0</Calories></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const { pod } = await fileImport(activityFilesAdapter, memoryFile("zero", xml));
  // A sub-second elapsed duration is degenerate and is dropped with its end time.
  expect(action(pod).duration).toBeUndefined();
  expect(action(pod).end).toBeUndefined();
  expect(action(pod).distance).toBe("0 m");
  expect(action(pod).calories).toBe("0 kcal");
});

it("uses the file hash when a TCX creator has an empty device serial", async () => {
  const first = GARMIN_TCX.replace("<UnitId>42</UnitId>", "<UnitId></UnitId>");
  const { pod } = await fileImport(activityFilesAdapter, memoryFile("first.tcx", first));
  const second = first.replaceAll(END, "2026-06-01T06:32:00Z");
  await fileImport(activityFilesAdapter, memoryFile("second.tcx", second), { pod });
  expect(docs(pod)).toHaveLength(2);
});

// Regressions for the CON-A6 adversarial review findings.
function countBinaryPuts(pod: ReturnType<typeof createMemoryPod>, extension: string) {
  const counter = { puts: 0 };
  const inner = pod.fetch;
  pod.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT" && String(input).endsWith(extension)) counter.puts++;
    return inner(input, init);
  }) as typeof fetch;
  return counter;
}
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();
const gpxTrack = (from: number, to: number, type = "running") =>
  `<trk><type>${type}</type><trkseg><trkpt lat="0" lon="0"><time>${at(from)}</time></trkpt><trkpt lat="0.001" lon="0"><time>${at(to)}</time></trkpt></trkseg></trk>`;
const tcx = (activities: string) =>
  `<TrainingCenterDatabase><Activities>${activities}</Activities></TrainingCenterDatabase>`;

describe("original bytes are written once per file", () => {
  it("stores a five-track GPX original with one binary PUT", async () => {
    const pod = createMemoryPod();
    const counter = countBinaryPuts(pod, ".gpx");
    const tracks = [0, 1, 2, 3, 4].map((i) => gpxTrack(i * 3600, i * 3600 + 60)).join("");
    await fileImport(activityFilesAdapter, memoryFile("five.gpx", `<gpx>${tracks}</gpx>`), { pod });
    expect(docs(pod)).toHaveLength(5);
    expect(counter.puts).toBe(1);
    const originals = new Set(
      docs(pod).flatMap((doc) => [
        ...new ActivityResource(`${doc}#activity`, pod.dataset(doc), DataFactory).originals,
      ]),
    );
    expect(originals.size).toBe(1);
  });
  it("stores a multisport FIT original with one binary PUT", async () => {
    const bytes = new FitEncoder()
      .definition(0, 0, [U8(0), U32(3)])
      .data(0, { 0: 4, 3: 42 })
      .definition(1, 18, [U32(253), U32(2), U8(5), U32(7)])
      .data(1, { 253: FIT_START + 60, 2: FIT_START, 5: 1, 7: 60000 })
      .data(1, { 253: FIT_START + 180, 2: FIT_START + 120, 5: 2, 7: 60000 })
      .file();
    const pod = createMemoryPod();
    const counter = countBinaryPuts(pod, ".fit");
    await fileImport(activityFilesAdapter, file(bytes, "multisport.fit"), { pod });
    expect(docs(pod)).toHaveLength(2);
    expect(counter.puts).toBe(1);
  });
});

describe("originals are stored only when linked", () => {
  const stored = (pod: ReturnType<typeof createMemoryPod>) =>
    pod.urls().filter((u) => /\/activities\/[a-f0-9]{64}\.(tcx|gpx|fit)$/.test(u));
  it("stores at most 32 binaries for 40 distinct exports, every one linked", async () => {
    const pod = createMemoryPod();
    for (let i = 0; i < 40; i++)
      await fileImport(
        activityFilesAdapter,
        memoryFile(`run-${i}.tcx`, GARMIN_TCX.replace("<Activities>", `<!-- ${i} --><Activities>`)),
        { pod },
      );
    expect(docs(pod)).toHaveLength(1);
    expect(stored(pod)).toHaveLength(32);
    expect([...action(pod).originals].sort()).toEqual(stored(pod));
  }, 30000);
  it("stores no original for a truncated re-import over a complete activity", async () => {
    // The device serial keeps one identity across the two differing exports.
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("a.tcx", GARMIN_TCX));
    const before = stored(pod);
    const { report } = await fileImport(
      createActivityFilesAdapter({ records: 1 }),
      memoryFile("b.tcx", GARMIN_TCX.replace("<Activities>", "<!-- b --><Activities>")),
      { pod },
    );
    expect(report.warnings).toContain("retained-previous-activity");
    expect(stored(pod)).toEqual(before);
  });
  it("describes an over-cap original on its hash-only origin IRI", async () => {
    const big = STRAVA_GPX.replace("<trk>", `<!--${" ".repeat(26 * 1024 * 1024)}--><trk>`);
    const name = `${"n".repeat(300)}.gpx`;
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile(name, big));
    expect(report.warnings).toContain("original-binary-cap-exceeded");
    expect(stored(pod)).toEqual([]);
    expect(action(pod).originals.size).toBe(0);
    const hash = await digest(encoder.encode(big));
    const origin = await originIri(name, hash);
    const about = (predicate: string) =>
      [...pod.dataset(docs(pod)[0] as string)]
        .filter((q) => q.subject.value === origin && q.predicate.value === `${SCHEMA}${predicate}`)
        .map((q) => q.object.value);
    expect(about("name")).toEqual(["n".repeat(256)]);
    expect(about("identifier")).toEqual([hash]);
  }, 60000);
});

describe("bounded activity durations and times", () => {
  it("formats xsd:duration with at most three fixed decimals", () => {
    expect(formatDuration(60)).toBe("PT60S");
    expect(formatDuration(60.5)).toBe("PT60.5S");
    expect(formatDuration(1.23456)).toBe("PT1.235S");
    expect(formatDuration(604800)).toBe("PT604800S");
  });
  it("drops 1e12-second laps without aborting the run or other activities", async () => {
    const laps = Array.from(
      { length: 10 },
      () => `<Lap StartTime="${at(1800)}"><TotalTimeSeconds>1000000000000</TotalTimeSeconds></Lap>`,
    ).join("");
    const xml = tcx(
      `<Activity Sport="Running"><Id>${START}</Id><Lap StartTime="${START}"><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>` +
        `<Activity Sport="Running"><Id>${at(1800)}</Id>${laps}</Activity>`,
    );
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile("big.tcx", xml));
    expect(docs(pod)).toHaveLength(2);
    expect(report.warnings).toContain("activity-duration-dropped");
    const actions = docs(pod).map(
      (doc) => new ActivityResource(`${doc}#activity`, pod.dataset(doc), DataFactory),
    );
    expect(actions.map((a) => a.duration).sort()).toEqual(["PT60S", undefined]);
    const huge = actions.find((a) => a.duration === undefined);
    expect(huge?.end).toBeUndefined();
    expect(huge?.startTime?.toISOString()).toBe(new Date(at(1800)).toISOString());
  });
  it("drops a 1e-7-second duration rather than writing exponent notation", async () => {
    const xml = tcx(
      `<Activity Sport="Running"><Id>${START}</Id><Lap StartTime="${START}"><TotalTimeSeconds>0.0000001</TotalTimeSeconds></Lap></Activity>`,
    );
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("tiny.tcx", xml));
    expect(action(pod).duration).toBeUndefined();
    expect(action(pod).end).toBeUndefined();
    expect(pod.get(docs(pod)[0] as string)).not.toMatch(/PT[^S]*e/);
  });
  it("drops a negative span so the end is never before the start", async () => {
    const xml = tcx(
      `<Activity Sport="Running"><Id>${at(1800)}</Id><Lap StartTime="${at(1800)}"><Track><Trackpoint><Time>${START}</Time></Trackpoint></Track></Lap></Activity>`,
    );
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile("neg.tcx", xml));
    expect(action(pod).duration).toBeUndefined();
    expect(action(pod).end).toBeUndefined();
    expect(report.warnings).toContain("activity-duration-dropped");
  });
  it.each([
    "2200-01-01T00:00:00Z",
    "1969-12-31T23:59:59Z",
  ])("skips an activity at %s as invalid and keeps the others", async (time) => {
    const gpx = `<gpx>${gpxTrack(0, 60)}<trk><trkseg><trkpt lat="0" lon="0"><time>${time}</time></trkpt></trkseg></trk></gpx>`;
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile("far.gpx", gpx));
    expect(docs(pod)).toHaveLength(1);
    expect(report.skipped).toBe(1);
    expect(report.warnings).toContain("activity-time-out-of-range");
  });
  it("skips an activity whose end lies outside the supported range", async () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>${START}</time></trkpt><trkpt lat="0" lon="0"><time>9999-12-31T23:59:59Z</time></trkpt></trkseg></trk></gpx>`;
    const { pod, report } = await fileImport(activityFilesAdapter, memoryFile("end.gpx", gpx));
    expect(docs(pod)).toEqual([]);
    expect(report.warnings).toContain("activity-time-out-of-range");
    expect(pod.urls().some((u) => u.endsWith(".gpx"))).toBe(false);
  });
  it("records a skip when one activity's mapping fails and imports the rest", async () => {
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("a.gpx", STRAVA_GPX));
    const bucket = pod
      .urls()
      .find((u) => u.endsWith(`/indexes/${Math.floor(Date.parse(START) / 1000)}.ttl`));
    expect(bucket).toBeDefined();
    // A tampered dedup bucket over its 32-entry limit makes this activity's mapping throw.
    const poisoned = Array.from({ length: 33 }, (_, i) => `<#e${i}> <${SCHEMA}name> "x" .`).join(
      "\n",
    );
    await pod.fetch(bucket as string, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: poisoned,
    });
    const gpx = `<gpx>${gpxTrack(0, 60, "cycling")}${gpxTrack(7200, 7260)}</gpx>`;
    const { report } = await fileImport(activityFilesAdapter, memoryFile("b.gpx", gpx), { pod });
    expect(report.skipped).toBe(1);
    expect(report.warnings).toContain("activity-import-failed");
    expect(docs(pod)).toHaveLength(2);
  });
});

it("keeps activity documents bounded across 40 long-named archive entries", async () => {
  const xml = tcx(
    `<Activity Sport="Running"><Id>${START}</Id><Lap StartTime="${START}"><TotalTimeSeconds>60</TotalTimeSeconds><Track><Trackpoint><Time>${START}</Time><Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position></Trackpoint></Track></Lap><Creator><Name>X</Name><UnitId>42</UnitId></Creator></Activity>`,
  );
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < 40; i++) entries[`${i}-${"\u4e00".repeat(1020)}.tcx`] = encoder.encode(xml);
  const { pod, report } = await fileImport(activityFilesAdapter, file(zipSync(entries), "a.zip"));
  expect(docs(pod)).toHaveLength(1);
  expect(report.warnings).toContain("activity-source-cap-exceeded");
  const doc = docs(pod)[0] as string;
  // Before the fix each origin carried the ~9 KB percent-encoded name onto every subject.
  expect((pod.get(doc) as string).length).toBeLessThan(24_000);
  const origins = [...new Provenance(`${doc}#activity`, pod.dataset(doc), DataFactory).derivedFrom];
  expect(origins).toHaveLength(32);
  for (const origin of origins) expect(origin).toMatch(/^urn:sha256:[a-f0-9]{64}$/);
  const names = values(pod, "name").filter((n) => n.includes("\u4e00"));
  expect(names).toHaveLength(1);
  expect(Array.from(names[0] as string)).toHaveLength(256);
}, 30000);

it("bounds retained track points per file and truncates the activity at the cap", async () => {
  const tracks = Array.from({ length: 6 }, (_, t) => {
    const points = Array.from(
      { length: 10 },
      (_, i) => `<trkpt lat="${i / 1000}" lon="${t}"><time>${at(t * 3600 + i)}</time></trkpt>`,
    ).join("");
    return `<trk><trkseg>${points}</trkseg></trk>`;
  }).join("");
  const { pod, report } = await fileImport(
    createActivityFilesAdapter({ fileTrackPoints: 25 }),
    memoryFile("many.gpx", `<gpx>${tracks}</gpx>`),
  );
  expect(report.warnings).toContain("file-track-point-cap-exceeded");
  // Two complete tracks, then the third is truncated and parsing stops.
  expect(docs(pod)).toHaveLength(3);
  const descriptions = docs(pod).map(
    (doc) => new ActivityResource(`${doc}#activity`, pod.dataset(doc), DataFactory).description,
  );
  expect(descriptions.filter(Boolean)).toHaveLength(1);
});

describe("TCX elapsed duration", () => {
  it("deduplicates a paused TCX against the matching FIT by elapsed time", async () => {
    const paused = GARMIN_TCX.replaceAll(
      "<TotalTimeSeconds>30</TotalTimeSeconds>",
      "<TotalTimeSeconds>15</TotalTimeSeconds>",
    );
    const { pod } = await fileImport(activityFilesAdapter, file(syntheticFit()));
    await fileImport(activityFilesAdapter, memoryFile("paused.tcx", paused), { pod });
    expect(docs(pod)).toHaveLength(1);
    expect(action(pod).duration).toBe("PT60S");
    expect(action(pod).originals.size).toBe(2);
  });
  it("uses lap start times plus the last lap's timer time without trackpoints", async () => {
    const xml = tcx(
      `<Activity Sport="Running"><Id>${START}</Id><Lap StartTime="${START}"><TotalTimeSeconds>20</TotalTimeSeconds></Lap><Lap StartTime="${at(40)}"><TotalTimeSeconds>20</TotalTimeSeconds></Lap></Activity>`,
    );
    const { pod } = await fileImport(activityFilesAdapter, memoryFile("laps.tcx", xml));
    expect(action(pod).duration).toBe("PT60S");
    expect(action(pod).end?.getTime()).toBe(Date.parse(END));
  });
});
