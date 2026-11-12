// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Bounded, entry-detected Garmin account archives. Nested archives are never opened. */
import { buildObservation, HEALTH, monthlyDocumentPath } from "@jeswr/solid-health";
import { DataFactory, Store } from "n3";
import { isoDurationFromSeconds } from "../core/duration.js";
import type { FileImportContext, FileImportOutcome, ImportFile } from "../core/file-import.js";
import { MAX_FILE_BYTES } from "../core/file-import.js";
import { jsonEntries } from "../core/file-json.js";
import { fileText } from "../core/file-stream.js";
import { SectorThing } from "../core/file-vocab-map.js";
import type { NormalisedDoc } from "../core/types.js";
import { CLASSES, ExerciseAction, TravelAction } from "../core/vocab.js";
import {
  cappedSink,
  InflationBudget,
  readZipEntry,
  TotalInflatedLimit,
  ZipDecoderError,
  zipDirectory,
} from "../google-takeout/zip-reader.js";
import { isTravelActivity } from "./activity-kind.js";
import { METRICS, type Metric } from "./health-vocab.js";

export interface GarminArchiveLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxJsonBytes: number;
  readonly maxTotalBytes: number;
  readonly maxRecordsPerFile: number;
  /** All attempted records, including malformed and oversized rows, across entries. */
  readonly maxRecordsPerRun: number;
  /** Includes activity records and daily measurements, including duplicates. */
  readonly maxObservations: number;
  readonly maxCompressionRatio: number;
}
export const GARMIN_ARCHIVE_LIMITS: GarminArchiveLimits = Object.freeze({
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxJsonBytes: 32 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRecordsPerFile: 100_000,
  maxRecordsPerRun: 1_000_000,
  maxObservations: 100_000,
  maxCompressionRatio: 1_000,
});

type Product = "activities" | "daily" | "sleep" | "hrv" | "vo2max" | "fit";
function entryParts(name: string): string[] | undefined {
  if (
    name.length > 4096 ||
    name.includes("\\") ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return undefined;
  const parts = name.split("/");
  if (parts.length > 16 || parts.some((part) => !part.trim() || part === "." || part === ".."))
    return undefined;
  return parts;
}
/** Match path components, never the ZIP's name or an arbitrary substring of a directory. */
export function garminProduct(name: string): Product | undefined {
  const parts = entryParts(name);
  if (!parts) return undefined;
  const leaf = parts.at(-1) as string;
  const parent = parts.at(-2)?.toLowerCase();
  if (parent === "di-connect-uploaded-files" && /\.zip$/i.test(leaf)) return "fit";
  if (!/\.json$/i.test(leaf) || parts.at(-3)?.toUpperCase() !== "DI_CONNECT") return undefined;
  if (parent === "di-connect-fitness" && /summarizedActivities/i.test(leaf)) return "activities";
  if (parent === "di-connect-aggregator" && /UDSFile_/i.test(leaf)) return "daily";
  if (parent === "di-connect-wellness" && /sleepData/i.test(leaf)) return "sleep";
  if (parent === "di-connect-wellness" && /healthStatusData|hrv/i.test(leaf)) return "hrv";
  if (parent === "di-connect-metrics" && /MetricsMaxMetData/i.test(leaf)) return "vo2max";
  return undefined;
}

/** Reopen non-archive text through the shared 64 MiB cap; archives never call text(). */
export async function garminInput(
  file: ImportFile,
  signal?: AbortSignal,
): Promise<{ zip: true } | { zip: false; text: string }> {
  signal?.throwIfAborted();
  if (file.stream) {
    const reader = file.stream().getReader();
    const signature: number[] = [];
    try {
      while (signature.length < 4) {
        signal?.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        for (let i = 0; i < next.value.length && signature.length < 4; i++)
          signature.push(next.value[i] as number);
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    if (signature.join(",") === "80,75,3,4") {
      if (!file.slice) throw new Error("Garmin ZIP imports require file.slice().");
      return { zip: true };
    }
  } else if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
    throw new Error("Garmin ZIP imports require file.stream() and file.slice().");
  }
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Garmin text export exceeds the 64 MiB import limit.");
  const chunks: string[] = [];
  for await (const chunk of fileText(file)) {
    signal?.throwIfAborted();
    chunks.push(chunk);
  }
  const text = chunks.join("");
  if (text.startsWith("PK\x03\x04"))
    throw new Error("Garmin ZIP imports require file.stream() and file.slice().");
  return { zip: false, text };
}

type Row = Record<string, unknown>;
class RecordLimit extends Error {}
function object(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1024) : undefined;
}
function number(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)))
    return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
