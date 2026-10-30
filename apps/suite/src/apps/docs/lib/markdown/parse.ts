// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { Lexer, type MarkedToken, type Token, type Tokens } from "marked";
import {
  block,
  checkString,
  decode,
  depthGuard,
  fail,
  mergeText,
  safeLink,
  sortedMarks,
  text,
} from "./shared";
import { type DocsMark, type DocsNode, MarkdownError, type MarkdownOptions } from "./types";

function inline(tokens: Token[], marks: DocsMark[], depth: number, paragraph = false): DocsNode[] {
  depthGuard(depth);
  let offset = 0;
  const bareLinks = tokens.flatMap((token) => {
    const start = offset;
    offset += token.raw.length;
    return token.type === "link" && !/^[[<]/.test(token.raw) ? [{ start, end: offset }] : [];
  });
  if (bareLinks.length) {
    // Re-lex the whole inline source: GFM may end a URL before its closing emphasis delimiter.
    offset = 0;
    for (const token of Lexer.lexInline(tokens.map((entry) => entry.raw).join(""), {
      gfm: false,
    })) {
      const start = offset;
      offset += token.raw.length;
      if (
        (token.type === "em" || token.type === "strong") &&
        bareLinks.some((link) => start < link.end && offset > link.start)
      ) {
        throw new MarkdownError("unrepresentable", "Bare URL would hide CommonMark emphasis");
      }
    }
  }
  return mergeText(
    tokens.flatMap((entry, index): DocsNode[] => {
      const token = entry as MarkedToken;
      switch (token.type) {
        case "escape":
          return text(token.text, marks);
        case "text": {
          if (/\[\^[^\]]+\]/.test(token.text)) fail("Footnotes are unsupported");
          // Trim source whitespace before decoding: references can encode significant spaces.
          let value = token.text.replace(/[\t ]*\n[\t ]*/g, "\n");
          if ((paragraph && index === 0) || tokens[index - 1]?.type === "br")
            value = value.replace(/^[\t ]+/, "");
          if (paragraph && index === tokens.length - 1) value = value.replace(/[\t ]+$/, "");
          return text(decode(value), marks);
        }
        case "strong":
        case "em": {
          // Marked can wrap ***first* middle *last*** as em(strong(literal text)).
          // Re-lexing with Marked repeats that mistake, so reject unresolved delimiters.
          const delimiter = token.raw.charAt(0);
          if (
            token.type === "em" &&
            token.raw.startsWith(delimiter.repeat(3)) &&
            (token.tokens as MarkedToken[]).some(
              (child) =>
                child.type === "strong" &&
                child.raw.startsWith(delimiter.repeat(2)) &&
                child.tokens.some(
                  (nested: Token) => nested.type === "text" && nested.raw.includes(delimiter),
                ),
            )
          ) {
            fail("Nested emphasis with unresolved delimiters is unsupported");
          }
          const type = token.type === "strong" ? "bold" : "italic";
          return inline(
            token.tokens,
            sortedMarks([...marks.filter((mark) => mark.type !== type), { type }]),
            depth + 1,
          );
        }
        case "codespan":
          return text(token.text, sortedMarks([...marks, { type: "code" }]));
        case "checkbox":
          return [];
        case "br":
          return [block("hardBreak")];
        case "link": {
          if (marks.some((mark) => mark.type === "link")) fail("Nested links are unsupported");
          const bare = !/^[[<]/.test(token.raw);
          const destination = token.raw.indexOf("](");
          if (destination >= 0 && /\\&/.test(token.raw.slice(destination))) {
            fail("Escaped link character references are unsupported");
          }
          const autolink = token.raw.startsWith("<");
          const href = autolink ? token.href : decode(token.href);
          safeLink(href);
          const attrs = { href, ...(token.title ? { title: decode(token.title) } : {}) };
          const linkedMarks = sortedMarks([...marks, { type: "link", attrs }]);
          // CommonMark does not interpret character references inside angle autolinks.
          if (autolink) return text(token.text, linkedMarks);
          if (bare) return text(decode(token.text), linkedMarks);
          return inline(token.tokens, linkedMarks, depth + 1);
        }
        default:
          return fail(`Unsupported inline Markdown: ${token.type}`);
      }
    }),
  );
}
function taskItem(item: Tokens.ListItem): { tokens: Token[]; checked?: boolean } {
  if (item.task) {
    return {
      tokens: item.tokens.filter((child) => child.type !== "checkbox"),
      checked: item.checked === true,
    };
  }
  const first = item.tokens[0];
  if (first?.type !== "text" && first?.type !== "paragraph") return { tokens: item.tokens };
  const marker = /^\[([ xX])\](?:[\t \n]+|$)/.exec(first.raw);
  if (!marker) return { tokens: item.tokens };
  let remaining = marker[0].length;
  const tokens = (first.tokens as Token[]).flatMap((child): Token[] => {
    if (!remaining) return [child];
    const consumed = Math.min(remaining, child.raw.length);
    remaining -= consumed;
    if (consumed === child.raw.length) return [];
    // A partial token after marker whitespace is text; retain the existing reference tokens.
    return [
      {
        ...child,
        raw: child.raw.slice(consumed),
        text: (child as Tokens.Text).text.slice(consumed),
      },
    ];
  });
  return {
    tokens: [{ ...first, tokens }, ...item.tokens.slice(1)],
    checked: marker[1] !== " ",
  };
}
function list(token: Tokens.List, depth: number): DocsNode {
  const items = token.items.map(taskItem);
  const task = items.some((item) => item.checked !== undefined);
  if (task && (token.ordered || items.some((item) => item.checked === undefined)))
    fail("Mixed or ordered task lists are unsupported");
  return block(
    task ? "taskList" : token.ordered ? "orderedList" : "bulletList",
    items.map((item) => {
      const children = blocks(item.tokens, depth + 1);
      if (children[0]?.type !== "paragraph") children.unshift(block("paragraph"));
      return block(
        task ? "taskItem" : "listItem",
        children,
        task ? { checked: item.checked } : undefined,
      );
    }),
    token.ordered ? { start: token.start } : undefined,
  );
}
function blocks(tokens: Token[], depth: number): DocsNode[] {
  depthGuard(depth);
  return tokens.flatMap((entry): DocsNode[] => {
    const token = entry as MarkedToken;
    switch (token.type) {
      case "space":
        return [];
      case "def":
        if (/\\&/.test(token.raw)) fail("Escaped link character references are unsupported");
        if (token.tag.startsWith("^")) fail("Footnotes are unsupported");
        return [];
      case "paragraph":
        return [block("paragraph", inline(token.tokens, [], depth + 1, true))];
      case "text":
        return [block("paragraph", inline(token.tokens as Token[], [], depth + 1, true))];
      case "heading":
        if (token.depth > 3) fail("Docs supports heading levels 1–3");
        return [block("heading", inline(token.tokens, [], depth + 1), { level: token.depth })];
      case "hr":
        return [block("horizontalRule")];
      case "blockquote": {
        const content = blocks(token.tokens, depth + 1);
        return [block("blockquote", content.length ? content : [block("paragraph")])];
      }
      case "code":
        if (token.lang && !/^[\w+-]+$/.test(token.lang)) fail("Code fence metadata is unsupported");
        return [
          block("codeBlock", text(token.text), token.lang ? { language: token.lang } : undefined),
        ];
      case "list":
        return [list(token, depth)];
      default:
        return fail(`Unsupported block Markdown: ${token.type}`);
    }
  });
}

/** CommonMark subset + homogeneous bullet task lists; CRLF is normalized to LF. */
export function markdownToDocs(source: string, options: MarkdownOptions = {}): DocsNode {
  if (typeof source !== "string")
    throw new MarkdownError("invalid-input", "Expected Markdown text");
  const normalized = source.replace(/\r\n?/g, "\n");
  checkString(normalized);
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== "unsupported") ||
    ![undefined, "reject", "literal"].includes(options.unsupported)
  ) {
    throw new MarkdownError("invalid-input", "Invalid Markdown options");
  }
  try {
    if (/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.test(normalized))
      fail("Front matter is unsupported");
    const content = blocks(Lexer.lex(normalized, { gfm: true }), 0);
    return block("doc", content.length ? content : [block("paragraph")]);
  } catch (error) {
    if (error instanceof MarkdownError) {
      if (error.code === "unsupported" && options.unsupported === "literal") {
        return block("doc", [block("paragraph", text(normalized))]);
      }
      throw error;
    }
    throw new MarkdownError("invalid-input", "Markdown could not be parsed");
  }
}
