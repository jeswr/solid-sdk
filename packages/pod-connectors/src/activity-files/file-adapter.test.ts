// AUTHORED-BY Codex GPT-6.1-Sol
import { zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  END,
  GARMIN_GPX,
  GARMIN_TCX,
  START,
  STRAVA_GPX,
  syntheticFit,
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
    expect(
      [...prov.derivedFrom].some(
        (s) => s.startsWith("urn:sha256:") && s.endsWith("misleading.fit"),
      ),
    ).toBe(true);
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
    const other = GARMIN_TCX.replaceAll(
      START,
      new Date(Date.parse(START) + startDelta * 1000).toISOString(),
    ).replaceAll("<TotalTimeSeconds>30", `<TotalTimeSeconds>${30 + durationDelta / 2}`);
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
      `<trk><type>sport-${i}</type><trkseg><trkpt lat="0" lon="0"><time>${START}</time></trkpt></trkseg></trk>`,
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
  expect(action(pod).duration).toBe("PT0S");
  expect(action(pod).distance).toBe("0 m");
  expect(action(pod).calories).toBe("0 kcal");
});

it("uses the file hash when a TCX creator has an empty device serial", async () => {
  const first = GARMIN_TCX.replace("<UnitId>42</UnitId>", "<UnitId></UnitId>");
  const { pod } = await fileImport(activityFilesAdapter, memoryFile("first.tcx", first));
  const second = first.replaceAll("<TotalTimeSeconds>30", "<TotalTimeSeconds>60");
  await fileImport(activityFilesAdapter, memoryFile("second.tcx", second), { pod });
  expect(docs(pod)).toHaveLength(2);
});
