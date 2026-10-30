// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  Lexer,
  type MarkedToken,
  type Token,
  Tokenizer,
  type Tokens,
  type TokensList,
  walkTokens,
} from "marked";
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

const listOpening = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*)?(?:\n|$)/;
const setextUnderline = /^ {0,3}(?:=+|-+)[ \t]*(?:\n|$)/;

function columns(prefix: string): number {
  let column = 0;
  for (const character of prefix) column += character === "\t" ? 4 - (column % 4) : 1;
  return column;
}

class MarkdownTokenizer extends Tokenizer {
  override blockquote(source: string): Tokens.Blockquote | undefined {
    const quote = this.rules.block.blockquote.exec(source);
    if (quote) {
      // Check every lazy line before Marked removes quote prefixes and batches lines.
      // Prefixed list markers still belong to the quote, even after a lazy text line.
      for (const line of quote[0].split("\n")) {
        if (!/^ {0,3}>/.test(line) && listOpening.test(line))
          fail("List block in an unprefixed quote continuation is unsupported");
      }
    }
    return super.blockquote(source);
  }

  override fences(source: string): Tokens.Code | undefined {
    const token = super.fences(source);
    if (token) {
      // Marked only compensates fully indented backtick-fence content lines.
      // Use the raw content capture for both fence spellings and partial indentation.
      const content = (this.rules.block.fences.exec(token.raw) as RegExpExecArray)[3] ?? "";
      const indent = (/^ */.exec(token.raw) as RegExpExecArray)[0].length;
      token.text = content.replace(/^[ \t]*/gm, (padding) => {
        let column = 0;
        let offset = 0;
        while (column < indent && offset < padding.length) {
          column += padding[offset] === "\t" ? 4 - (column % 4) : 1;
          offset++;
        }
        // Expand only a tab crossing the boundary; later tabs stay literal code.
        return " ".repeat(Math.max(0, column - indent)) + padding.slice(offset);
      });
    }
    return token;
  }

  override list(source: string): Tokens.List | undefined {
    const token = super.list(source);
    if (token) {
      for (const item of token.items) {
        const opening = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t]*)([^\n]*)/.exec(
          item.raw,
        ) as RegExpExecArray;
        const markerWidth = (opening[1] as string).length;
        const padding = columns((opening[1] as string) + opening[2]) - markerWidth;
        const indent = markerWidth + (!opening[3] || padding > 4 ? 1 : padding);
        for (const line of item.raw.split("\n").slice(1)) {
          const underline = /^([ \t]*)(?:=+|-+)[ \t]*$/.exec(line);
          // Marked discards list indentation before recognizing setext headings.
          // Reject underlines that only entered the item as lazy paragraph text.
          if (underline && columns(underline[1] as string) < indent)
            fail("Lazy list setext underlines are unsupported");
        }
      }
    }
    return token;
  }
}

class MarkdownLexer extends Lexer {
  constructor() {
    const tokenizer = new MarkdownTokenizer();
    super({ gfm: true, tokenizer });
    // Marked requires a second character after marker whitespace. An empty first line
    // is also a list item; keep this correction local to this lexer instance.
    tokenizer.rules = {
      ...tokenizer.rules,
      block: {
        ...tokenizer.rules.block,
        list: listOpening,
      },
    };
  }

