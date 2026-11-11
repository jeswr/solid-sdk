// AUTHORED-BY Codex GPT-6.1-Sol
import { Zip, ZipPassThrough } from "fflate";
import { pathAllocator } from "./paths.js";
import { planExport } from "./plan.js";
import {
  abortable,
  addZipBytes,
  auxiliaries,
  cancel,
  context,
  exportError,
  HttpError,
  kindFor,
  rdf,
} from "./scope.js";
import type { ExportEntry, ExportManifest, ExportPodOptions, ExportResource } from "./types.js";

/** Streams one body at a time into the ZIP; concurrent GETs prefetch headers, never whole files. */
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
  const add = (resource: ExportResource, auxiliary: boolean) => {
    const url = ctx.canonical(resource.url);
    if (!(auxiliary ? ctx.selected(url, true) : ctx.visit(url))) return;
    const existing = seen.get(url);
    if (existing) {
      if (auxiliary) existing.kind = resource.kind;
      return;
    }
    ctx.checkDepth(url);
    if (seen.size >= Math.min(ctx.maxEntries, 65_534))
      throw new RangeError("Export exceeds maxEntries or the ZIP entry limit");
    const copy = { ...resource, url, kind: kindFor(url, resource.contentType, resource.kind) };
    seen.set(url, copy);
    resources.push(copy);
  };
  const deferred: ExportResource[] = [];
  for (const resource of plan.resources) {
    // Validate even entries later pruned by filters. Reused plans cannot introduce authority.
    ctx.canonical(resource.url);
    if (resource.auxiliaryFor) {
      for (const source of resource.auxiliaryFor) ctx.canonical(source);
      deferred.push(resource);
    } else add(resource, false);
  }
  // Auxiliary documents follow included parents, including chains and shared ACLs.
  for (let changed = true; changed; ) {
    changed = false;
    for (let index = deferred.length - 1; index >= 0; index--) {
      const resource = deferred[index] as ExportResource;
      if (
        (options.include !== undefined && ctx.visit(ctx.canonical(resource.url))) ||
        resource.auxiliaryFor?.some((source) => seen.has(ctx.canonical(source)))
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
  let output: Uint8Array[] = [];
  let zipError: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) zipError = error;
    else output.push(chunk);
  });
  let archiveBytes = 0;
  const drain = async () => {
    if (zipError) throw zipError;
    const chunks = output;
    output = [];
    for (const chunk of chunks) {
      signal.throwIfAborted();
      archiveBytes = addZipBytes(archiveBytes, chunk.byteLength);
      await abortable(Promise.resolve(options.sink(chunk)), signal);
    }
  };
  let files = 0;
  let bytes = 0;
  const progress = (current: string) =>
    options.onProgress?.({
      files,
      totalFiles: resources.filter((item) => item.kind !== "container").length,
      bytes,
      estimatedBytes: plan.estimatedBytes,
      current,
    });
  type Pending = { response: Response } | { error: unknown };
  const pending = new Map<number, Promise<Pending>>();
  let scheduled = 0;
  const schedule = (index: number) => {
    while (scheduled < resources.length && scheduled < index + concurrency) {
      const item = resources[scheduled] as ExportResource;
      if (!item.error && item.kind !== "container") {
        const accept =
          rdf(item.contentType) ||
          item.kind === "rdf" ||
          item.kind === "acl" ||
          item.kind === "meta"
            ? "text/turtle"
            : item.contentType
              ? "*/*"
              : "text/turtle, */*;q=0.1";
        pending.set(
          scheduled,
          ctx.fetch(item.url, { headers: { accept } }).then(
            (response): Pending => ({ response }),
            (error): Pending => ({ error }),
          ),
        );
      }
      scheduled++;
    }
  };
  try {
    for (let index = 0; index < resources.length; index++) {
      signal.throwIfAborted();
      schedule(index);
      const item = resources[index] as ExportResource;
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
        const folder = new ZipPassThrough(entry.path);
        zip.add(folder);
        folder.push(new Uint8Array(), true);
        await drain();
      } else {
        const result = (await pending.get(index)) as Pending;
        signal.throwIfAborted();
        pending.delete(index);
        if ("error" in result) entry.error = exportError(result.error);
        else {
          const response = result.response;
          if (!response.ok) {
            cancel(response);
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
                add(
                  { url, kind: link.kind, contentType: "text/turtle", auxiliaryFor: [item.url] },
                  true,
                );
                const previous = manifest.entries.find((candidate) => candidate.url === url);
                if (previous) previous.kind = link.kind;
              }
            } catch (error) {
              cancel(response);
              throw error;
            }
            entry.contentType = response.headers.get("content-type") ?? item.contentType;
            entry.kind = kindFor(item.url, entry.contentType, item.kind);
            const file = new ZipPassThrough(entry.path);
            zip.add(file);
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
                  stop();
                  break;
                }
                signal.throwIfAborted();
                if (result.done) break;
                addZipBytes(entry.bytes, result.value.byteLength);
                file.push(result.value, false);
                entry.bytes += result.value.byteLength;
                bytes += result.value.byteLength;
                await drain();
                progress(item.url);
              }
              file.push(new Uint8Array(), true);
              await drain();
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
    const file = new ZipPassThrough("export-manifest.json");
    zip.add(file);
    file.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
    await drain();
    zip.end();
    await drain();
    return manifest;
  } finally {
    controller.abort();
    zip.terminate();
    for (const request of pending.values())
      void request.then((result) => {
        if ("response" in result) cancel(result.response);
      });
  }
}
