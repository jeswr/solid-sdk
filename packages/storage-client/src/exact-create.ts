// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { CreateOptions } from "./types.js";

/** Preserve an existing Solid path's spelling while retaining exact child containment. */
export function exactCreateSegment(parent: string, opts: CreateOptions): string | undefined {
  if (opts.exactUrl === undefined) return undefined;
  if (opts.name !== undefined) throw new TypeError("exactUrl and name are mutually exclusive");
  const target = assertWithinPodScope(parent, opts.exactUrl, { allowRoot: false });
  const url = new URL(target);
  const container = opts.kind === "container";
  if (
    target !== opts.exactUrl ||
    target.includes("?") ||
    target.includes("#") ||
    url.pathname.endsWith("/") !== container ||
    new URL(container ? "../" : ".", target).href !== parent
  )
    throw new TypeError("exactUrl must name one canonical direct child");
  const segment = target.slice(parent.length, container ? -1 : undefined);
  return segment;
}
