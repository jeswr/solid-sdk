// AUTHORED-BY Codex GPT-6.1-Sol
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import {
  cappedSink,
  InflationBudget,
  readZip,
  TotalInflatedLimit,
  ZIP_PIECE_BYTES,
  zipDirectory,
} from "../google-takeout/zip-reader.js";
import { fitActivities } from "./fit.js";
import { digest, originIri, saveActivity, writeOriginal } from "./mapping.js";
import { type Activity, ActivityBudget, type ActivityLimits } from "./model.js";
import { vocabMap } from "./vocab-map.js";
import { xmlActivities } from "./xml.js";

async function* decoded(bytes: Uint8Array): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < bytes.length; i += 16384)
    yield decoder.decode(bytes.subarray(i, i + 16384), { stream: true });
  yield decoder.decode();
}
class FileCap extends Error {}

/** A cancelled ranged read must wake up even while awaiting a file stream. */
function cancellableFile(file: ImportFile, signal?: AbortSignal): ImportFile {
  if (!signal) return file;
  const streamPort = file.stream?.bind(file);
  const slicePort = file.slice?.bind(file);
  const wrap = (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    };
    signal.addEventListener("abort", abort, { once: true });
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const next = await reader.read();
          signal.throwIfAborted();
          if (next.done) {
            cleanup();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          cleanup();
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await reader.cancel();
        } finally {
          cleanup();
        }
      },
    });
  };
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    text: () => file.text(),
    ...(streamPort && {
      stream: () => {
        signal.throwIfAborted();
        return wrap(streamPort());
      },
    }),
    ...(slicePort && {
      slice: (start: number, end: number) => ({
        stream: () => {
          signal.throwIfAborted();
          return wrap(slicePort(start, end).stream());
        },
      }),
    }),
  };
}
/** Byte-stream port is required for binary FIT and ZIP; text-only hosts retain XML compatibility. */
async function readFile(file: ImportFile, budget: ActivityBudget): Promise<Uint8Array> {
  if (!file.stream) {
    if (file.size > budget.limits.fileBytes) throw new FileCap();
    const bytes = new TextEncoder().encode(await file.text());
    if (bytes.length > budget.limits.fileBytes) throw new FileCap();
    return bytes;
  }
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    ended = false;
  try {
    while (true) {
      budget.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      size += value.length;
      if (size > budget.limits.fileBytes) throw new FileCap();
      // Coalesce tiny input chunks so a hostile host cannot create millions of retained arrays.
      for (let offset = 0; offset < value.length; ) {
        const position = size - value.length + offset;
        const index = Math.floor(position / ZIP_PIECE_BYTES);
        const within = position % ZIP_PIECE_BYTES;
        chunks[index] ??= new Uint8Array(ZIP_PIECE_BYTES);
        const length = Math.min(value.length - offset, ZIP_PIECE_BYTES - within);
        chunks[index].set(value.subarray(offset, offset + length), within);
        offset += length;
      }
    }
    const bytes = new Uint8Array(size);
    for (let i = 0; i < chunks.length; i++)
      bytes.set(
        (chunks[i] as Uint8Array).subarray(
          0,
          Math.min(ZIP_PIECE_BYTES, size - i * ZIP_PIECE_BYTES),
        ),
        i * ZIP_PIECE_BYTES,
      );
    return bytes;
  } finally {
    try {
      if (!ended) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
async function isZip(file: ImportFile, signal?: AbortSignal): Promise<boolean> {
  if (!file.stream) return false;
  const reader = file.stream().getReader();
  const signature: number[] = [];
  try {
    while (signature.length < 4) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value.subarray(0, 4 - signature.length)) signature.push(byte);
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
  return signature.join(",") === "80,75,3,4" || signature.join(",") === "80,75,5,6";
}
/** Tags failures raised by Pod ports so they still fail the run (the shared runner
 * then retains prior state), while one activity's mapping failure is only skipped.
 */
function portTracking(ctx: FileImportContext) {
  const failures = new WeakSet<object>();
  let primitive: { value: unknown } | undefined;
  const track =
    <A extends unknown[], R>(port: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await port(...args);
      } catch (error) {
        if (typeof error === "object" && error !== null) failures.add(error);
        else primitive = { value: error };
        throw error;
      }
    };
  return {
    ctx: {
      ...ctx,
      read: track(ctx.read),
      write: track(ctx.write),
      writeBinary: track(ctx.writeBinary),
    } satisfies FileImportContext,
    fromPort: (error: unknown) =>
      typeof error === "object" && error !== null
        ? failures.has(error)
        : primitive !== undefined && primitive.value === error,
  };
}
const safeName = (name: string) => {
  const parts = name.split("/");
  return (
    parts.length <= 16 &&
    !name.includes("\\") &&
    !Array.from(name).some((char) => char.charCodeAt(0) < 32) &&
    parts.every((p) => p.trim() && p !== "." && p !== "..")
  );
};
/** Host limits can only lower the hard caps; useful for constrained clients and fixtures. */
export function createActivityFilesAdapter(
  limits: Partial<ActivityLimits> = {},
): FileImportAdapter {
  // Reject invalid policy at construction, before any source or Pod I/O.
  new ActivityBudget(limits);
  return {
    metadata: {
      id: "activity-files",
      name: "Activity files",
      tier: "C",
      authKind: "export-file",
      scopes: [],
      categories: ["health", "mobility"],
      requirements: [],
      whatYouGet: "GPX, FIT and TCX workouts and tracks from your exported activity files.",
    },
    vocabMap,
    streaming: true,
    accept:
      ".gpx,.tcx,.fit,.zip,application/gpx+xml,application/vnd.garmin.tcx+xml,application/zip",
    fileHint:
      "Select GPX, FIT or TCX files exported from Strava, Garmin, Wahoo, Coros or Apple Health, or a ZIP containing them. Export URLs are never fetched.",
    async importFile(file, ctx) {
      file = cancellableFile(file, ctx.signal);
      const budget = new ActivityBudget(limits, ctx.signal);
      let skipped = 0;
      const ports = portTracking(ctx);
      const parse = async (bytes: Uint8Array, name: string) => {
        ctx.signal?.throwIfAborted();
        budget.beginFile();
        const hash = await digest(bytes);
        const fit = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === ".FIT";
        // Parse and validate the whole file before any writes: malformed XML suffixes/CRC failures cannot commit prefixes.
        const activities: Activity[] = [];
        try {
          if (fit) activities.push(...fitActivities(bytes, budget));
          else
            for await (const activity of xmlActivities(decoded(bytes), budget))
              activities.push(activity);
        } catch {
          ctx.signal?.throwIfAborted();
          // Parsing errors are inert, fixed diagnostics; never expose source XML or decoder exception text.
          skipped++;
          budget.warn("invalid-activity-file");
          return;
        }
        if (!activities.length) {
          skipped++;
          budget.warn("no-activities-in-file");
          return;
        }
        const format = activities[0]?.format ?? (fit ? "fit" : "xml");
        const origin = await originIri(name, hash);
        // Stored at most once per file, and only when an activity links it.
        let stored: Promise<string | undefined> | undefined;
        const source = {
          hash,
          filename: name,
          format,
          origin,
          original: () => {
            stored ??= writeOriginal(bytes, hash, format, ports.ctx, budget);
            return stored;
          },
        };
        for (const activity of activities) {
          if (activity.invalid) {
            ctx.skip();
            continue;
          }
          try {
            await saveActivity(activity, source, ports.ctx, budget);
          } catch (error) {
            // Cancellation and Pod I/O failures fail the run; one bad activity never does.
            if (ctx.signal?.aborted || ports.fromPort(error)) throw error;
            ctx.skip();
            budget.warn("activity-import-failed");
          }
        }
      };
      ctx.progress({ label: "Reading activity files…", done: 0 });
      if (await isZip(file, ctx.signal)) {
        if (file.size > budget.limits.totalBytes) {
          return { skipped: 1, warnings: ["archive-byte-cap-exceeded"] };
        }
        const entries = await zipDirectory(file);
        try {
          await readZip(
            file,
            {
              inflationBudget: new InflationBudget(budget.limits.totalBytes),
              limit: () => budget.limits.fileBytes,
              skip: (_name, reason) => {
                skipped++;
                budget.warn(
                  reason === "entry-inflated-cap-exceeded"
                    ? "file-byte-cap-exceeded"
                    : "archive-entry-skipped",
                );
              },
              entry: (name) =>
                cappedSink(budget.limits.fileBytes, async (bytes) => {
                  ctx.signal?.throwIfAborted();
                  if (name.endsWith("/")) return;
                  if (!safeName(name)) {
                    skipped++;
                    budget.warn("unsafe-archive-path");
                    return;
                  }
                  if (!bytes) {
                    skipped++;
                    budget.warn("file-byte-cap-exceeded");
                    return;
                  }
                  if (
                    budget.activities >= budget.limits.activities ||
                    budget.messages >= budget.limits.messages ||
                    budget.points >= budget.limits.points
                  ) {
                    skipped++;
                    budget.warn("archive-work-cap-exceeded");
                    return;
                  }
                  await parse(bytes, name);
                }),
            },
            entries,
          );
        } catch (error) {
          if (!(error instanceof TotalInflatedLimit)) throw error;
          skipped++;
          budget.warn("archive-byte-cap-exceeded");
        }
      } else {
        try {
          await parse(await readFile(file, budget), file.name);
        } catch (error) {
          if (!(error instanceof FileCap)) throw error;
          skipped++;
          budget.warn("file-byte-cap-exceeded");
        }
      }
      ctx.progress({ label: "Activity import complete", done: 1, total: 1 });
      return { skipped, warnings: [...budget.warnings] };
    },
  };
}
export const activityFilesAdapter = createActivityFilesAdapter();
