// AUTHORED-BY Codex GPT-6.1-Sol
import { EMOJI_SHORTCODES } from "./emoji";
import { parseAutolink, trimLinkEnd } from "./links";
import type { InlineNode, TextOptions } from "./types";

/** Find a matching delimiter without closing inside code, escapes, or nested emphasis. */
function emphasisEnd(source: string, start: number, delimiter: string, depth: number): number {
  if (depth >= 16) return -1;
  for (let offset = start; offset < source.length; offset += 1) {
    if (source.charAt(offset) === "\\") {
      offset += 1;
      continue;
    }
    const code = /^`[^`\n]+`/.exec(source.slice(offset));
    if (code) {
      offset += code[0].length - 1;
      continue;
    }
    const marker = /^(\*\*|__|\*|_)/.exec(source.slice(offset))?.[0];
    if (!marker) continue;
    if (marker === delimiter) return offset;
    if (!/\s/.test(source.charAt(offset + marker.length))) {
      const end = emphasisEnd(source, offset + marker.length, marker, depth + 1);
      if (end > offset + marker.length) {
        offset = end + marker.length - 1;
        continue;
      }
    }
    // A triple closing run can close the inner single and then the outer double.
    if (source.startsWith(delimiter, offset)) return offset;
    offset += marker.length - 1;
  }
  return -1;
}

/** Parse a bounded Markdown-lite subset; HTML and unsupported syntax stay literal. */
export function parseInline(source: string, options: TextOptions = {}, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  const appendText = (value: string) => {
    const previous = nodes.at(-1);
    if (previous?.type === "text") previous.value += value;
    else nodes.push({ type: "text", value });
  };
  if (depth >= 16) return [{ type: "text", value: source }];
  for (let offset = 0; offset < source.length; ) {
    const rest = source.slice(offset);
    const escaped = /^\\([\\`*_{}[\]()#+.!>@:~-])/.exec(rest);
    if (escaped) {
      appendText(escaped[1] as string);
      offset += 2;
      continue;
    }
    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      nodes.push({ type: "code", value: code[1] as string });
      offset += code[0].length;
      continue;
    }
    const boundary = offset === 0 || !/[\w@]/.test(source.charAt(offset - 1));
    if (boundary) {
      const explicit = /^@\[([^\]\n]*)\]\(([^\s)]*)\)/.exec(rest);
      if (explicit) {
        const link = parseAutolink(explicit[2] as string);
        if (link && explicit[1]) {
          nodes.push({ type: "mention", label: explicit[1] as string, webId: link.href });
        } else appendText(explicit[0]);
        offset += explicit[0].length;
        continue;
      }
      const mention = /^@([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)/.exec(rest);
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
      const candidate = /^https?:\/\/[^\s<>"'`]+/i.exec(rest);
      if (candidate) {
        const raw = trimLinkEnd(candidate[0]);
        const link = parseAutolink(raw);
        if (link) nodes.push({ type: "link", ...link });
        else appendText(raw);
        offset += raw.length;
        continue;
      }
    }
    const emoji = /^:([a-z0-9_+-]+):/.exec(rest);
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
      const end = emphasisEnd(rest, delimiter.length, delimiter, depth);
      const body = rest.slice(delimiter.length, end);
      if (end > delimiter.length && !/^\s|\s$/.test(body)) {
        nodes.push({
          type: delimiter.length === 2 ? "bold" : "italic",
          children: parseInline(body, options, depth + 1),
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