function date(value: unknown): Date | undefined {
  const numeric = number(value);
  if (numeric !== undefined) {
    // Garmin epochs are milliseconds. Never guess seconds or accept sentinel/date-like
    // numbers (e.g. 0 or 20260601) as dates near 1970.
    if (numeric < Date.UTC(2000, 0, 1) || numeric > Date.now() + 86400000) return undefined;
    return new Date(numeric);
  }
  const raw = text(value);
  if (
    !raw ||
    !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)
  )
    return undefined;
  const calendar = raw.slice(0, 10);
  const midnight = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== calendar)
    return undefined;
  const iso = raw.replace(" ", "T");
  const normalized = iso.includes("T")
    ? /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso)
      ? iso
      : `${iso}Z`
    : `${iso}T00:00:00Z`;
  const result = new Date(normalized);
  // Calendar strings also need a finite, bounded shard space.
  return Number.isFinite(result.getTime()) &&
    result.getUTCFullYear() >= 1900 &&
    result.getUTCFullYear() <= 2199
    ? result
    : undefined;
}
function day(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const result = date(raw);
  return result?.toISOString().slice(0, 10) === raw ? result : undefined;
}

function timestampDay(value: unknown): Date | undefined {
  const parsed = date(value);
  if (!parsed) return undefined;
  // Daily metrics belong to the timestamp's local calendar day, even when its
  // offset crosses a UTC day/month boundary. Store that day at UTC midnight.
  const raw = text(value);
  return day(raw?.includes("-") ? raw.slice(0, 10) : parsed.toISOString().slice(0, 10));
}

/** Normalize an object root to an array without copying its text. Two selector passes
 * support both flat arrays and large wrapper arrays without retaining a wrapper record.
 * Each pass is linear and the shared reader caps tokens, records and nesting (64).
 */
async function* records(
  bytes: Uint8Array,
  kind: Product,
  skip: () => void,
  unrecognized: () => void,
): AsyncGenerator<Row> {
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
  let first = bom;
  while (first < bytes.length && [9, 10, 13, 32].includes(bytes[first] as number)) first++;
  const wrappedRoot = bytes[first] === 123;
  const input: ImportFile = {
    name: "entry.json",
    type: "application/json",
    size: bytes.length + (wrappedRoot ? 2 : 0),
    text: async () => {
      throw new Error("JSON entries must stream.");
    },
    stream: () =>
      new ReadableStream({
        start(controller) {
          if (wrappedRoot) controller.enqueue(new Uint8Array([91]));
          for (let at = bom; at < bytes.length; at += 65536)
            controller.enqueue(bytes.subarray(at, at + 65536));
          if (wrappedRoot) controller.enqueue(new Uint8Array([93]));
          controller.close();
        },
      }),
  };
  const keys: Record<Product, string[]> = {
    activities: ["summarizedActivitiesExport"],
    daily: ["dailySummaries", "UDSFile"],
    sleep: ["sleepData", "dailySleepDTO"],
    hrv: ["healthStatusData", "hrvSummaries", "hrvDailySummaries"],
    vo2max: ["MetricsMaxMetData", "generic", "cycling"],
    fit: [],
  };
  let found = false;
  let unmatched = 0;
  const selected = () => {
    found = true;
    while (unmatched > 0) {
      unmatched--;
      unrecognized();
    }
  };
  try {
    for await (const entry of jsonEntries(
      input,
      keys[kind].map((key) => `[].${key}`),
      kind === "sleep" ? ["[].dailySleepDTO"] : [],
      () => {
        selected();
        skip();
      },
      (path) => {
        if (path !== "") return;
        if (found) unrecognized();
        else unmatched++;
      },
    )) {
      selected();
      const row = object(entry.value);
      yield kind === "vo2max" && entry.path === "[].cycling"
        ? { ...row, garminCycling: true }
        : row;
    }
  } catch (error) {
    // An oversized ignored field in a flat record must be charged as a record
    // skip on the second pass. Never replay a wrapper after yielding its rows.
    if (found) throw error;
  }
  if (!found)
    for await (const entry of jsonEntries(input, [""], [], skip)) yield object(entry.value);
}

