// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChatConversation } from "./chat-writer.js";
import { sanitizeText } from "./iri.js";

const VALUE_MARKER = "[REDACTED]";
const MARKERS = [
  VALUE_MARKER,
  "[REDACTED PRIVATE KEY]",
  "[REDACTED TOKEN]",
  "[REDACTED AWS KEY]",
  "[REDACTED JWT]",
  "[REDACTED AUTHORIZATION]",
  "[REDACTED ENV]", // Recognize archives written by the previous redactor too.
];

function markerLength(text: string, offset: number): number {
  return text[offset] === "["
    ? (MARKERS.find((marker) => text.startsWith(marker, offset))?.length ?? 0)
    : 0;
}

function onlyMarkers(text: string, start: number, end: number): boolean {
  if (start >= end) return false;
  while (start < end) {
    const length = markerLength(text, start);
    if (!length || start + length > end) return false;
    start += length;
  }
  return true;
}

function secretName(name: string): boolean {
  // Most credential words deliberately match substrings (e.g. authentication). "auth" skips
  // author/authority (package metadata, prose) but still matches authorization/authorisation.
  // "key"/"pw" need a word part, so monkey/keyboard/pwned survive but apiKey do not.
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_.-]+/);
  return (
    /token|secret|password|passwd|pwd|passphrase|pass|credential|creds|auth(?!or(?!i[sz]))|cookie|session|bearer|signature|salt|dsn/i.test(
      name,
    ) ||
    /connectionstring|connstr/i.test(parts.join("")) ||
    parts.includes("key") ||
    parts.includes("pw")
  );
}

type ValueSyntax = "code" | "shell" | "query";

/**
 * Find one value without backtracking; retain its surrounding quotes, if any.
 * Only an unambiguous env/shell line (`[export] UPPER_NAME=` at line start) may continue past
 * its line, through a multi-line quote or a backslash continuation. Every other value stops at
 * the end of its line: an unterminated or ambiguous quote redacts to end of line and scanning
 * resumes on the next line, so a value can never swallow a later key while leaving its value.
 */
function valueSpan(
  text: string,
  offset: number,
  syntax: ValueSyntax,
  multiline: boolean,
  join?: number,
) {
  const quote = text[offset];
  let quoted = quote === '"' || quote === "'";
  let start = quoted ? offset + 1 : offset;
  let innerQuote = quoted ? quote : undefined;
  let end = start;
  while (end < text.length) {
    const char = text[end];
    if (!multiline && (char === "\n" || char === "\r")) break;
    if (quoted && char === quote) {
      // A shell word continues straight after a closing quote (`'abc\'123'` is one word), so
      // redact the whole word, quotes included, instead of leaving its tail.
      const after = text[end + 1] ?? "";
      // A completed quote at the field boundary ends this shell word. The next
      // message cannot turn it into a concatenated word and remove its quotes.
      if (syntax !== "shell" || end + 1 === join || after === "" || /[\s;|&]/.test(after)) {
        return { start, end, next: end + 1 };
      }
      quoted = false;
      innerQuote = undefined;
      start = offset;
      end += 1;
      continue;
    }
    if (!innerQuote) {
      // Token rules run first; their markers contain spaces and must stay atomic.
      const length = markerLength(text, end);
      if (length) {
        end += length;
        continue;
      }
      if (/\s/.test(char ?? "")) break;
      if (syntax === "code" && /[;,)}\]]/.test(char ?? "")) break;
      // Shell operators end words even without spaces; escaped/quoted operators do not.
      if (
        syntax === "shell" &&
        (char === ";" || char === "|" || (char === "&" && text[end + 1] === "&"))
      )
        break;
      if (syntax === "shell" && (char === '"' || char === "'")) innerQuote = char;
    } else if (!quoted && char === innerQuote) {
      innerQuote = undefined;
    }
    if (syntax === "query" && /[\s&#"'`<>]/.test(char ?? "")) break;
    // Backslash is literal only inside shell single quotes; code string literals
    // (JS, Python, JSON) stay escape-aware so `'abc\'def'` is scanned to its real end.
    if (char === "\\" && !(innerQuote === "'" && syntax === "shell") && syntax !== "query") {
      // Include escaped whitespace and LF/CRLF continuations, even at EOF. A single-line
      // value keeps its trailing backslash but stops at the line break.
      if (!multiline && (text[end + 1] === "\n" || text[end + 1] === "\r")) {
        end += 1;
        break;
      }
      end += text[end + 1] === "\r" && text[end + 2] === "\n" ? 3 : 2;
    } else {
      end += 1;
    }
  }
  end = Math.min(end, text.length);
  return { start, end, next: end };
}

