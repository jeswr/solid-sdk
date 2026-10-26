// AUTHORED-BY Codex GPT-6.1-Sol
import { EMOJI_SHORTCODES } from "./emoji";
import { parseAutolink, trimLinkEnd } from "./links";
import type { InlineNode, TextOptions } from "./types";

type ParseBudget = { remaining: number };

/** Charge successful scans for their match and failed scans for their maximum lookahead. */
function scan(pattern: RegExp, source: string, budget: ParseBudget): RegExpExecArray | null {
  const match = pattern.exec(source);
  budget.remaining -= match?.[0].length ?? source.length;
  return match;
}

/** Find a matching delimiter without closing inside code, escapes, or nested emphasis. */
function emphasisEnd(
  source: string,
  start: number,
  delimiter: string,
  depth: number,
  budget: ParseBudget,
): number {
  if (depth >= 16) return -1;
  for (let offset = start; offset < source.length; offset += 1) {
    if (--budget.remaining < 0) return -1;
    if (source.charAt(offset) === "\\") {
      offset += 1;
      continue;
    }
    const code =
      source.charAt(offset) === "`" ? scan(/^`[^`\n]+`/, source.slice(offset), budget) : null;
    if (code) {
      offset += code[0].length - 1;
      continue;
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
      const end = emphasisEnd(source, offset + marker.length, marker, depth + 1, budget);
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
  // Share the budget across delimiter searches and recursive parsing. A fixed number of
  // final scans can overrun it by at most a source length each, keeping total work linear.
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
    const code = rest.charAt(0) === "`" ? scan(/^`([^`\n]+)`/, rest, budget) : null;
    if (code) {
      nodes.push({ type: "code", value: code[1] as string });
      offset += code[0].length;
      continue;
    }
    const boundary = offset === 0 || !/[\w@]/.test(source.charAt(offset - 1));
    if (boundary) {
      const explicit = rest.startsWith("@[")
        ? scan(/^@\[([^\]\n]*)\]\(([^\s)]*)\)/, rest, budget)
        : null;
      if (explicit) {
        const link = parseAutolink(explicit[2] as string);
        if (link && explicit[1]) {
          nodes.push({ type: "mention", label: explicit[1] as string, webId: link.href });
        } else appendText(explicit[0]);
        offset += explicit[0].length;
        continue;
      }
      const mention =
        rest.charAt(0) === "@"
          ? scan(/^@([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)/, rest, budget)
          : null;
      if (mention) {
        const handle = mention[1] as string;
        const target = options.mentions;
        const webId = target && Object.hasOwn(target, handle) ? target[handle] : undefined;
        nodes.push({
          type: "mention",
          label: handle,
          webId: webId === undefined ? null : (parseAutolink(webId)?.href ?? null),
        });
        offset += mention[0].length;
        continue;
      }
      const candidate = /^https?:\/\//i.test(rest)
        ? scan(/^https?:\/\/[^\s<>"'`]+/i, rest, budget)
        : null;
      if (candidate) {
        const raw = trimLinkEnd(candidate[0]);
        const link = parseAutolink(raw);
        if (link) nodes.push({ type: "link", ...link });
        else appendText(raw);
        offset += raw.length;
        continue;
      }
    }
    const emoji = rest.charAt(0) === ":" ? scan(/^:([a-z0-9_+-]+):/, rest, budget) : null;
    if (emoji) {
      const shortcode = emoji[1] as keyof typeof EMOJI_SHORTCODES;
      if (Object.hasOwn(EMOJI_SHORTCODES, shortcode)) {
        nodes.push({ type: "emoji", shortcode, value: EMOJI_SHORTCODES[shortcode] });
      } else appendText(emoji[0]);
      offset += emoji[0].length;
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
