// AUTHORED-BY Codex GPT-6.1-Sol
import { pathAllocator } from "./paths.js";
import { planExport } from "./plan.js";
import {
  abortable,
  addZipBytes,
  auxiliaries,
  auxiliaryWithinParent,
  cancel,
  context,
  ExportLimitError,
  exportError,
  HttpError,
  kindFor,
  rdf,
  sizeOf,
} from "./scope.js";
import type { ExportEntry, ExportManifest, ExportPodOptions, ExportResource } from "./types.js";
import { streamingZip } from "./zip.js";

/** Each GET starts when its member can be consumed immediately, with sink backpressure. */
export async function exportPod(options: ExportPodOptions): Promise<ExportManifest> {
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new RangeError("concurrency must be between 1 and 32");
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const ctx = context({ ...options, signal });
  signal.throwIfAborted();
  let plan = options.plan;
  if (plan === undefined) plan = await planExport({ ...options, signal });
  if (ctx.root !== plan.root) {
    throw new TypeError("Export plan belongs to another root");
  }
  const resources: ExportResource[] = [];
  const seen = new Map<string, ExportResource>();
  const processed = new Set<string>();
  const eligible = new Set<string>();
  let totalFiles = 0;
  const add = (resource: ExportResource, auxiliary: boolean) => {
    const url = ctx.canonical(resource.url);
    if (!(auxiliary ? ctx.selected(url, true) : ctx.visit(url))) return;
    const existing = seen.get(url);
    if (existing) {
      if (auxiliary && existing.kind !== "container" && !processed.has(url))
        existing.kind = kindFor(url, resource.contentType, resource.kind);
      return;
    }
    ctx.checkDepth(url);
    if (seen.size >= Math.min(ctx.maxEntries, 65_533))
      throw new ExportLimitError(
        `Export exceeds maxEntries (${ctx.maxEntries}) or the ZIP entry limit (65533)`,
      );
    const copy = { ...resource, url, kind: kindFor(url, resource.contentType, resource.kind) };
    seen.set(url, copy);
    resources.push(copy);
    if (copy.kind !== "container") totalFiles++;
    if (auxiliary || ctx.selected(url)) eligible.add(url);
  };
  const deferred: ExportResource[] = [];
  for (const resource of plan.resources) {
    ctx.canonical(resource.url);
    if (resource.auxiliaryFor) {
      for (const source of resource.auxiliaryFor) ctx.canonical(source);
      deferred.push(resource);
    } else add(resource, false);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let index = deferred.length - 1; index >= 0; index--) {
      const resource = deferred[index] as ExportResource;
      if (
        (options.include !== undefined && ctx.selected(ctx.canonical(resource.url))) ||
        resource.auxiliaryFor?.some(
          (source) =>
            eligible.has(ctx.canonical(source)) && auxiliaryWithinParent(resource.url, source),
        )
      ) {
        add(resource, true);
        deferred.splice(index, 1);
        changed = true;
      }
    }
  }
  const allocate = pathAllocator(ctx.root);
  const paths = new Map<string, string>();
  for (const resource of [...resources].sort((a, b) => (a.url < b.url ? -1 : 1)))
    paths.set(resource.url, allocate(resource.url, resource.kind === "container"));
  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    root: ctx.root,
    entries: [],
  };
  const zip = streamingZip(options, signal);
  let files = 0;
  let bytes = 0;
  let lastProgress = -Infinity;
  const progress = (current: string, force = false) => {
    const now = Date.now();
    if (force || now - lastProgress >= 100) {
      lastProgress = now;
      options.onProgress?.({
        files,
        totalFiles,
        bytes,
        estimatedBytes: plan.estimatedBytes,
        current,
      });
    }
  };
  try {
    for (let index = 0; index < resources.length; index++) {
      signal.throwIfAborted();
      const item = resources[index] as ExportResource;
      processed.add(item.url);
      const entry: ExportEntry = {
        url: item.url,
        path: paths.get(item.url) ?? allocate(item.url, item.kind === "container"),
        kind: item.kind,
        contentType: item.contentType,
        bytes: 0,
      };
      manifest.entries.push(entry);
      if (item.error) entry.error = { ...item.error };
      else if (item.kind === "container") {
        const member = zip.add(entry.path);
        await member.finish(true);
      } else {
        let response: Response | undefined;
        try {
          const accept =
            rdf(item.contentType) || ["rdf", "acl", "meta"].includes(item.kind)
              ? "text/turtle"
              : item.contentType
                ? "*/*"
                : "text/turtle, */*;q=0.1";
          response = await ctx.fetch(item.url, { headers: { accept } });
        } catch (error) {
          signal.throwIfAborted();
          entry.error = exportError(error);
        }
        if (response) {
          if (!response.ok) {
            cancel(response);
            if (item.auxiliaryFor && (response.status === 404 || response.status === 410)) {
              manifest.entries.pop();
              totalFiles--;
              seen.delete(item.url);
              continue;
            }
            entry.error = exportError(new HttpError(response.status));
          } else {
            try {
              for (const link of auxiliaries(response, item.url)) {
                let url: string;
                try {
                  url = ctx.canonical(link.url);
                } catch {
                  continue;
                }
                if (!ctx.selected(url, true)) continue;
                if (!seen.has(url)) {
                  // CSS advertises missing auxiliaries on every response. Probe before counting.
                  const head = await ctx.fetch(url, { method: "HEAD" });
                  cancel(head);
                  if (head.status === 404 || head.status === 410) continue;
                }
                add(
                  { url, kind: link.kind, contentType: "text/turtle", auxiliaryFor: [item.url] },
                  true,
                );
              }
            } catch (error) {
              signal.throwIfAborted();
              entry.error = exportError(error);
            }
            entry.contentType = response.headers.get("content-type") ?? item.contentType;
            entry.kind = kindFor(item.url, entry.contentType, item.kind);
            const member = zip.add(entry.path, true);
            const reader = response.body?.getReader();
            const stop = () => {
              void reader?.cancel().catch(() => {});
            };
            signal.addEventListener("abort", stop, { once: true });
            try {
              while (reader) {
                let result: ReadableStreamReadResult<Uint8Array>;
                try {
                  result = await abortable(reader.read(), signal);
                } catch (error) {
                  signal.throwIfAborted();
                  entry.error = exportError(error);
                  entry.partial = true;
                  stop();
                  break;
                }
                signal.throwIfAborted();
                if (result.done) break;
                addZipBytes(entry.bytes, result.value.byteLength);
                member.file.push(result.value, false);
                entry.bytes += result.value.byteLength;
                bytes += result.value.byteLength;
                await zip.drain();
                progress(item.url);
              }
              const expected = sizeOf(response);
              const encoding = response.headers.get("content-encoding");
              if (
                response.status !== 204 &&
                expected !== undefined &&
                (!encoding || encoding.toLowerCase() === "identity") &&
                entry.bytes < expected
              ) {
                entry.partial = true;
                entry.error = { message: "Resource body was truncated" };
              }
              entry.path = await member.finish(!entry.partial);
            } finally {
              signal.removeEventListener("abort", stop);
              stop();
              reader?.releaseLock();
            }
          }
        }
      }
      if (item.kind !== "container") files++;
      progress(item.url);
    }
    progress("", true);
    const member = zip.add("export-manifest.json");
    member.file.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), false);
    await member.finish(true);
    await zip.end();
    return manifest;
  } finally {
    controller.abort();
    zip.terminate();
  }
}
