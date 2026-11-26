// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseCsv, parseCsvRows } from "../core/csv.js";
import type { FileImportAdapter, ImportFile } from "../core/file-import.js";
import { csvRecords, fileText } from "../core/file-stream.js";
import {
  cappedSink,
  InflationBudget,
  readZipEntry,
  zipDirectory,
} from "../google-takeout/zip-reader.js";
import { PARTIAL_WARNING, whoopAdapter } from "./adapter.js";
import { type CsvSource, newestRows } from "./file-batches.js";
import {
  type Kind,
  MAX_RECORDS,
  type Metric,
  number,
  timestamp,
  type WhoopRecord,
  writeRecords,
} from "./model.js";
import { vocabMap } from "./vocab-map.js";

export const MAX_WHOOP_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_WHOOP_ENTRY_BYTES = 16 * 1024 * 1024;
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const FILES = new Set([
  "physiological_cycles.csv",
  "sleeps.csv",
  "workouts.csv",
  "journal_entries.csv",
]);

export function createWhoopFileAdapter(maxRecords = MAX_RECORDS): FileImportAdapter {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 2 || maxRecords > MAX_RECORDS)
    throw new RangeError("WHOOP file record budget must be between 2 and 10000.");
  return {
    vocabMap,
    metadata: { ...whoopAdapter.metadata, authKind: "export-file", scopes: [], requirements: [] },
    accept: ".zip,.csv,application/zip,text/csv",
    streaming: true,
    fileHint:
      "WHOOP → More → App Settings → Data Export. Select my_whoop_data_<date>.zip, or a single physiological_cycles.csv, sleeps.csv or workouts.csv. Journal entries and WHOOP scores have no supported mapping.",
    async importFile(input, ctx) {
      if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > MAX_WHOOP_FILE_BYTES)
        throw new Error("WHOOP export exceeds the 64 MiB file limit.");
      const file = checkedFile(input, ctx.signal);
      const records: WhoopRecord[] = [];
      const sources: CsvSource[] = [];
      const unsupported = new Set<string>();
      let rows = 0;
      const charge = () => {
        ctx.signal?.throwIfAborted();
        ++rows;
      };
      const skip = () => {
        charge();
        ctx.skip();
      };
      async function parse(chunks: AsyncIterable<string>, name: string): Promise<void> {
        let headers: readonly string[] | undefined;
        let kind: Kind | undefined;
        for await (const record of csvRecords(chunks, skip)) {
          ctx.signal?.throwIfAborted();
          if (!headers) {
            headers = parseCsv(record).headers.map(normal);
            if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
              throw new Error("Ambiguous WHOOP CSV headers.");
            const has = (header: string) => headers?.includes(normal(header));
            if (has("Recovery score %")) unsupported.add("WHOOP recovery score %");
            if (has("Day Strain") || has("Activity Strain")) unsupported.add("WHOOP strain");
            if (has("Sleep performance %")) unsupported.add("WHOOP sleep performance %");
            kind =
              name === "physiological_cycles.csv"
                ? "cycle"
                : name === "workouts.csv" || has("Workout start time")
                  ? "workout"
                  : name === "sleeps.csv" || has("Sleep onset")
                    ? "sleep"
                    : has("Cycle start time")
                      ? "cycle"
                      : undefined;
            const required =
              kind === "workout"
                ? "Workout start time"
                : kind === "sleep"
                  ? "Sleep onset"
                  : "Cycle start time";
            if (!kind || !has(required)) throw new Error("Unrecognised WHOOP CSV headers.");
            continue;
          }
          charge();
          const cells = parseCsvRows(record, ",", headers.length, () => ctx.skip())[0];
          if (!cells || cells.length !== headers.length) {
            if (cells) ctx.skip();
            continue;
          }
          const row = Object.fromEntries(
            headers.map((header, i) => [header, (cells[i] ?? "").trim()]),
          );
          const read = (...names: string[]) =>
            names
              .map(normal)
              .map((key) => row[key])
              .find((v) => v !== undefined && v !== "");
          const start = timestamp(
            read(
              kind === "workout"
                ? "Workout start time"
                : kind === "sleep"
                  ? "Sleep onset"
                  : "Cycle start time",
            ),
            read(
              kind === "workout"
                ? "Workout timezone"
                : kind === "sleep"
                  ? "Sleep timezone"
                  : "Cycle timezone",
              "Cycle timezone",
            ),
          );
          if (!start) {
            ctx.skip();
            continue;
          }
          const end = timestamp(
            read(
              kind === "workout"
                ? "Workout end time"
                : kind === "sleep"
                  ? "Wake onset"
                  : "Cycle end time",
            ),
            read(
              kind === "workout"
                ? "Workout timezone"
                : kind === "sleep"
                  ? "Sleep timezone"
                  : "Cycle timezone",
              "Cycle timezone",
            ),
          );
          if (
            (kind === "sleep" || kind === "workout") &&
            (!end || end <= start || end.getTime() - start.getTime() > 7 * 86_400_000)
          ) {
            ctx.skip();
            continue;
          }
          const entry: WhoopRecord = { kind: kind as Kind, start, end, values: {} };
          let invalidNumber = false;
          let recovery: WhoopRecord | undefined;
          const add = (key: Metric, names: string[], factor = 1, max = 1_000_000_000, min = 0) => {
            const raw = read(...names);
            if (raw === undefined) return;
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
              invalidNumber = true;
              return;
            }
            const value = number(Number(raw) * factor, max, min);
            if (value !== undefined) entry.values[key] = value;
            else invalidNumber = true;
          };
          if (kind === "sleep") {
            add("sleep", ["Asleep duration (min)"], 60, 7 * 86_400);
            add("light", ["Light sleep duration (min)", "Light duration (min)"], 60, 7 * 86_400);
            add("deep", ["Deep (SWS) duration (min)", "Deep sleep duration (min)"], 60, 7 * 86_400);
            add("rem", ["REM duration (min)", "REM sleep duration (min)"], 60, 7 * 86_400);
            add("respiratory", ["Respiratory rate (rpm)"], 1, 100);
            const total = entry.values.sleep;
            const stages = [entry.values.light, entry.values.deep, entry.values.rem];
            const sum = stages.reduce<number>((a, b) => a + (b ?? 0), 0);
            const elapsed = ((end as Date).getTime() - start.getTime()) / 1000;
            if (
              (total !== undefined && total > elapsed) ||
              sum > elapsed ||
              (total !== undefined && sum > total + 180)
            ) {
              ctx.skip();
              continue;
            }
            if (total === undefined && stages.every((v) => v !== undefined))
              entry.values.sleep = sum;
          } else {
            add("energy", ["Energy burned (cal)", "Energy burned (kcal)"], 4.184, 1_000_000);
            add("averageHR", ["Average HR (bpm)"], 1, 300);
            add("maxHR", ["Max HR (bpm)"], 1, 300);
            if (kind === "workout") entry.name = read("Activity name")?.slice(0, 256);
            if (kind === "cycle") {
              // Physiological CSVs combine the cycle and its recovery in one row.
              recovery = { kind: "recovery", start, values: {} };
              const daily = entry.values;
              entry.values = recovery.values;
              add("restingHR", ["Resting heart rate (bpm)"], 1, 300);
              add("hrv", ["Heart rate variability (ms)"], 1, 10_000);
              add("temperature", ["Skin temp (celsius)", "Skin temperature (celsius)"], 1, 60, -20);
              add("oxygen", ["Blood oxygen %"], 1, 100);
              entry.values = daily;
            }
          }
          if (invalidNumber) {
            ctx.skip();
            continue;
          }
          if (recovery && Object.keys(recovery.values).length) records.push(recovery);
          if (Object.keys(entry.values).length || kind === "workout") records.push(entry);
          else if (kind !== "cycle") ctx.skip();
        }
        if (!headers) throw new Error("Missing WHOOP CSV header.");
      }
      if (await isZip(file)) {
        if (!file.stream || !file.slice)
          throw new Error("WHOOP ZIP requires file.stream() and file.slice().");
        const entries = await zipDirectory(file, 100);
        const inflationBudget = new InflationBudget(MAX_WHOOP_FILE_BYTES);
        const seen = new Set<string>();
        for (const entry of entries) {
          ctx.signal?.throwIfAborted();
          if (entry.invalid) throw new Error("Invalid WHOOP ZIP entry.");
          if (entry.name.endsWith("/")) continue;
          const parts = entry.name.split("/");
          if (
            parts.length > 4 ||
            parts.some((part) => !part || part === "." || part === "..") ||
            entry.name.includes("\\") ||
            Array.from(entry.name).some((char) => char.charCodeAt(0) < 32)
          )
            throw new Error("Unsafe WHOOP ZIP entry path.");
          const name = parts.at(-1)?.toLowerCase() ?? "";
          if (!FILES.has(name)) {
            unsupported.add("Unrecognised WHOOP archive entry");
            continue;
          }
          if (seen.has(name)) throw new Error("Duplicate WHOOP export CSV.");
          seen.add(name);
          if (name === "journal_entries.csv") {
            unsupported.add("journal_entries.csv");
            continue;
          }
          if (entry.size > MAX_WHOOP_ENTRY_BYTES)
            throw new Error("WHOOP CSV exceeds the 16 MiB entry limit.");
          const sink = cappedSink(MAX_WHOOP_ENTRY_BYTES, async (bytes) => {
            if (!bytes) throw new Error("WHOOP CSV exceeds the entry limit.");
            sources.push({ name, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
          });
          await readZipEntry(
            file,
            entry,
            {
              push: async (bytes, final) => {
                ctx.signal?.throwIfAborted();
                await sink.push(bytes, final);
              },
            },
            { inflationBudget },
            MAX_WHOOP_ENTRY_BYTES,
          );
        }
      } else {
        if (/\.zip$/i.test(file.name)) throw new Error("Invalid WHOOP ZIP signature.");
        const name = file.name.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
        if (name === "journal_entries.csv") unsupported.add(name);
        else {
          const chunks: string[] = [];
          for await (const chunk of fileText(file)) chunks.push(chunk);
          sources.push({ name, text: chunks.join("") });
        }
      }
      let cursor: string | undefined;
      let partial = false;
      if (sources.length) {
        const batch = await newestRows(sources, ctx, Math.min(ctx.maxRows, maxRecords));
        let last: string | undefined;
        let processed = 0;
        for (const row of batch.rows) {
          if (processed >= Math.min(ctx.maxRows, maxRecords) || records.length >= maxRecords) {
            partial = true;
            break;
          }
          const count = records.length;
          await parse(oneText(`${row.header}\n${row.text}`), row.name);
          if (records.length > maxRecords) {
            // Keep both halves of a physiological row in the same successful batch.
            records.length = count;
            partial = true;
            break;
          }
          processed++;
          last = row.key;
        }
        cursor = partial && last ? batch.cursor(last) : batch.complete;
      }
      ctx.progress({ label: "Saving WHOOP health data…", done: rows });
      await writeRecords(records, ctx, "file");
      return {
        unsupported: [...unsupported],
        cursor,
        warnings: partial ? [PARTIAL_WARNING] : undefined,
      };
    },
  };
}
export const whoopFileAdapter = createWhoopFileAdapter();

