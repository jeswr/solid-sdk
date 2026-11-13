// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { type ContainerMember, readContainerMembers } from "@jeswr/ldp-container";
import {
  auxiliaries,
  cancel,
  context,
  ExportLimitError,
  exportError,
  HttpError,
  kindFor,
  sizeOf,
} from "./scope.js";
import type {
  ExportKind,
  ExportOptions,
  ExportPlan,
  ExportResource,
  InventoryOptions,
} from "./types.js";

/** Breadth-first inventory shared by Takeout and permission-translating migration. */
export async function inventoryPod(options: InventoryOptions): Promise<ExportPlan> {
  const ctx = context(options);
  const queue: ExportResource[] = [];
  const resources: ExportResource[] = [];
  const seen = new Map<string, ExportResource>();
  const processed = new Set<string>();
  const advertised = new Set<string>();
  const enqueue = (raw: string, hint?: ExportKind, source?: string) => {
    let url: string;
    try {
      url = ctx.canonical(raw);
    } catch (error) {
      if (options.directChildren) throw error;
      return;
    }
    const auxiliary = hint === "acl" || hint === "meta";
    if (!(auxiliary ? ctx.selected(url, true) : ctx.visit(url))) return;
    const existing = seen.get(url);
    if (existing) {
      if (auxiliary && existing.kind !== "container" && !processed.has(url)) existing.kind = hint;
      if (source && (existing.kind !== "container" || existing.auxiliaryFor !== undefined))
        existing.auxiliaryFor = [...new Set([...(existing.auxiliaryFor ?? []), source])];
      if (!source && existing.kind === "container") delete existing.auxiliaryFor;
      return;
    }
    const resource: ExportResource = { url, kind: kindFor(url, "", hint), contentType: "" };
    if (source) resource.auxiliaryFor = [source];
    seen.set(url, resource);
    queue.push(resource);
  };
  const inspect = (response: Response, url: string, isAuxiliary: boolean) => {
    if (!options.skipAuxiliaries && !ctx.selected(url) && !isAuxiliary) return;
    for (const link of auxiliaries(response, url, !options.skipAuxiliaries)) {
      if (options.skipAuxiliaries) advertised.add(link.url);
      else enqueue(link.url, link.kind, url);
    }
  };
  enqueue(ctx.root);
  for (let index = 0; index < queue.length; index++) {
    const resource = queue[index] as ExportResource;
    const auxiliary = resource.auxiliaryFor !== undefined;
    options.signal?.throwIfAborted();
    try {
      const head = await ctx.fetch(resource.url, { method: "HEAD" });
      cancel(head);
      if (auxiliary && (head.status === 404 || head.status === 410)) continue;
      // Count only after probing existence: absent advertised auxiliaries consume no slots.
      ctx.checkDepth(resource.url);
      if (resources.length >= Math.min(ctx.maxEntries, 65_533))
        throw new ExportLimitError(
          `Export exceeds maxEntries (${ctx.maxEntries}) or the ZIP entry limit (65533)`,
        );
      resources.push(resource);
      processed.add(resource.url);
      if (!head.ok && (head.status !== 405 || options.failFast)) throw new HttpError(head.status);
      options.onHead?.(head, resource.url);
      resource.contentType = head.ok ? (head.headers.get("content-type") ?? "") : "";
      resource.kind = kindFor(resource.url, resource.contentType, resource.kind);
      const size = head.ok ? sizeOf(head, options.numericContentLength) : undefined;
      if (size !== undefined) resource.size = size;
      inspect(head, resource.url, auxiliary);
      if (resource.kind === "container") {
        let members: Iterable<string>;
        if (options.readMembers) members = await options.readMembers(resource.url);
        else {
          const listingFetch: typeof globalThis.fetch = async (input, init) => {
            const response = await ctx.fetch(input, init);
            if (!response.ok) {
              cancel(response);
              throw new HttpError(response.status);
            }
            try {
              inspect(response, resource.url, auxiliary);
            } catch (error) {
              cancel(response);
              throw error;
            }
            return response;
          };
          const listing = (await readContainerMembers(listingFetch, resource.url, {
            scope: ctx.root,
            signal: options.signal,
            package: "pod-export",
          })) as ContainerMember[];
          members = listing.map((member) => member.url);
        }
        for (const raw of members) {
          if (options.directChildren) {
            const child = assertWithinPodScope(ctx.root, raw);
            const parent = new URL(child.endsWith("/") ? ".." : ".", child).href;
            if (parent !== resource.url)
              throw new TypeError("Container lists a non-child resource");
          }
          if (
            options.skipAuxiliaries &&
            (/\.(acl|acr|meta)\/?$/i.test(decodeURIComponent(new URL(raw).pathname)) ||
              advertised.has(raw))
          )
            options.onSkipAuxiliary?.(raw, false);
          else enqueue(raw);
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (options.failFast || error instanceof ExportLimitError) throw error;
      if (!processed.has(resource.url)) {
        ctx.checkDepth(resource.url);
        if (resources.length >= Math.min(ctx.maxEntries, 65_533))
          throw new ExportLimitError(
            `Export exceeds maxEntries (${ctx.maxEntries}) or the ZIP entry limit (65533)`,
          );
        resources.push(resource);
        processed.add(resource.url);
      }
      resource.error = exportError(error);
    }
    options.onProgress?.({ done: index + 1, total: queue.length, current: resource.url });
  }
  const kept = options.skipAuxiliaries
    ? resources.filter((resource) => {
        const skip = [...advertised].some(
          (url) => resource.url === url || (url.endsWith("/") && resource.url.startsWith(url)),
        );
        if (skip) options.onSkipAuxiliary?.(resource.url, true);
        return !skip;
      })
    : resources;
  return {
    root: ctx.root,
    resources: kept,
    estimatedBytes: kept.reduce(
      (sum, item) => sum + (item.error || item.kind === "container" ? 0 : (item.size ?? 0)),
      0,
    ),
    unknownSizes: kept.filter(
      (item) => !item.error && item.kind !== "container" && item.size === undefined,
    ).length,
  };
}

export function planExport(options: ExportOptions): Promise<ExportPlan> {
  return inventoryPod(options);
}
