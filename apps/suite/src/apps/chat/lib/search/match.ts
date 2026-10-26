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

/** The needle is already folded. Phrases require a complete last word. */
export function findMatches(source: FoldedText, needle: string, phrase: boolean): MatchRange[] {
  const ranges: MatchRange[] = [];
  let position = source.text.indexOf(needle);
  while (position !== -1) {
    const end = position + needle.length;
    if (
      (!wordAfter(needle, 0) || !wordBefore(source.text, position)) &&
      (!phrase || !wordBefore(needle, needle.length) || !wordAfter(source.text, end))
    ) {
      ranges.push([
        (source.spans[position] as SourceSpan).start,
        (source.spans[end - 1] as SourceSpan).end,
      ]);
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
  let cursor = 0;
  let seenAt = false;
  let seenScheme = false;
  for (const match of text.matchAll(
    /@(?:[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/giu,
  )) {
    // Ignore email addresses, repeated @, and URL userinfo/path fragments.
    // Advance once through the prefix instead of rescanning it for each candidate.
    for (; cursor < match.index; cursor++) {
      const character = text.charAt(cursor);
      if (/\s/u.test(character)) {
        seenAt = false;
        seenScheme = false;
      } else {
        if (character === "@") seenAt = true;
        if (text.startsWith("://", cursor)) seenScheme = true;
      }
    }
    if (wordBefore(text, match.index) || seenAt || seenScheme) continue;
    if (!match[2] || parseAutolink(match[2])) return true;
  }
  return false;
}