async function* oneText(text: string): AsyncGenerator<string> {
  yield text;
}

async function isZip(file: ImportFile): Promise<boolean> {
  if (!file.stream) {
    if (/\.zip$/i.test(file.name))
      throw new Error("WHOOP ZIP requires file.stream() and file.slice().");
    return false;
  }
  const reader = file.stream().getReader();
  const prefix = new Uint8Array(4);
  let length = 0;
  try {
    while (length < 4) {
      const { value, done } = await reader.read();
      if (done) break;
      const count = Math.min(value.length, 4 - length);
      prefix.set(value.subarray(0, count), length);
      length += count;
    }
    return (
      length === 4 && prefix[0] === 80 && prefix[1] === 75 && prefix[2] === 3 && prefix[3] === 4
    );
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Check cancellation at every file/range boundary, including directory preflight. */
function checkedFile(file: ImportFile, signal?: AbortSignal): ImportFile {
  const stream = (open: () => ReadableStream<Uint8Array>) => {
    signal?.throwIfAborted();
    const reader = open().getReader();
    const abort = () => {
      void reader.cancel(signal?.reason).catch(() => {});
    };
    const release = () => {
      signal?.removeEventListener("abort", abort);
      reader.releaseLock();
    };
    signal?.addEventListener("abort", abort, { once: true });
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal?.throwIfAborted();
          const result = await reader.read();
          signal?.throwIfAborted();
          if (result.done) {
            release();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          try {
            await reader.cancel();
          } finally {
            release();
          }
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await reader.cancel();
        } finally {
          release();
        }
      },
    });
  };
  const openStream = file.stream?.bind(file);
  const openSlice = file.slice?.bind(file);
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    text: async () => {
      signal?.throwIfAborted();
      const text = await file.text();
      signal?.throwIfAborted();
      return text;
    },
    stream: openStream ? () => stream(openStream) : undefined,
    slice: openSlice
      ? (start, end) => ({ stream: () => stream(() => openSlice(start, end).stream()) })
      : undefined,
  };
}
