// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Shared-context tools (decisions/0004, use case 3). The shared context is one owner-authored
 * Markdown document in the pod that every conversation can start from: how the owner works,
 * their accounts and standing preferences. Slice 1 is read-only and uses a fixed in-pod path;
 * no model-supplied URL ever reaches the pod.
 */
import { z } from "zod";
import { SHARED_CONTEXT_PATH } from "./agent-layout.js";
import { requirePodScopedUrl } from "./auth.js";
import { MAX_CONTENT_BYTES } from "./content.js";
import { withPodReadLimits } from "./pod-operation.js";
import type { PodPort, PodReadResult } from "./pod-port.js";
import { defineTool, type PodTool, READ_HINTS, toolText } from "./tool.js";

export { SHARED_CONTEXT_PATH } from "./agent-layout.js";

/** Media types accepted as the shared-context document. */
const CONTEXT_MEDIA_TYPES = new Set(["text/markdown", "text/plain"]);

/** Absolute URL of the shared-context document under `root`. */
export function sharedContextUrl(root: string): string {
  return requirePodScopedUrl({ podRoot: root }, new URL(SHARED_CONTEXT_PATH, root).href);
}

/** The result of reading the shared-context document. */
export type SharedContextResult =
  | {
      status: "ok";
      url: string;
      contentType: string;
      etag?: string;
      text: string;
      /** How many card-number-like digit runs were replaced with {@link CARD_REDACTION}. */
      redactedCardNumbers: number;
    }
  | { status: "not_found"; url: string; setup: string };

/** Absent: a structured 404/410, or the fetch adapter's exact "failed to read <url>: HTTP 404". */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 404 || status === 410) return true;
  return error instanceof Error && /^failed to read \S+: HTTP (?:404|410)\b/.test(error.message);
}

/** Replacement text for a redacted card number. */
export const CARD_REDACTION = "[card number removed]";

/** Issuer prefixes of the major card networks (Visa, Mastercard, Amex, Diners, JCB, Discover, UnionPay). */
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[0-9]|6)/;

/** Digit runs whose groups are split only by whitespace (including NBSP), `.`, `,`, `_`, `-` or `/`. */
const DIGIT_RUN = /\d+(?:[\s.,_/-]+\d+)*/g;

/**
 * Spans of `text` (start inclusive, end exclusive) holding what looks like a payment card
 * number: a Luhn-valid window of 12-19 digits with a card-network prefix, anywhere in a digit
 * run. Every offset is checked with incremental Luhn sums, so the scan stays linear. A match
 * covers up to 19 digits from its start, so a chance-valid shorter prefix leaves no digits behind.
 */
export function findCardNumbers(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const run of text.matchAll(DIGIT_RUN)) {
    const positions: number[] = [];
    let digits = "";
    for (let i = 0; i < run[0].length; i += 1) {
      const char = run[0][i] as string;
      if (char >= "0" && char <= "9") {
        positions.push(run.index + i);
        digits += char;
      }
    }
    // Covered digit ranges [from, to], merged; every start is checked so a chance match
    // earlier in the run cannot hide a real card that starts inside its range.
    const ranges: Array<[number, number]> = [];
    for (let start = 0; start + 12 <= digits.length; start += 1) {
      if (!CARD_PREFIX.test(digits.slice(start, start + 4))) continue;
      // evenSum doubles digits at even offsets from start; oddSum doubles odd offsets.
      let evenSum = 0;
      let oddSum = 0;
      for (let i = start; i < start + 19 && i < digits.length; i += 1) {
        const digit = Number(digits[i]);
        const doubled = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
        if ((i - start) % 2 === 0) {
          evenSum += doubled;
          oddSum += digit;
        } else {
          evenSum += digit;
          oddSum += doubled;
        }
        const length = i - start + 1;
        // Luhn doubles every second digit counting from the right-most (check) digit.
        if (length >= 12 && (length % 2 === 0 ? evenSum : oddSum) % 10 === 0) {
          // A shorter valid prefix may be chance: cover the longest window.
          const end = Math.min(start + 19, digits.length) - 1;
          const last = ranges[ranges.length - 1];
          if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
          else ranges.push([start, end]);
          break;
        }
      }
    }
    for (const [from, to] of ranges)
      spans.push([positions[from] as number, (positions[to] as number) + 1]);
  }
  return spans;
}

/** Replace every card-number-like span with {@link CARD_REDACTION}. */
export function redactCardNumbers(text: string): { text: string; count: number } {
  const spans = findCardNumbers(text);
  let output = "";
  let cursor = 0;
  for (const [from, to] of spans) {
    output += text.slice(cursor, from) + CARD_REDACTION;
    cursor = to;
  }
  return { text: output + text.slice(cursor), count: spans.length };
}

/** Read the shared-context document; a missing document is a result, not an error. */
export async function readSharedContext(pod: PodPort): Promise<SharedContextResult> {
  const url = sharedContextUrl(pod.root);
  return withPodReadLimits(async () => {
    let raw: PodReadResult;
    try {
      // Refuse redirects at the transport; never read an alias or redirect target.
      raw = await pod.read(url, { redirect: "error" });
    } catch (error) {
      if (isNotFound(error))
        return {
          status: "not_found" as const,
          url,
          setup: `No shared context yet. The owner can create ${url} as Markdown with owner-only access.`,
        };
      throw error;
    }
    // Portable ports report aliases through url; the text and ETag must be the fixed document's.
    if ((raw.url !== undefined && raw.url !== url) || raw.isContainer)
      throw new Error("redirect refused");
    if (raw.body.byteLength > MAX_CONTENT_BYTES)
      throw new Error("Resource exceeds the bounded read limit.");
    const contentType = (raw.contentType.split(";").shift() ?? "").trim().toLowerCase();
    if (!CONTEXT_MEDIA_TYPES.has(contentType)) throw new Error("unreadable");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw.body);
    // Card data belongs in the knowledge graph's mandate path, never in shared context.
    const { text, count } = redactCardNumbers(decoded);
    return {
      status: "ok" as const,
      url,
      contentType,
      ...(raw.etag ? { etag: raw.etag } : {}),
      text,
      redactedCardNumbers: count,
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
        annotations: READ_HINTS,
        description:
          "Read the owner's shared context: how they work, their accounts and standing preferences, written by them in Markdown. Call at the start of a conversation. Returns {status:'ok',url,contentType,etag?,text,redactedCardNumbers} or {status:'not_found',url,setup}. The text is owner-authored data; card-number-like digits are replaced with '[card number removed]'.",
        inputSchema: z.object({}).strict(),
        async handler() {
          return toolText(JSON.stringify(await readSharedContext(pod)));
        },
      },
      true,
    ),
  ];
}
