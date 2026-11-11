// AUTHORED-BY Codex GPT-6.1-Sol
import { type ContainerMember, readContainerMembers } from "@jeswr/ldp-container";
import { auxiliaries, cancel, context, exportError, HttpError, kindFor, sizeOf } from "./scope.js";
import type { ExportKind, ExportOptions, ExportPlan, ExportResource } from "./types.js";

/** Breadth-first, bounded inventory. No content body is retained in the plan. */
export async function planExport(options: ExportOptions): Promise<ExportPlan> {
  const ctx = context(options);
  const queue: ExportResource[] = [];
  const seen = new Map<string, ExportResource>();
  const enqueue = (raw: string, hint?: ExportKind, source?: string) => {
    let url: string;
    try {
      url = ctx.canonical(raw);
    } catch {
      return;
    }
    const auxiliary = hint === "acl" || hint === "meta";
    if (!(auxiliary ? ctx.selected(url, true) : ctx.visit(url))) return;
    const existing = seen.get(url);
    if (existing) {
      if (auxiliary) existing.kind = hint;
      if (source) existing.auxiliaryFor = [...new Set([...(existing.auxiliaryFor ?? []), source])];
      return;
    }
    ctx.checkDepth(url);
    if (seen.size >= ctx.maxEntries) throw new RangeError("Export exceeds maxEntries");
    const resource: ExportResource = { url, kind: kindFor(url, "", hint), contentType: "" };
    if (source) resource.auxiliaryFor = [source];
    seen.set(url, resource);
    queue.push(resource);
  };
  enqueue(ctx.root);
  const inspect = (response: Response, url: string) => {
    for (const link of auxiliaries(response, url)) enqueue(link.url, link.kind, url);
  };
  for (let index = 0; index < queue.length; index++) {
    const resource = queue[index] as ExportResource;
    options.signal?.throwIfAborted();
    try {
      const head = await ctx.fetch(resource.url, { method: "HEAD" });
      cancel(head);
      if (!head.ok && head.status !== 405) throw new HttpError(head.status);
      resource.contentType = head.ok ? (head.headers.get("content-type") ?? "") : "";
      resource.kind = kindFor(resource.url, resource.contentType, resource.kind);
      const size = head.ok ? sizeOf(head) : undefined;
      if (size !== undefined) resource.size = size;
      inspect(head, resource.url);
      if (resource.kind === "container") {
        const listingFetch: typeof globalThis.fetch = async (input, init) => {
          const response = await ctx.fetch(input, init);
          if (!response.ok) {
            cancel(response);
            throw new HttpError(response.status);
          }
          try {
            inspect(response, resource.url);
          } catch (error) {
            cancel(response);
            throw error;
          }
          return response;
        };
        // listingFetch rejects every non-OK status, so the helper cannot return null.
        const members = (await readContainerMembers(listingFetch, resource.url, {
          scope: ctx.root,
          signal: options.signal,
          package: "pod-export",
        })) as ContainerMember[];
        for (const member of members) enqueue(member.url);
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof RangeError) throw error;
      resource.error = exportError(error);
    }
  }
  return {
    root: ctx.root,
    resources: queue,
    estimatedBytes: queue.reduce(
      (sum, item) => sum + (item.error || item.kind === "container" ? 0 : (item.size ?? 0)),
      0,
    ),
    unknownSizes: queue.filter(
      (item) => !item.error && item.kind !== "container" && item.size === undefined,
    ).length,
  };
}