  override blockTokens(source: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[];
  override blockTokens(
    source: string,
    tokens?: TokensList,
    lastParagraphClipped?: boolean,
  ): TokensList;
  override blockTokens(source: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[] {
    // Marked appends unprefixed quote lines even after headings and rules.
    // Only an existing paragraph can receive a lazy continuation.
    if (
      lastParagraphClipped &&
      tokens?.length &&
      (tokens[tokens.length - 1] as Token).type !== "paragraph"
    ) {
      fail("Non-paragraph block quote continuation is unsupported");
    }
    // Marked disables paragraph parsing inside list items. Keep its paragraph-interruption
    // rules active there too, so a non-1 ordered marker remains continuation text.
    this.state.top = true;
    return super.blockTokens(source, tokens, lastParagraphClipped);
  }
}

function inline(tokens: Token[], marks: DocsMark[], depth: number, paragraph = false): DocsNode[] {
  depthGuard(depth);
  const source = tokens.map((token) => token.raw).join("");
  // Marked may retain tab-only blank lines inside one inline block.
  // Reject before trimming tabs could erase the paragraph boundary.
  if (/\n *\t[ \t]*\n/.test(source)) fail("Tab-only blank lines within a block are unsupported");
  let offset = 0;
  const bareLinks = tokens.flatMap((token) => {
    const start = offset;
    offset += token.raw.length;
    return token.type === "link" && !/^[[<]/.test(token.raw) ? [{ start, end: offset }] : [];
  });
  if (bareLinks.length) {
    // Re-lex the whole inline source: GFM may end a URL before its closing emphasis delimiter.
    offset = 0;
    for (const token of Lexer.lexInline(source, {
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
          const adjacent = tokens[index + 1];
          // Splitting a shared run between triple and single emphasis can also
          // consume literal delimiters, as in ***alpha****beta* (or its reverse).
          if (
            token.type === "em" &&
            adjacent?.type === "em" &&
            adjacent.raw.startsWith(delimiter) &&
            token.raw.startsWith(delimiter.repeat(3)) !==
              adjacent.raw.startsWith(delimiter.repeat(3))
          ) {
            fail("Adjacent emphasis with shared delimiter runs is unsupported");
          }
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
function list(token: Tokens.List, depth: number, tabbedQuote: boolean): DocsNode {
  for (const item of token.items) {
    if (item.raw.includes("\t")) {
      // Marked expands tabs while dedenting lists, before code handlers can see them.
      // Check original item text and finalized inline tokens; code spans are affected too.
      walkTokens(item.tokens, (child) => {
        if (child.type === "code" || child.type === "codespan")
          fail("Code in a tabbed list item is unsupported");
      });
    }
  }
  const items = token.items.map(taskItem);
  const task = items.some((item) => item.checked !== undefined);
  if (task && (token.ordered || items.some((item) => item.checked === undefined)))
    fail("Mixed or ordered task lists are unsupported");
  return block(
    task ? "taskList" : token.ordered ? "orderedList" : "bulletList",
    items.map((item) => {
      const children = blocks(item.tokens, depth + 1, tabbedQuote);
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
function blocks(tokens: Token[], depth: number, tabbedQuote = false): DocsNode[] {
  depthGuard(depth);
  return tokens.flatMap((entry, index): DocsNode[] => {
    const token = entry as MarkedToken;
    switch (token.type) {
      case "space":
        return [];
      case "def":
        if (/\\&/.test(token.raw)) fail("Escaped link character references are unsupported");
        if (token.tag.startsWith("^")) fail("Footnotes are unsupported");
        return [];
      case "paragraph": {
        // Marked misses setext headings with indented or numbered continuations.
        // It may keep the underline as text, or start a new rule, list or heading.
        const next = tokens[index + 1];
        const numbered = next?.type === "list" && next.ordered && next.start !== 1;
        const raw = token.raw + (numbered ? next.raw : "");
        const after = tokens[index + (numbered ? 2 : 1)];
        if (
          /\n(?: {4}| {0,3}\t| {0,3}\d{1,9}[.)][ \t])/.test(raw) &&
          (raw
            .split("\n")
            .slice(1)
            .some((line) => setextUnderline.test(line)) ||
            setextUnderline.test(after?.raw ?? "") ||
            (after?.type === "heading" && !/^ {0,3}#/.test(after.raw)))
        ) {
          fail("Setext headings with indented or numbered continuation lines are unsupported");
        }
        return [block("paragraph", inline(token.tokens, [], depth + 1, true))];
      }
      case "heading":
        if (token.depth > 3) fail("Docs supports heading levels 1–3");
        return [block("heading", inline(token.tokens, [], depth + 1), { level: token.depth })];
      case "hr":
        return [block("horizontalRule")];
      case "blockquote": {
        const content = blocks(
          token.tokens,
          depth + 1,
          tabbedQuote || /^ {0,3}>[\t ]*\t/m.test(token.raw),
        );
        return [block("blockquote", content.length ? content : [block("paragraph")])];
      }
      case "code": {
        if (token.lang && !/^[\w+-]+$/.test(token.lang)) fail("Code fence metadata is unsupported");
        // Quote removal changes tab stops, and lists may expand the tabs before this point.
        if (token.codeBlockStyle === "indented" && tabbedQuote)
          fail("Indented code in a quote with tab indentation is unsupported");
        // A tab following up to three spaces completes the four-column structural indent.
        // Marked removes those spaces first; use raw source to leave only actual code tabs.
        const value =
          token.codeBlockStyle === "indented"
            ? token.raw.replace(/^(?: {0,3}\t| {1,4})/gm, "").replace(/\n+$/, "")
            : token.text;
        return [block("codeBlock", text(value), token.lang ? { language: token.lang } : undefined)];
      }
      case "list":
        return [list(token, depth, tabbedQuote)];
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
    const content = blocks(new MarkdownLexer().lex(normalized), 0);
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
