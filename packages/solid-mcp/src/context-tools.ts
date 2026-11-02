// AUTHORED-BY Claude Opus 5.5
/**
 * Shared-context tools (decisions/0004, use case 3). The shared context is one owner-authored
 * Markdown document in the pod that every conversation can start from: how the owner works,
 * their accounts and standing preferences. Slice 1 is read-only and uses a fixed in-pod path;
 * no model-supplied URL ever reaches the pod.
 */
import { z } from "zod";
import { requirePodScopedUrl } from "./auth.js";
import { readResource } from "./pod.js";
import type { PodPort } from "./pod-port.js";
import { defineTool, type PodTool, toolText } from "./tools.js";

/** Conventional location of the shared-context document, relative to the pod root. */
export const SHARED_CONTEXT_PATH = "agent/context/shared-context.md";

/** Media types accepted as the shared-context document. */
const CONTEXT_MEDIA_TYPES = new Set(["text/markdown", "text/plain"]);

/** Absolute URL of the shared-context document under `root`. */
export function sharedContextUrl(root: string): string {
  return requirePodScopedUrl({ podRoot: root }, new URL(SHARED_CONTEXT_PATH, root).href);
}

/** The result of reading the shared-context document. */
export type SharedContextResult =
  | { status: "ok"; url: string; contentType: string; etag?: string; text: string }
  | { status: "not_found"; url: string; setup: string };

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { status?: unknown }).status === 404) return true;
  return error instanceof Error && /\bHTTP 404\b/.test(error.message);
}

/** Read the shared-context document; a missing document is a result, not an error. */
export async function readSharedContext(pod: PodPort): Promise<SharedContextResult> {
  const url = sharedContextUrl(pod.root);
  let read: Awaited<ReturnType<typeof readResource>>;
  try {
    read = await readResource(pod, url);
  } catch (error) {
    if (isNotFound(error))
      return {
        status: "not_found",
        url,
        setup: `No shared context yet. The owner can create ${url} as Markdown with owner-only access.`,
      };
    throw error;
  }
  const contentType = read.contentType ?? "";
  if (!CONTEXT_MEDIA_TYPES.has(contentType) || read.text === undefined)
    throw new Error("unreadable");
  return {
    status: "ok",
    url,
    contentType,
    ...(read.etag ? { etag: read.etag } : {}),
    text: read.text,
  };
}

/** Build the shared-context tools. All are read-only in slice 1. */
export function createContextToolRegistry(pod: PodPort): readonly PodTool[] {
  return [
    defineTool(
      {
        name: "context_read",
        aliases: [],
        title: "Read the owner's shared context",
        readOnly: true,
        description:
          "Read the owner's shared context: how they work, their accounts and standing preferences, written by them in Markdown. Call at the start of a conversation. Returns {status:'ok',url,contentType,etag?,text} or {status:'not_found',url,setup}.",
        inputSchema: z.object({}).strict(),
        async handler() {
          return toolText(JSON.stringify(await readSharedContext(pod)));
        },
      },
      true,
    ),
  ];
}
