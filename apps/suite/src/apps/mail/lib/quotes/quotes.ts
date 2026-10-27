// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { QuoteError, validateBody } from "./validation";

export type QuoteSegmentKind = "body" | "quote" | "attribution" | "signature" | "forwarded";

export interface QuoteSegment {
  kind: QuoteSegmentKind;
  text: string;
  /** Number of leading, optionally space-separated `>` markers; zero otherwise. */
  depth: number;
}

export interface QuoteOptions {
  flowed?: boolean;
  delSp?: boolean;
}

export interface QuotedText {
  segments: QuoteSegment[];
  /** Exact concatenation of body segments; no trimming or inserted separators. */
  visibleText: string;
  /** True for explicit quotes or forwarded history, never for a signature alone. */
  hasQuotedHistory: boolean;
}

// Intentionally fixed language table: no locale inference or translated header guessing.
const ATTRIBUTIONS = [
  { pattern: /^On .+ wrote:[ \t]*$/u },
  { pattern: /^Am .+:[ \t]*$/u, separator: " schrieb " },
  { pattern: /^Le .+ a écrit[ \t]*:[ \t]*$/u },
] as const;
// Offset backwards from the last nonblank line.
const OUTLOOK_HEADERS = [
  [3, /^From: .+/u],
  [2, /^Sent: .+/u],
  [1, /^To: .+/u],
  [0, /^Subject: .+/u],
] as const;
const FORWARDED = new Set([
  "---------- Forwarded message ---------",
  "---------- Forwarded message ----------",
  "-----Original Message-----",
]);

interface Line {
  value: string;
  content: string;
  prefix: string;
  depth: number;
  eol: string;
}

function isSignature(value: string): boolean {
  return value === "-- " || value === "--";
}

function physicalLine(value: string, eol: string, flowed: boolean): Line {
  let depth = 0;
  let end = 0;
  let cursor = 0;
  // Scan each character once, including spaces between markers, without regex backtracking.
  while (value[cursor] === ">") {
    depth++;
    end = ++cursor;
    while (value[cursor] === " ") cursor++;
  }
  let content = value.slice(end);
  let prefix = value.slice(0, end);
  if (flowed && content.startsWith(" ")) {
    content = content.slice(1);
    // Re-quote using the first line's spelling; depth was measured before unstuffing.
    if (depth > 0) prefix += " ";
  }
  return { value: flowed ? prefix + content : value, content, prefix, depth, eol };
}

/** RFC 3676 §§4.1–4.5; only join equal-depth lines, never a signature separator. */
function normaliseLines(body: string, flowed: boolean, delSp: boolean): Line[] {
  const normalised = body.replaceAll("\r\n", "\n");
  if (normalised === "") return [];
  const values = normalised.split("\n");
  const terminated = normalised.endsWith("\n");
  if (terminated) values.pop();
  const physical = values.map((value, index) =>
    physicalLine(value, index < values.length - 1 || terminated ? "\n" : "", flowed),
  );
  if (!flowed) return physical;

  const logical: Line[] = [];
  let pieces: string[] = [];
  let prefix = "";
  for (const [i, line] of physical.entries()) {
    if (pieces.length === 0) prefix = line.prefix;
    const next = physical[i + 1];
    const isFlowed = line.content.endsWith(" ") && !isSignature(line.content);
    const join =
      isFlowed && next !== undefined && line.depth === next.depth && !isSignature(next.content);
    // DelSp applies even when EOF, quote depth or a signature ends the paragraph.
    pieces.push(isFlowed && delSp ? line.content.slice(0, -1) : line.content);
    if (!join) {
      const content = pieces.join("");
      logical.push({ value: prefix + content, content, prefix, depth: line.depth, eol: line.eol });
      pieces = [];
    }
  }
  return logical;
}

/** Mark only the last nonblank line, or complete contiguous Outlook block, before a quote. */
function attributionLines(lines: Line[]): Set<number> {
  const marked = new Set<number>();
  let lastNonblank = -1;
  let previousDepth = 0;
  for (const [i, line] of lines.entries()) {
    if (line.depth > 0 && previousDepth === 0) {
      const previous = lines[lastNonblank];
      if (previous !== undefined && previous.depth === 0) {
        // One wildcard per pattern avoids backtracking over repeated German separators.
        if (
          ATTRIBUTIONS.some((entry) => {
            if (!entry.pattern.test(previous.value)) return false;
            if (!("separator" in entry)) return true;
            // Require a nonempty date and sender on either side of " schrieb ".
            const separator = previous.value.indexOf(entry.separator, "Am ".length + 1);
            return (
              separator >= 0 &&
              separator + entry.separator.length < previous.value.trimEnd().length - 1
            );
          })
        ) {
          marked.add(lastNonblank);
        } else {
          const start = lastNonblank - OUTLOOK_HEADERS.length + 1;
          if (
            OUTLOOK_HEADERS.every(([offset, pattern]) => {
              const header = lines[lastNonblank - offset];
              return header !== undefined && header.depth === 0 && pattern.test(header.value);
            })
          ) {
            for (let j = start; j <= lastNonblank; j++) marked.add(j);
          }
        }
      }
    }
    previousDepth = line.depth;
    if (line.value.trim() !== "") lastNonblank = i;
  }
  return marked;
}

/**
 * Split decoded text/plain mail. Concatenating segment texts reproduces the
 * LF-normalised input (additionally unstuffed/unflowed when `flowed` is true).
 * Bare CRs, unsupported attribution languages and other prose remain literal.
 * Limits apply to the original input; no HTML/MIME parsing, I/O or locale state.
 */
export function splitQuotedText(body: string, options: QuoteOptions = {}): QuotedText {
  validateBody(body);
  if (
    options === null ||
    typeof options !== "object" ||
    (options.flowed !== undefined && typeof options.flowed !== "boolean") ||
    (options.delSp !== undefined && typeof options.delSp !== "boolean")
  ) {
    throw new QuoteError("INVALID_TEXT");
  }
  const lines = normaliseLines(body, options.flowed === true, options.delSp === true);
  const attributions = attributionLines(lines);
  let signature = -1;
  let forwarded = false;
  for (const [i, line] of lines.entries()) {
    if (line.depth === 0) {
      if (FORWARDED.has(line.value)) forwarded = true;
      if (!forwarded && isSignature(line.value)) signature = i;
    }
  }

  const segments: QuoteSegment[] = [];
  const visible: string[] = [];
  let hasQuotedHistory = false;
  let inSignature = false;
  forwarded = false;
  // Accumulate chunks once per segment, avoiding repeated copies for long bodies.
  let chunks: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === signature) inSignature = true;
    if (line.depth > 0) inSignature = false;
    if (line.depth === 0 && FORWARDED.has(line.value)) {
      forwarded = true;
      inSignature = false;
    }
    const kind: QuoteSegmentKind =
      line.depth > 0
        ? "quote"
        : attributions.has(i)
          ? "attribution"
          : forwarded
            ? "forwarded"
            : inSignature
              ? "signature"
              : "body";
    const previous = segments[segments.length - 1];
    if (previous === undefined || previous.kind !== kind || previous.depth !== line.depth) {
      if (previous !== undefined) previous.text = chunks.join("");
      chunks = [];
      segments.push({ kind, text: "", depth: line.depth });
    }
    const text = line.value + line.eol;
    chunks.push(text);
    if (kind === "body") visible.push(text);
    if (kind === "quote" || kind === "forwarded") hasQuotedHistory = true;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined) last.text = chunks.join("");
  return { segments, visibleText: visible.join(""), hasQuotedHistory };
}
