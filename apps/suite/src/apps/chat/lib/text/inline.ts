// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { EMOJI_SHORTCODES } from "./emoji";
import { parseAutolink, trimLinkEnd } from "./links";
import type { InlineNode, TextOptions } from "./types";

type ParseBudget = { remaining: number };

/** Scan one character at a time, charging only inspected lookahead and stopping at the limit. */
function scanRun(source: string, start: number, character: RegExp, budget: ParseBudget): number {
  let end = start;
  while (end < source.length) {
    if (--budget.remaining < 0 || !character.test(source.charAt(end))) break;
    end += 1;
  }
  return end;
}

function scanCode(source: string, budget: ParseBudget) {
  const end = scanRun(source, 1, /[^`\n]/, budget);
  return end > 1 && source.charAt(end) === "`"
    ? [source.slice(0, end + 1), source.slice(1, end)]
    : null;
}

function scanMention(source: string, budget: ParseBudget) {
  if (source.startsWith("@[")) {
    const labelEnd = scanRun(source, 2, /[^\]]/, budget);
    let end = labelEnd;
    let destination = "";
    if (source.startsWith("](", labelEnd)) {
      const start = labelEnd + 2;
      end = start;
      let parentheses = 1;
      while (end < source.length) {
        if (--budget.remaining < 0) break;
        const character = source.charAt(end);
        end += 1;
        if (character === "(") parentheses += 1;
        if (character === ")") parentheses -= 1;
        if (parentheses === 0) {
          destination = source.slice(2, labelEnd).includes("\n")
            ? ""
            : source.slice(start, end - 1);
          break;
        }
      }
    }
    // Incomplete or unsupported mentions stay opaque and literal, never partial identities.
    return {
      explicit: [source.slice(0, end), source.slice(2, labelEnd), destination],
      handle: null,
    };
  }
  let end = scanRun(source, 1, /[A-Za-z0-9_]/, budget);
  if (end === 1) return { explicit: null, handle: null };
  while (
    budget.remaining >= 0 &&
    /[.-]/.test(source.charAt(end)) &&
    /[A-Za-z0-9_]/.test(source.charAt(end + 1))
  ) {
    end = scanRun(source, end + 1, /[A-Za-z0-9_]/, budget);
  }
  return { explicit: null, handle: [source.slice(0, end), source.slice(1, end)] };
}

function scanUrl(source: string, budget: ParseBudget): string | null {
  const prefix = /^https?:\/\//i.exec(source);
  if (!prefix) return null;
  const end = scanRun(source, prefix[0].length, /[^\s<>"'`]/, budget);
  return end > prefix[0].length ? trimLinkEnd(source.slice(0, end)) : null;
}

/** Reserve terminal markers for enclosing formatting without exposing internal token markers. */
function opaqueLength(value: string, closers: readonly string[]): number {
  let length = value.length;
  let suffix = "";
  for (const closer of closers) {
    suffix += closer;
    if (value.endsWith(suffix)) length = value.length - suffix.length;
  }
  return length;
}

/** Find a matching delimiter without closing inside opaque tokens or nested emphasis. */
function emphasisEnd(
  source: string,
  start: number,
  delimiter: string,
  depth: number,
  budget: ParseBudget,
  closers: readonly string[] = [delimiter],
): number {
  if (depth >= 16) return -1;
  for (let offset = start; offset < source.length; offset += 1) {
    if (--budget.remaining < 0) return -1;
    if (source.charAt(offset) === "\\") {
      offset += 1;
      continue;
    }
    const code = source.charAt(offset) === "`" ? scanCode(source.slice(offset), budget) : null;
    if (code) {
      offset += (code[0] as string).length - 1;
      continue;
    }
    if (
      source.charAt(offset) === "@" &&
      (offset === start || !/[\w@]/.test(source.charAt(offset - 1)))
    ) {
      const { explicit, handle } = scanMention(source.slice(offset), budget);
      const mention = explicit ?? handle;
      if (mention) {
        // Explicit labels/destinations are opaque; only handles reserve underscore closers.
        const length =
          handle && delimiter.charAt(0) === "_"
            ? opaqueLength(handle[0] as string, closers)
            : (mention[0] as string).length;
        offset += length - 1;
        continue;
      }
    }
    if (offset === start || !/[\w@]/.test(source.charAt(offset - 1))) {
      const url = scanUrl(source.slice(offset), budget);
      if (url) {
        offset += opaqueLength(url, closers) - 1;
        continue;
      }
    }
    const marker = /^(\*\*|__|\*|_)/.exec(source.slice(offset))?.[0];
    if (!marker) continue;
    const previous = source.charAt(offset - 1);
    let runEnd = offset + marker.length;
    if (marker.charAt(0) === "_") {
      while (source.charAt(runEnd) === "_") {
        budget.remaining -= 1;
        runEnd += 1;
      }
    }
    const intraword =
      marker.charAt(0) === "_" && /[A-Za-z0-9]/.test(previous) && /\w/.test(source.charAt(runEnd));
    if (intraword) {
      offset = runEnd - 1;
      continue;
    }
    // Consume a closing run against the active delimiter before trying new nesting.
    if (!/\s/.test(previous) && source.startsWith(delimiter, offset)) {
      return offset;
    }
    if (
      (!/[\w@]/.test(previous) || previous === marker.charAt(0)) &&
      !/\s/.test(source.charAt(offset + marker.length))
    ) {
      const end = emphasisEnd(source, offset + marker.length, marker, depth + 1, budget, [
        marker,
        ...closers,
      ]);
      if (end > offset + marker.length) {
        offset = end + marker.length - 1;
        continue;
      }
    }
    offset += marker.length - 1;
  }
  return -1;
}

/** Parse a bounded Markdown-lite subset; HTML and unsupported syntax stay literal. */
export function parseInline(source: string, options: TextOptions = {}, depth = 0): InlineNode[] {
  // Share the budget across delimiter searches and recursive parsing.
  // Token scanners stop at the limit, keeping total lookahead linear.
  // Pathological input remains intact as literal text when it exhausts the budget.
  const budget = { remaining: source.length * 32 };
  const nodes = inline(source, options, depth, budget);
  return budget.remaining < 0 ? [{ type: "text", value: source }] : nodes;
}

function inline(
  source: string,
  options: TextOptions,
  depth: number,
  budget: ParseBudget,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  const appendText = (value: string) => {
    const previous = nodes.at(-1);
    if (previous?.type === "text") previous.value += value;
    else nodes.push({ type: "text", value });
  };
  if (depth >= 16) return [{ type: "text", value: source }];
  for (let offset = 0; offset < source.length; ) {
    if (--budget.remaining < 0) return nodes;
    const rest = source.slice(offset);
    const escaped = /^\\([\\`*_{}[\]()#+.!>@:~-])/.exec(rest);
    if (escaped) {
      appendText(escaped[1] as string);
      offset += 2;
      continue;
    }
    const code = rest.charAt(0) === "`" ? scanCode(rest, budget) : null;
    if (code) {
      nodes.push({ type: "code", value: code[1] as string });
      offset += (code[0] as string).length;
      continue;
    }
    const boundary = offset === 0 || !/[\w@]/.test(source.charAt(offset - 1));
    if (boundary) {
      const { explicit, handle: mention } =
        rest.charAt(0) === "@" ? scanMention(rest, budget) : { explicit: null, handle: null };
      if (explicit) {
        const link = parseAutolink(explicit[2] as string);
        if (link && explicit[1]) {
          nodes.push({ type: "mention", label: explicit[1] as string, webId: link.href });
        } else appendText(explicit[0] as string);
        offset += (explicit[0] as string).length;
        continue;
      }
      if (mention) {
        const handle = mention[1] as string;
        const target = options.mentions;
        const webId = target && Object.hasOwn(target, handle) ? target[handle] : undefined;
        nodes.push({
          type: "mention",
          label: handle,
          webId: webId === undefined ? null : (parseAutolink(webId)?.href ?? null),
        });
        offset += (mention[0] as string).length;
        continue;
      }
      const raw = scanUrl(rest, budget);
      if (raw) {
        const link = parseAutolink(raw);
        if (link) nodes.push({ type: "link", ...link });
        else appendText(raw);
        offset += raw.length;
        continue;
      }
    }
    const emojiEnd = rest.charAt(0) === ":" ? scanRun(rest, 1, /[a-z0-9_+-]/, budget) : 0;
    const emoji =
      emojiEnd > 1 && rest.charAt(emojiEnd) === ":"
        ? [rest.slice(0, emojiEnd + 1), rest.slice(1, emojiEnd)]
        : null;
    if (emoji) {
      const shortcode = emoji[1] as keyof typeof EMOJI_SHORTCODES;
      if (Object.hasOwn(EMOJI_SHORTCODES, shortcode)) {
        nodes.push({ type: "emoji", shortcode, value: EMOJI_SHORTCODES[shortcode] });
      } else appendText(emoji[0] as string);
      offset += (emoji[0] as string).length;
      continue;
    }
    const delimiter = /^(\*\*|__|\*|_)/.exec(rest)?.[0];
    if (delimiter && boundary) {
      const end = emphasisEnd(rest, delimiter.length, delimiter, depth, budget);
      const body = rest.slice(delimiter.length, end);
      if (end > delimiter.length && !/^\s|\s$/.test(body)) {
        nodes.push({
          type: delimiter.length === 2 ? "bold" : "italic",
          children: inline(body, options, depth + 1, budget),
        });
        offset += end + delimiter.length;
        continue;
      }
      appendText(delimiter);
      offset += delimiter.length;
      continue;
    }
    appendText(source.charAt(offset));
    offset += 1;
  }
  return nodes;
}