class Mapper {
  private readonly activities = new Map<string, NormalisedDoc>();
  private readonly metrics = new Map<string, NormalisedDoc>();
  private observations = 0;
  constructor(
    private readonly ctx: FileImportContext,
    private readonly limit: number,
  ) {}
  get full(): boolean {
    return this.observations >= this.limit;
  }
  private document(
    slug: string,
    forClass: string,
    category: "health" | "mobility",
    activity = false,
  ): NormalisedDoc {
    const documents = activity ? this.activities : this.metrics;
    let doc = documents.get(slug);
    if (!doc) {
      doc = { slug, category, forClass, dataset: new Store(), writeMode: "merge" };
      documents.set(slug, doc);
    }
    return doc;
  }
  activity(row: Row): boolean {
    const id =
      typeof row.activityId === "number" &&
      Number.isSafeInteger(row.activityId) &&
      row.activityId >= 0
        ? String(row.activityId)
        : text(row.activityId);
    const type = text(row.activityType) ?? text(object(row.activityType).typeKey);
    const start = date(row.startTimeGmt) ?? date(row.startTimeGMT) ?? date(row.beginTimestamp);
    if (!id || !/^\d{1,32}$/.test(id) || !type || !start) return false;
    // Same rides/commutes policy as the CSV/GPX/TCX adapter, with underscore type keys.
    const normalized = type.replace(/_/g, " ");
    const travel = isTravelActivity(normalized);
    const slug = travel ? "mobility/journeys.ttl" : "health/activities.ttl";
    const doc = this.document(
      slug,
      travel ? CLASSES.TravelAction : CLASSES.ExerciseAction,
      travel ? "mobility" : "health",
      true,
    );
    const iri = `${this.ctx.resolve(slug)}#${travel ? "journey" : "activity"}-${id}`;
    const action = travel
      ? new TravelAction(iri, doc.dataset, DataFactory).mark()
      : new ExerciseAction(iri, doc.dataset, DataFactory).mark();
    action.name = text(row.name) ?? text(row.activityName) ?? type;
    action.identifier = id;
    action.sourceUrl = `https://connect.garmin.com/modern/activity/${id}`;
    action.startTime = start;
    const duration = number(row.duration),
      distance = number(row.distance),
      calories = number(row.calories);
    action.duration = duration === undefined ? undefined : isoDurationFromSeconds(duration / 1000);
    action.distance = distance === undefined ? undefined : `${distance / 100} m`;
    // summarizedActivities calories appear to be kJ-like; conversion to kcal
    // (divide by 4.184, round to 1 dp) is pending verification against a real export.
    action.calories =
      calories === undefined ? undefined : `${Math.round((calories / 4.184) * 10) / 10} kcal`;
    if (action instanceof ExerciseAction) action.exerciseType = type;
    // Preserve extra summary fields without minting Garmin predicates.
    const details: string[] = [];
    for (const key of ["avgHr", "maxHr", "elevationGain"] as const) {
      const value = number(row[key]);
      if (value !== undefined)
        details.push(`${key}: ${key === "elevationGain" ? `${value / 100} m` : `${value} bpm`}`);
    }
    action.description = details.length ? details.join("; ") : undefined;
    this.observations++;
    return true;
  }
  metric(kind: Metric, at: Date, value: unknown, note?: string): boolean {
    const numeric = number(value);
    if (numeric === undefined || this.full || (kind === "steps" && !Number.isSafeInteger(numeric)))
      return false;
    const slug = monthlyDocumentPath(kind, at);
    const [type, codeValue, unitCode, unit] = METRICS[kind];
    const doc = this.document(slug, HEALTH.Observation, "health");
    const url = this.ctx.resolve(slug);
    const iri = `${url}#garmin-${kind}-${at.toISOString().slice(0, 10)}`;
    // An account export does not establish that its patient is the Pod owner.
    const patient = `${url}#subject`;
    const record = new SectorThing(url, doc.dataset, DataFactory);
    record.types.add(HEALTH.Record);
    record.dataSubject = patient;
    // Stage only the source observation here. The generated model validates the
    // whole graph; the vocab map adds helper subjects after session item counting.
    const built = buildObservation(iri, {
      type,
      codeValue,
      measuredValue: numeric,
      unit,
      unitCode,
      dateTime: at,
      name: kind,
      source: "Garmin Connect",
      description: note,
      scheme: /^(?:55423-8|8867-4|93832-4)$/.test(codeValue) ? "http://loinc.org" : undefined,
    });
    const dataset = doc.dataset as Store;
    dataset.removeQuads(dataset.getQuads(DataFactory.namedNode(iri), null, null, null));
    for (const quad of built.match(DataFactory.namedNode(iri))) dataset.add(quad);
    this.observations++;
    return true;
  }
  async flush(): Promise<void> {
    // No Pod writes until all recognised entries have been parsed. Decoder or
    // cancellation failures during staging leave the Pod untouched.
    for (const doc of [...this.metrics.values(), ...this.activities.values()]) {
      this.ctx.signal?.throwIfAborted();
      await this.ctx.write(doc);
    }
  }
}

