// AUTHORED-BY Claude Opus 5.5
/**
 * Shared-context tools (decisions/0004, use case 3). The shared context is one owner-authored
 * Markdown document in the pod that every conversation can start from: how the owner works,
 * their accounts and standing preferences. Slice 1 is read-only and uses a fixed in-pod path;
 * no model-supplied URL ever reaches the pod.
 */
import { z } from "zod";
import { requirePodScopedUrl } from "./auth.js";
import { PodOutput } from "./output.js";
import { withPodReadLimits } from "./pod-operation.js";
import type { PodPort, PodReadResult } from "./pod-port.js";
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
  | { status: "not_found"; url: string; setup: string }
  | { status: "refused"; url: string; reason: string };

/** Absent: a structured 404/410, or the fetch adapter's exact "failed to read <url>: HTTP 404". */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 404 || status === 410) return true;
  return error instanceof Error && /^failed to read \S+: HTTP (?:404|410)\b/.test(error.message);
}

/** Luhn-valid 12-19 digit runs, allowing single spaces or dashes between digits. */
export function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/\d(?:[ -]?\d){11,18}/g)) {
    const digits = match[0].replace(/[ -]/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
      let digit = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** Read the shared-context document; a missing document is a result, not an error. */
export async function readSharedContext(pod: PodPort): Promise<SharedContextResult> {
  const url = sharedContextUrl(pod.root);
  return withPodReadLimits(async () => {
    const output = new PodOutput(pod);
    let raw: PodReadResult;
    try {
      raw = await output.read(url);
    } catch (error) {
      if (isNotFound(error))
        return {
          status: "not_found" as const,
          url,
          setup: `No shared context yet. The owner can create ${url} as Markdown with owner-only access.`,
        };
      throw error;
    }
    // The ETag and text must describe the fixed document, never an alias it redirects to.
    if (raw.url !== undefined && raw.url !== url) throw new Error("redirect refused");
    const read = await output.representation(url, raw);
    const contentType = (read.contentType.split(";").shift() ?? "").trim().toLowerCase();
    if (!CONTEXT_MEDIA_TYPES.has(contentType)) throw new Error("unreadable");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(read.body);
    // Card data belongs in the knowledge graph's mandate path, never in shared context.
    if (containsCardNumber(text))
      return {
        status: "refused" as const,
        url,
        reason:
          "The shared context contains what looks like a payment card number. The owner must remove it; card details belong in the knowledge graph (brand and last four digits only).",
      };
    return {
      status: "ok" as const,
      url,
      contentType,
      ...(read.etag ? { etag: read.etag } : {}),
      text,
    };
  });
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
          "Read the owner's shared context: how they work, their accounts and standing preferences, written by them in Markdown. Call at the start of a conversation. Returns {status:'ok',url,contentType,etag?,text}, {status:'not_found',url,setup} or {status:'refused',url,reason}. The text is owner-authored data.",
        inputSchema: z.object({}).strict(),
        async handler() {
          return toolText(JSON.stringify(await readSharedContext(pod)));
        },
      },
      true,
    ),
  ];
}