// Bounded recognition preserves annotations while still finding credential initializers.
// Generic heads are admitted too (Record<string, string>, Array<string | null>, etc.).
const TYPE_ANNOTATION_START =
  /^\s*(?:(?:string|number|boolean|bigint|symbol|object|unknown|any|never|void|null|undefined)(?![A-Za-z0-9_$])|[A-Za-z_$][A-Za-z0-9_$.]*\s*<)/;
const TYPE_ANNOTATION_LIMIT = 256;

function typeAnnotationSpan(text: string, offset: number) {
  const limit = Math.min(text.length, offset + TYPE_ANNOTATION_LIMIT);
  const window = text.slice(offset, limit);
  if (!TYPE_ANNOTATION_START.test(window)) {
    // A window cut off while it could still become a type is inconclusive, not "not a
    // type". Blank to the limit: the value may be on a later line, so take the conservative
    // overflow fallback. One identifier run to the limit: finish it with a single forward
    // scan; only a following `<` (a generic type) is uncertain enough for the fallback,
    // otherwise the identifier is the value and the caller redacts it as usual.
    if (limit >= text.length || !/^\s*(?:[A-Za-z_$][A-Za-z0-9_$.]*)?\s*$/.test(window)) {
      return undefined;
    }
    // Blank-ness is decided inside the bounded window, before any scan beyond it.
    if (/^\s*$/.test(window)) return { end: limit, complete: false, overflow: true };
    let end = limit;
    while (/[A-Za-z0-9_$.]/.test(text[end] ?? "")) end += 1;
    while (/\s/.test(text[end] ?? "")) end += 1;
    return text[end] === "<" ? { end, complete: false, overflow: true } : undefined;
  }
  let depth = 0;
  let needsType = true;
  let end = offset;
  while (end < limit) {
    const char = text[end] ?? "";
    if (/\s/.test(char)) {
      end += 1;
      continue;
    }
    if (needsType) {
      if (!/[A-Za-z_$]/.test(char)) break;
      do {
        end += 1;
      } while (end < limit && /[A-Za-z0-9_$.]/.test(text[end] ?? ""));
      needsType = false;
      continue;
    }
    if (char === "<") {
      depth += 1;
      needsType = true;
    } else if (char === ">" && depth > 0) depth -= 1;
    else if (char === "|" || char === "&" || (char === "," && depth > 0)) needsType = true;
    else if (char === "[" && text[end + 1] === "]") end += 1;
    else break;
    end += 1;
  }
  return {
    end,
    complete: !needsType && depth === 0,
    overflow: end >= limit && limit < text.length,
  };
}

interface Span {
  start: number;
  end: number;
}
interface SecretSpan extends Span {
  /** Include the key/operator in detection, but replace only the value. */
  contextStart: number;
  contextEnd: number;
}
interface Edit extends Span {
  length: number;
}

/** Carry bounded boundary ranges through a detector's ordered, non-overlapping edits. */
function mapSpans(spans: Span[], edits: Edit[]): Span[] {
  const offset = (position: number, end: boolean) => {
    let delta = 0;
    for (const edit of edits) {
      if (position <= edit.start) break;
      if (position < edit.end) return edit.start + delta + (end ? edit.length : 0);
      delta += edit.length - (edit.end - edit.start);
    }
    return position + delta;
  };
  return spans.map(({ start, end }) => ({ start: offset(start, false), end: offset(end, true) }));
}