/** Notes are bounded, static reason codes; no account names or source paths are retained. */
export async function importGarminArchive(
  file: ImportFile,
  ctx: FileImportContext,
  limits: GarminArchiveLimits,
): Promise<FileImportOutcome> {
  const rangedFile: ImportFile = {
    name: file.name,
    size: file.size,
    type: file.type,
    text: async () => {
      throw new Error("Garmin ZIP imports must use ranges.");
    },
    slice(start, end) {
      ctx.signal?.throwIfAborted();
      if (!file.slice) throw new Error("Garmin ZIP imports require file.slice().");
      return file.slice(start, end);
    },
  };
  const entries = await zipDirectory(rangedFile);
  ctx.signal?.throwIfAborted();
  if (
    !entries.some((entry) => {
      if (entry.invalid) return false;
      const parts = entryParts(entry.name);
      return (
        garminProduct(entry.name) ||
        (parts?.at(-3)?.toUpperCase() === "DI_CONNECT" && /^DI-Connect-/i.test(parts.at(-2) ?? ""))
      );
    })
  )
    throw new Error("This ZIP is not a recognized Garmin account export.");
  const notes = new Map<string, number>();
  const gaps = new Map<string, { files: number; days: number }>();
  let skipped = 0;
  let recordAttempts = 0;
  const note = (reason: string, count = 1) => {
    if (reason !== "unrecognized-file") skipped += count;
    notes.set(reason, (notes.get(reason) ?? 0) + count);
  };
  const omitEntries = (remaining: typeof entries, reason: string) => {
    for (const entry of remaining)
      note(
        entry.invalid
          ? "invalid-zip-entry"
          : entry.name.endsWith("/") || !garminProduct(entry.name)
            ? "unrecognized-file"
            : reason,
      );
  };
  const mapper = new Mapper(ctx, limits.maxObservations);
  const inflationBudget = new InflationBudget(limits.maxTotalBytes);
  if (entries.length > limits.maxEntries)
    omitEntries(entries.slice(limits.maxEntries), "entry-count-cap-exceeded");
  for (const [index, entry] of entries.slice(0, limits.maxEntries).entries()) {
    ctx.signal?.throwIfAborted();
    ctx.progress({
      label: "Reading Garmin account archive…",
      done: index,
      total: Math.min(entries.length, limits.maxEntries),
    });
    ctx.signal?.throwIfAborted();
    if (entry.name.endsWith("/") && !entry.invalid) {
      note("unrecognized-file");
      continue;
    }
    const product = garminProduct(entry.name);
    if (entry.invalid) {
      note("invalid-zip-entry");
      continue;
    }
    if (!product) {
      note("unrecognized-file");
      continue;
    }
    if (product === "fit") {
      note("nested-FIT-zip: use the activity-files adapter; nested archives are not opened");
      continue;
    }
    if (mapper.full) {
      note("total-observation-cap-exceeded");
      continue;
    }
    if (recordAttempts >= limits.maxRecordsPerRun) {
      note("total-record-cap-exceeded");
      continue;
    }
    if (entry.size > limits.maxEntryBytes) {
      note("entry-decompressed-byte-cap-exceeded");
      continue;
    }
    if (entry.size > limits.maxJsonBytes) {
      note("entry-JSON-byte-cap-exceeded");
      continue;
    }
    if (entry.size > Math.max(1, entry.compressedSize) * limits.maxCompressionRatio) {
      note("zip-compression-ratio-cap-exceeded");
      continue;
    }
    if (entry.size > inflationBudget.remaining) {
      note("total-decompressed-byte-cap-exceeded");
      continue;
    }
    let bytes: Uint8Array | undefined;
    try {
      const sink = cappedSink(limits.maxJsonBytes, async (value) => {
        bytes = value;
      });
      await readZipEntry(
        rangedFile,
        entry,
        {
          async push(chunk, final) {
            ctx.signal?.throwIfAborted();
            await sink.push(chunk, final);
          },
        },
        { inflationBudget },
        limits.maxEntryBytes,
        1024,
      );
    } catch (error) {
      ctx.signal?.throwIfAborted();
      if (error instanceof ZipDecoderError)
        throw new Error("Garmin ZIP decoder failed; archive import aborted.", { cause: error });
      if (error instanceof TotalInflatedLimit) {
        omitEntries(
          entries.slice(index, limits.maxEntries),
          "total-decompressed-byte-cap-exceeded",
        );
        break;
      }
      note("invalid-zip-entry");
      continue;
    }
    if (!bytes) {
      note("entry-JSON-byte-cap-exceeded");
      continue;
    }
    let count = 0;
    let parseFailed = false;
    let malformed = false;
    const parsedRows: Row[] = [];
    const recordLimit = Math.min(ctx.maxRows, limits.maxRecordsPerFile);
    const accountRecord = () => {
      if (recordAttempts++ >= limits.maxRecordsPerRun)
        throw new RecordLimit("total-record-cap-exceeded");
      if (count++ >= recordLimit) throw new RecordLimit("records-per-file-cap-exceeded");
    };
    const rows = records(
      bytes,
      product,
      () => {
        accountRecord();
        note("JSON-record-byte-cap-exceeded");
      },
      () => {
        accountRecord();
        note("unrecognized-or-invalid-record");
      },
    );
    const gapDays = new Map<string, Set<string>>();
    const recordNote = (reason: string, affectedDay?: string) => {
      if (!affectedDay) return note(reason);
      let days = gapDays.get(reason);
      if (!days) {
        days = new Set();
        gapDays.set(reason, days);
      }
      days.add(affectedDay);
    };
    try {
      while (true) {
        ctx.signal?.throwIfAborted();
        let next: IteratorResult<Row>;
        // Parsing errors are entry-local. Pod errors must propagate (never catch writes).
        try {
          next = await rows.next();
        } catch (error) {
          ctx.signal?.throwIfAborted();
          parseFailed = true;
          malformed = !(error instanceof RecordLimit);
          note(error instanceof RecordLimit ? error.message : "invalid-or-too-deep-JSON");
          break;
        }
        if (next.done) break;
        try {
          accountRecord();
        } catch (error) {
          if (!(error instanceof RecordLimit)) throw error;
          note(error.message);
          break;
        }
        if (mapper.full) {
          note("total-observation-cap-exceeded");
          break;
        }
        parsedRows.push(next.value);
      }
    } finally {
      await rows.return(undefined);
    }
    // A malformed entry contributes no documents, including rows yielded before
    // its bad token; those discarded rows are reported as skipped too.
    if (malformed && parsedRows.length)
      note("records-discarded-with-malformed-entry", parsedRows.length);
    if (!malformed)
      for (const row of parsedRows) {
        ctx.signal?.throwIfAborted();
        if (mapper.full) {
          note("total-observation-cap-exceeded");
          break;
        }
        if (!mapRow(product, row, mapper, recordNote)) note("unrecognized-or-invalid-record");
      }
    for (const [reason, days] of gapDays) {
      const previous = gaps.get(reason) ?? { files: 0, days: 0 };
      gaps.set(reason, { files: previous.files + 1, days: previous.days + days.size });
    }
    if (count === 0 && !parseFailed) note("empty-or-unrecognized-JSON");
  }
  await mapper.flush();
  return {
    skipped,
    unsupported: [
      ...[...notes].map(
        ([reason, count]) =>
          `Garmin ${reason}: ${count} ${reason === "unrecognized-file" ? "unrecognized" : "skipped"}.`,
      ),
      ...[...gaps].map(
        ([reason, count]) => `Garmin ${reason}: ${count.files} files; ${count.days} affected days.`,
      ),
    ],
  };
}

