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

function inline(tokens: Token[], marks: DocsMark[], depth: number): DocsNode[] {
  depthGuard(depth);
  return mergeText(
    tokens.flatMap((entry): DocsNode[] => {
      const token = entry as MarkedToken;
      switch (token.type) {
        case "escape":
          return text(token.text, marks);
        case "text":
          if (/\[\^[^\]]+\]/.test(token.text)) fail("Footnotes are unsupported");
          return text(decode(token.text), marks);
        case "strong":
        case "em": {
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
          // GFM bare-URL linkification is outside CommonMark. Retain those URLs as plain text.
          if (!/^[[<]/.test(token.raw)) return text(token.raw, marks);
          if (/\\&/.test(token.raw)) fail("Escaped link character references are unsupported");
          const href = decode(token.href);
          safeLink(href);
          const attrs = { href, ...(token.title ? { title: decode(token.title) } : {}) };
          return inline(token.tokens, sortedMarks([...marks, { type: "link", attrs }]), depth + 1);
        }
        default:
          return fail(`Unsupported inline Markdown: ${token.type}`);
      }
    }),
  );
}
function list(token: Tokens.List, depth: number): DocsNode {
  const isTask = (item: Tokens.ListItem) => item.task || /^\[[ xX]\]\s*$/.test(item.text);
  const task = token.items.some(isTask);
  if (task && (token.ordered || token.items.some((item) => !isTask(item))))
    fail("Mixed or ordered task lists are unsupported");
  return block(
    task ? "taskList" : token.ordered ? "orderedList" : "bulletList",
    token.items.map((item) => {
      // Marked includes a checkbox token; taskItem.checked holds that information in Docs.
      const children = blocks(
        isTask(item) && !item.task ? [] : item.tokens.filter((child) => child.type !== "checkbox"),
        depth + 1,
      );
      if (children[0]?.type !== "paragraph") children.unshift(block("paragraph"));
      return block(
        task ? "taskItem" : "listItem",
        children,
        task
          ? { checked: item.task ? item.checked === true : /^\[[xX]\]/.test(item.text) }
          : undefined,
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
        return [block("paragraph", inline(token.tokens, [], depth + 1))];
      case "text":
        return [block("paragraph", inline(token.tokens as Token[], [], depth + 1))];
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
