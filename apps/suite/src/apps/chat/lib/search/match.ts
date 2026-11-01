// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseAutolink, trimLinkEnd } from "../text/links";
import type { MatchRange } from "./types";
import { fold } from "./validation";

interface SourceSpan {
  start: number;
  end: number;
}

export interface FoldedText {
  text: string;
  spans: SourceSpan[];
}

/** Keep a source span for every folded UTF-16 unit, including NFKD expansions. */
export function project(source: string): FoldedText {
  const chunks: string[] = [];
  const spans: SourceSpan[] = [];
  let offset = 0;
  let previous: SourceSpan | undefined;
  for (const character of source) {
    const value = fold(character);
    offset += character.length;
    if (!value) {
      if (previous) previous.end = offset;
      continue;
    }
    const span = { start: offset - character.length, end: offset };
    chunks.push(value);
    for (let index = 0; index < value.length; index++) spans.push(span);
    previous = span;
  }
  return { text: chunks.join(""), spans };
}

function wordBefore(text: string, offset: number): boolean {
  return /[\p{L}\p{M}\p{N}_]$/u.test(text.slice(Math.max(0, offset - 2), offset));
}

function wordAfter(text: string, offset: number): boolean {
  return /^[\p{L}\p{N}_]/u.test(text.slice(offset, offset + 2));
}

/** Folded needle; stop at the requested count or exclusive source-offset boundary. */
export function findMatches(
  source: FoldedText,
  needle: string,
  phrase: boolean,
  limit = 1,
  before = Infinity,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  let position = source.text.indexOf(needle);
  while (position !== -1 && (source.spans[position] as SourceSpan).start < before) {
    const end = position + needle.length;
    if (
      (!wordAfter(needle, 0) || !wordBefore(source.text, position)) &&
      (!phrase || !wordBefore(needle, needle.length) || !wordAfter(source.text, end))
    ) {
      ranges.push([
        (source.spans[position] as SourceSpan).start,
        (source.spans[end - 1] as SourceSpan).end,
      ]);
      if (ranges.length === limit) break;
    }
    position = source.text.indexOf(needle, position + 1);
  }
  return ranges;
}

export function hasLink(text: string): boolean {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
    if (!wordBefore(text, match.index) && parseAutolink(trimLinkEnd(match[0]))) return true;
  }
  return false;
}

export function hasMention(text: string): boolean {
  let labelEnd = -1;
  let validDestination = false;
  const destination = /https?:\/\/[^\s)<>"'\\]+/iy;
  // Consume complete email/URL spans. Word runs also match without an @, so a
  // failed email candidate cannot cause repeated scans of the same word suffix.
  for (const match of text.matchAll(
    /:\/\/[^\s<>"']*|[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_.+-]*(?:@[\p{L}\p{M}\p{N}_.@-]+)?|@/gu,
  )) {
    if (match[0] !== "@" || wordBefore(text, match.index) || text.charAt(match.index - 1) === "@") {
      continue;
    }
    if (wordAfter(text, match.index + 1)) return true;
    if (text.charAt(match.index + 1) !== "[") continue;
    const labelStart = match.index + 2;
    // Nested failed @[ candidates share their next ]/newline and destination.
    // Both cursors only move forward; each label suffix is inspected once.
    if (labelEnd < labelStart) {
      labelEnd = labelStart;
      while (labelEnd < text.length && !/[\]\n]/u.test(text.charAt(labelEnd))) labelEnd++;
      destination.lastIndex = labelEnd + 2;
      const target = text.startsWith("](", labelEnd) ? destination.exec(text) : null;
      validDestination =
        target !== null &&
        text.charAt(destination.lastIndex) === ")" &&
        parseAutolink(target[0]) !== null;
    }
    if (labelEnd > labelStart && validDestination) return true;
  }
  return false;
}