function mapRow(
  kind: Product,
  raw: Row,
  mapper: Mapper,
  note: (reason: string, affectedDay?: string) => void,
): boolean {
  if (kind === "activities") return mapper.activity(raw);
  const row = Object.keys(object(raw.dailySleepDTO)).length ? object(raw.dailySleepDTO) : raw;
  const hrv = object(row.hrvSummary);
  const at =
    day(row.calendarDate ?? hrv.calendarDate) ??
    timestampDay(row.metricsDate ?? row.date ?? row.timestamp);
  if (!at) return false;
  let mapped = false;
  const add = (metric: Metric, value: unknown, details?: string) => {
    if (mapper.full && number(value) !== undefined) note("total-observation-cap-exceeded");
    mapped = mapper.metric(metric, at, value, details) || mapped;
  };
  const gap = (reason: string) => {
    note(reason, at.toISOString().slice(0, 10));
    mapped = true;
  };
  if (kind === "daily") {
    for (const [field, metric] of [
      ["totalSteps", "steps"],
      ["totalDistanceMeters", "distance"],
      ["restingHeartRate", "resting-heart-rate"],
      ["minHeartRate", "minimum-heart-rate"],
      ["maxHeartRate", "maximum-heart-rate"],
      ["averageHeartRate", "heart-rate"],
      ["activeKilocalories", "active-energy"],
      ["floorsAscended", "floors"],
    ] as const)
      add(metric, row[field]);
    if (["averageStressLevel", "allDayStress"].some((key) => row[key] != null))
      gap("vocabulary-gap-stress");
    if (Object.keys(row).some((key) => /bodyBattery/i.test(key) && row[key] != null))
      gap("vocabulary-gap-Body-Battery");
    if (["moderateIntensityMinutes", "vigorousIntensityMinutes"].some((key) => row[key] != null))
      gap("vocabulary-gap-intensity-minutes");
  } else if (kind === "sleep") {
    const stages = [row.deepSleepSeconds, row.lightSleepSeconds, row.remSleepSeconds].map(number);
    const start = date(row.sleepStartTimestampGMT),
      end = date(row.sleepEndTimestampGMT);
    const details: string[] = [];
    if (start) details.push(`Sleep start: ${start.toISOString()}`);
    if (end) details.push(`Sleep end: ${end.toISOString()}`);
    for (const field of [
      "deepSleepSeconds",
      "lightSleepSeconds",
      "remSleepSeconds",
      "awakeSleepSeconds",
    ] as const) {
      if (number(row[field]) !== undefined) details.push(`${field}: ${number(row[field])} s`);
    }
    const score = number(
      object(row.sleepScores).overallScore ??
        object(object(row.sleepScores).overall).value ??
        object(row.sleepScores).overall,
    );
    if (score !== undefined) details.push(`Sleep score: ${score}`);
    // Awake/in-bed are not asleep. Never infer asleep duration from the whole window.
    if (stages.some((value) => value !== undefined))
      add(
        "sleep",
        stages.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        details.join("; "),
      );
  } else if (kind === "hrv") {
    add(
      "hrv",
      hrv.lastNightAvg ??
        row.lastNightAvg ??
        row.overnightHrvAverage ??
        row.hrvValue ??
        object(row.hrv).value,
      "Overnight HRV (source summary; no statistic inferred).",
    );
  } else if (kind === "vo2max") {
    const generic = object(row.generic),
      cycling = object(row.cycling);
    add(
      row.garminCycling === true || text(row.sport)?.toLowerCase() === "cycling"
        ? "vo2max-cycling"
        : "vo2max-running",
      generic.vo2MaxPreciseValue ??
        generic.vo2MaxValue ??
        row.vo2MaxPreciseValue ??
        row.vo2MaxValue ??
        row.vo2Max,
    );
    add("vo2max-cycling", cycling.vo2MaxPreciseValue ?? cycling.vo2MaxValue);
  }
  return mapped;
}