function redactValues(text: string, inspect?: (span: SecretSpan) => void, join?: number): string {
  // Match name runs once, then inspect their operator and value with forward scans.
  // The scheme boundary prevents retrying a long failed scheme at every hyphen.
  const candidates =
    /(?<scheme>(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/)|(?<env>^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*=)|(?<flag>--)?(?<quote>["']?)(?<name>[A-Za-z_$][A-Za-z0-9_$.-]*)\k<quote>/gm;
  const chunks: string[] = [];
  let copied = 0;
  let previousName = "";
  let previousEnd = 0;
  const replace = (start: number, end: number, contextStart: number, contextEnd = end) => {
    inspect?.({ start, end, contextStart, contextEnd });
    chunks.push(text.slice(copied, start), VALUE_MARKER);
    copied = end;
  };
  for (let match = candidates.exec(text); match; match = candidates.exec(text)) {
    const {
      scheme,
      env,
      flag,
      quote,
      name = "",
    } = match.groups as Record<string, string | undefined>;
    let offset = match.index + match[0].length;
    const preceding = text.slice(previousEnd, match.index);
    const declaration = /^(?:const|let|var)$/.test(previousName) && /^\s*$/.test(preceding);
    const codeContext = /[({[,]\s*$/.test(preceding);
    previousName = name;
    previousEnd = offset;
    if (scheme) {
      let colon = -1;
      let at = -1;
      for (; offset < text.length; offset += 1) {
        const length = markerLength(text, offset);
        if (length) {
          offset += length - 1;
          continue;
        }
        const char = text[offset] ?? "";
        if (/[\s/"'`<>?#]/.test(char)) break;
        if (char === ":" && colon < 0) colon = offset;
        if (char === "@") {
          // A complete left-hand authority cannot acquire another @ from a mention
          // in the next message. In-field scanning retains the last-@ policy.
          if (join !== undefined && offset >= join && at >= 0 && at < join) break;
          at = offset;
        }
      }
      // A numeric suffix can be either a port or a split password. If the following
      // field supplies @ before an authority delimiter, conservatively redact it.
      // Delimited host:port URLs and authorities already containing @ stay intact.
      if (colon >= 0 && colon < at) replace(colon + 1, at, match.index, at + 1);
      candidates.lastIndex = offset;
      previousEnd = offset;
      continue;
    }
    if (!env && !secretName(name)) continue;
    const nameEnd = offset;
    while (text[offset] === " " || text[offset] === "\t") offset += 1;
    const query = /[?&]/.test(text[match.index - 1] ?? "");
    let syntax: ValueSyntax = query ? "query" : env ? "shell" : "code";
    if (!env) {
      if (text.startsWith(":=", offset)) offset += 2;
      else if (
        text[offset] === "=" &&
        (flag || query || (text[offset + 1] !== "=" && text[offset + 1] !== ">"))
      ) {
        if (
          !flag &&
          !query &&
          !quote &&
          !declaration &&
          !codeContext &&
          offset === nameEnd &&
          (match.index === 0 || /[\s;|&]/.test(text[match.index - 1] ?? "")) &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        )
          syntax = "shell";
        offset += 1;
      } else if (text[offset] === ":" && text[offset + 1] !== ":") {
        offset += 1;
        while (text[offset] === " " || text[offset] === "\t") offset += 1;
        const annotation = typeAnnotationSpan(text, offset);
        if (annotation) {
          const { end, complete, overflow } = annotation;
          if (overflow) {
            // Past the bounded grammar, an initializer may be on a later line.
            // Treat the remainder as uncertain rather than leave any secret suffix.
            replace(offset, text.length, match.index);
            candidates.lastIndex = text.length;
            previousEnd = text.length;
            continue;
          }
          if (text[end] === "=" && text[end + 1] !== "=" && text[end + 1] !== ">") {
            offset = end + 1;
            while (/\s/.test(text[offset] ?? "")) offset += 1;
          } else if (complete) {
            continue;
          }
        }
      } else if (!flag || offset === nameEnd) continue;
      while (text[offset] === " " || text[offset] === "\t") offset += 1;
    }
    const span = valueSpan(text, offset, syntax, Boolean(env), join);
    replace(span.start, span.end, match.index, span.next);
    candidates.lastIndex = span.next;
    previousEnd = span.next;
  }
  chunks.push(text.slice(copied));
  return chunks.join("");
}

const ORPHAN_PRIVATE_KEY = /^[\s\S]*-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g;
const TOKEN_RULES: readonly (readonly [RegExp, string])[] = [
  // Include unfinished PEM blocks: a truncated transcript must not leak their bodies.
  [
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    "[REDACTED PRIVATE KEY]",
  ],
  // Conservatively cover orphan END lines from the field start, including bodies
  // longer than a boundary window. Complete BEGIN/END blocks were removed above.
  [ORPHAN_PRIVATE_KEY, "[REDACTED PRIVATE KEY]"],
  // Letter/digit boundaries let Markdown emphasis surround tokens without hiding them.
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]"],
  [/(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[REDACTED TOKEN]"],
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, "[REDACTED AWS KEY]"],
  [/(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED JWT]"],
  [/(?<![A-Za-z0-9])(?:proxy-)?authorization\s*:[^\r\n]*/gi, "[REDACTED AUTHORIZATION]"],
];

/** Shared detectors; source-position tracking is used only for bounded boundary windows. */
function redactNormalized(
  input: string,
  inspect?: (span: SecretSpan) => void,
  covered: Span[] = [],
  join?: number,
): string {
  let text = input;
  // Identity offsets need no allocation. Allocate compact maps only when a token
  // replacement actually changes a boundary window, then copy unchanged ranges.
  let starts: Int32Array | undefined;
  let ends: Int32Array | undefined;
  const sourceSpan = (start: number, end: number): Span => ({
    start: starts ? (starts[start] ?? input.length) : Math.min(start, input.length),
    end: ends ? (ends[end - 1] ?? 0) : Math.min(end, input.length),
  });
  for (const [pattern, marker] of TOKEN_RULES) {
    // ^ means the field start, never the beginning of a truncated left window.
    if (join !== undefined && pattern === ORPHAN_PRIVATE_KEY) continue;
    const edits: Edit[] = [];
    text = text.replace(pattern, (match: string, offset: number) => {
      if (inspect || covered.length)
        edits.push({ start: offset, end: offset + match.length, length: marker.length });
      if (inspect) {
        const span = sourceSpan(offset, offset + match.length);
        inspect({ ...span, contextStart: span.start, contextEnd: span.end });
      }
      return marker;
    });
    if (inspect && edits.length) {
      const nextStarts = new Int32Array(text.length);
      const nextEnds = new Int32Array(text.length);
      let copied = 0;
      let written = 0;
      const copy = (end: number) => {
        if (starts && ends) {
          nextStarts.set(starts.subarray(copied, end), written);
          nextEnds.set(ends.subarray(copied, end), written);
          written += end - copied;
          copied = end;
        } else {
          while (copied < end) {
            nextStarts[written] = copied;
            nextEnds[written++] = ++copied;
          }
        }
      };
      for (const edit of edits) {
        copy(edit.start);
        const span = sourceSpan(edit.start, edit.end);
        nextStarts.fill(span.start, written, written + edit.length);
        nextEnds.fill(span.end, written, written + edit.length);
        written += edit.length;
        copied = edit.end;
      }
      copy(starts?.length ?? input.length);
      starts = nextStarts;
      ends = nextEnds;
    }
    covered = mapSpans(covered, edits);
    if (join !== undefined && edits.length)
      join = (mapSpans([{ start: join, end: join }], edits)[0] as Span).start;
  }
  const edits: Edit[] = [];
  const result = redactValues(
    text,
    inspect || covered.length
      ? ({ start, end, contextStart, contextEnd }) => {
          if (covered.length) edits.push({ start, end, length: VALUE_MARKER.length });
          inspect?.({
            ...sourceSpan(start, end),
            contextStart: sourceSpan(contextStart, contextStart).start,
            contextEnd: sourceSpan(contextEnd, contextEnd).end,
          });
        }
      : undefined,
    join,
  );
  return covered.length ? replaceSpans(result, mapSpans(covered, edits)) : result;
}

const BOUNDARY_WINDOW = 512;

function boundarySpans(fields: readonly string[]): Span[][] {
  const spans: Span[][] = fields.map(() => []);
  for (let i = 1; i < fields.length; i++) {
    const left = fields[i - 1] as string;
    const right = fields[i] as string;
    let offset = Math.max(0, left.length - BOUNDARY_WINDOW);
    let limit = Math.min(right.length, BOUNDARY_WINDOW);
    // Snap inward so both bounded windows contain complete code points.
    if (/[\uDC00-\uDFFF]/.test(left[offset] ?? "")) offset += 1;
    if (/[\uD800-\uDBFF]/.test(right[limit - 1] ?? "")) limit -= 1;
    const join = left.length - offset;
    const window = left.slice(offset) + right.slice(0, limit);
    redactNormalized(
      window,
      ({ start, end, contextStart, contextEnd }) => {
        // A key/operator may span the join while its value lies entirely on the right.
        // URL userinfo also needs the @ on the right even if its value is on the left.
        if (contextStart >= join || contextEnd <= join || start >= end) return;
        // A previously redacted value completes the left field's contribution.
        // Otherwise retained assignment names would consume another 512 units of
        // the next field on every replay. Original source windows still detect
        // plaintext fragments before any per-field markers are introduced.
        if (onlyMarkers(window, start, Math.min(end, join))) return;
        if (start < join)
          spans[i - 1]?.push({ start: offset + start, end: offset + Math.min(end, join) });
        if (end > join) spans[i]?.push({ start: Math.max(0, start - join), end: end - join });
      },
      [],
      join,
    );
  }
  return spans;
}

/** Follow recognized PEM headers to their first END, across arbitrarily long fields.
 * Only delimiter recognition needs a bounded previous suffix; no body is concatenated
 * with an ever-growing prefix. Header/END splits across one join are recognized too.
 */
function pemContinuationSpans(fields: readonly string[], spans: Span[][]): void {
  let open = false;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string;
    const previous = fields[i - 1] ?? "";
    const prefix = previous.slice(-BOUNDARY_WINDOW);
    const text = prefix + field;
    const delimiters = /-----(BEGIN|END) (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g;
    let start = 0;
    let continued = open;
    for (let match = delimiters.exec(text); match; match = delimiters.exec(text)) {
      const end = match.index + match[0].length - prefix.length;
      if (end <= 0) continue;
      if (match[1] === "BEGIN" && !open) {
        start = Math.max(0, match.index - prefix.length);
        continued = match.index < prefix.length;
        if (match.index < prefix.length)
          spans[i - 1]?.push({
            start: previous.length - prefix.length + match.index,
            end: previous.length,
          });
        open = true;
      } else if (match[1] === "END" && open) {
        if (continued) spans[i]?.push({ start, end });
        open = false;
      }
    }
    // Local BEGIN matches already cover their field. Add only cross-field pieces,
    // keeping the number of mapped ranges per field bounded even with many keys.
    if (open && continued) spans[i]?.push({ start, end: field.length });
  }
}

function replaceSpans(text: string, spans: Span[]): string {
  if (!spans.length) return text;
  // Each field participates in at most two fixed-size windows. Merge overlaps before
  // replacing, so a middle field is not repeatedly copied or given duplicate markers.
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const markers: Span[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const length = markerLength(text, offset);
    if (!length) continue;
    markers.push({ start: offset, end: offset + length });
    offset += length - 1;
  }
  const merged: Span[] = [];
  let markerIndex = 0;
  for (const span of spans) {
    if (span.start >= span.end) continue;
    // Preserve any existing marker touched by a mapped span. Absorb newly exposed
    // fragments into its coverage; a span contained in a marker changes nothing.
    while (markerIndex < markers.length && (markers[markerIndex] as Span).end < span.start)
      markerIndex++;
    while (markerIndex < markers.length && (markers[markerIndex] as Span).start <= span.end) {
      const marker = markers[markerIndex++] as Span;
      span.start = Math.min(span.start, marker.start);
      span.end = Math.max(span.end, marker.end);
    }
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  const parts: string[] = [];
  let copied = 0;
  markerIndex = 0;
  for (const { start, end } of merged) {
    while (markerIndex < markers.length && (markers[markerIndex] as Span).end <= start)
      markerIndex++;
    const retained: string[] = [];
    while (markerIndex < markers.length && (markers[markerIndex] as Span).start < end) {
      const marker = markers[markerIndex++] as Span;
      retained.push(text.slice(marker.start, marker.end));
    }
    parts.push(text.slice(copied, start), retained.length ? retained.join("") : VALUE_MARKER);
    copied = end;
  }
  parts.push(text.slice(copied));
  return parts.join("");
}

/**
 * Normalize/redact fields in persistence order (title, then messages or capture chunks).
 * Inspect each adjacent suffix/prefix of at most 512 UTF-16 code units, joined without
 * a separator, with edges snapped inward to complete code points. Only detections
 * whose full context spans the join add value-only [REDACTED] markers. Existing
 * markers are preserved; a marker-only left value ends boundary continuation.
 * Source windows are inspected too: per-field redaction may already have hidden `sk-`
 * or an assignment head while leaving its continuation in the next field exposed.
 * Apply this before splitting a conversation into independent saves/queued snapshots.
 * Recognized PEM BEGIN headers carry redaction through subsequent fields to the
 * first END delimiter, or the conversation end, including bodies beyond the window.
 * Work is O(total input length + field count); no full-conversation concatenation.
 */
export function redactSecretFields(fields: readonly string[]): string[] {
  const normalized = fields.map((field) => sanitizeText(field));
  const redacted = normalized.map((field) => redactNormalized(field));
  const sourceSpans = boundarySpans(normalized);
  pemContinuationSpans(normalized, sourceSpans);
  for (let i = 0; i < redacted.length; i++) {
    const spans = sourceSpans[i] as Span[];
    if (spans.length) redacted[i] = redactNormalized(normalized[i] as string, undefined, spans);
  }
  const spans = boundarySpans(redacted);
  // A window edge may remove an emoji's base while leaving its ZWJ/tags beyond the
  // match. Normalize once more so the rendered result and the RDF serializer agree.
  return redacted.map((field, i) => {
    const replaced = sanitizeText(replaceSpans(field, spans[i] as Span[]));
    // Removing a boundary fragment can expose syntax that was previously inside
    // a URL or another detector's context. Finish per-field detection in this
    // call so replay does not discover a new assignment in the edited text.
    return sourceSpans[i]?.length || spans[i]?.length ? redactNormalized(replaced) : replaced;
  });
}

/** Optional source chunks for conversation-aware redaction before assembly. */
export interface RedactConversationOptions {
  /** Original text chunks for each message, in message order. Length must match messages.
   * Chunks replace message.text, are checked before joining with newlines and trimming,
   * then the assembled title/messages are checked again. Input is never mutated.
   */
  chunks?: readonly (readonly string[])[];
}

/**
 * Redact a conversation's title and ordered messages together before storage,
 * export, queueing or splitting saves. Returns a copy, preserving message metadata.
 * Uses {@link redactSecretFields}, including PEM continuation. With source chunks,
 * checks their boundaries, joins each message with newlines, trims its text and
 * checks the assembled conversation. Refuses a chunk/message count mismatch.
 */
export function redactConversation(
  conversation: ChatConversation,
  options: RedactConversationOptions = {},
): ChatConversation {
  const chunks = options.chunks;
  if (chunks && chunks.length !== conversation.messages.length)
    throw new Error("Invalid conversation chunks");
  const fields = redactSecretFields([
    conversation.title,
    ...(chunks ? chunks.flat() : conversation.messages.map((message) => message.text)),
  ]);
  let offset = 1;
  const result = {
    ...conversation,
    title: fields[0] as string,
    messages: conversation.messages.map((message, index) => {
      const count = chunks ? (chunks[index] as readonly string[]).length : 1;
      const text = chunks
        ? fields
            .slice(offset, offset + count)
            .join("\n")
            .trim()
        : (fields[offset] as string);
      offset += count;
      return { ...message, text };
    }),
  };
  return chunks ? redactConversation(result) : result;
}

/**
 * Remove common credential forms before persistence or upload. No diagnostics contain input.
 * Token rules run first. Assignments, object keys, CLI flags and query parameters with
 * secret-looking names, plus compact UPPER_SNAKE_CASE env lines and URL passwords,
 * replace only their value with [REDACTED], retaining quotes and surrounding code.
 * Credential words match substrings, except "key"/"pw" which require an underscore,
 * hyphen, dot or camelCase word boundary: key_count/apiKey redact; monkey/keyboard stay.
 * Multiline, continued and unfinished values err toward redaction. Value scanning is linear.
 * Normalization strips C0/C1 controls (except tab/CR/LF) and every Unicode Cf character,
 * except ZWJ between Extended_Pictographic emoji (optional FE0E/FE0F/skin-tone modifiers),
 * and U+1F3F4 subdivision flags with two tag lowercase country letters, then 1–4
 * tag lowercase letters/digits and U+E007F. Lone surrogates and other Cf, including
 * orphan ZWJs, soft hyphens, bidi controls and incomplete/orphan tags, are removed.
 * Variation selectors are stripped except FE0E/FE0F on emoji bases/modifiers and
 * complete keycaps, so invisible selectors cannot interrupt credential patterns.
 *
 * {@link ChatWriter} uses {@link redactSecretFields} to add conversation boundary checks.
 * Call that helper on the complete source before splitting saves: independent calls to
 * this function cannot recover a token prefix already replaced in a preceding field.
 * Per-field output is a fixpoint: redacting it again changes nothing.
 */
export function redactSecrets(text: string): string {
  return redactNormalized(sanitizeText(text));
}
