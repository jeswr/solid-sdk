// AUTHORED-BY Codex
import { MarkdownManager } from "@tiptap/markdown";
import { DOMParser as SchemaDOMParser, type TagParseRule } from "@tiptap/pm/model";
import {
  Extension,
  flattenExtensions,
  getSchema,
  type JSONContent,
  type MarkdownLexerConfiguration,
  type MarkdownParseHelpers,
  type MarkdownRendererHelpers,
  type MarkdownToken,
} from "@tiptap/react";
import sanitizeHtml from "sanitize-html";
import { baseExtensions } from "../../editor/extensions";
import { normaliseDestination } from "../editor/destination";
import { MAX_IMPORT_BYTES } from "./docx-import";
import { normaliseImport } from "./schema";
import { reportSkipped, type SkippedItem } from "./skipped";

// Decode source, never an already-unescaped token. A single pass gives escaped
// punctuation priority over references: \&copy; stays &copy;, \\&copy; becomes \©,
// and &amp;copy; is not decoded twice. Call only in CommonMark string contexts;
// code, autolinks and raw HTML have their own rules.
// The installed HTML parser supplies the complete HTML5 named-reference table.
function decodeMarkdownString(value: string): string {
  return value.replace(
    /\\([!-/:-@[-`{-~])|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]*);/g,
    (reference, punctuation: string | undefined) => {
      if (punctuation) return punctuation;
      let decoded = "";
      // The matched reference cannot contain quotes or markup. Reading a decoded
      // attribute avoids interpreting decoded '<' or '&' as another round of HTML.
      sanitizeHtml(`<span title="${reference}"></span>`, {
        transformTags: {
          span: (tagName, attribs) => {
            decoded = attribs.title as string;
            return { tagName, attribs };
          },
        },
      });
      return decoded;
    },
  );
}

function longestRun(text: string, pattern: RegExp): number {
  let longest = 0;
  for (const match of text.matchAll(pattern)) longest = Math.max(longest, match[0].trim().length);
  return longest;
}

function escapeText(text: string, label: boolean, table: boolean): string {
  const escaped = text.replace(
    /^[ ]+|[ ]+$|[\\`*_[\]<>!#.+()~=|:@&-]|(?! )[\s\p{Cf}]/gmu,
    (value) =>
      Array.from(value, (char) => {
        // Protect whitespace before Markdown can trim it, expand tabs in lists,
        // or reinterpret Unicode separators in headings, tasks and tables.
        // Entities keep label delimiters inert during boundary recognition.
        return /[\s\p{Cf}:@&]/u.test(char) || (label && /[\\[\]]/.test(char))
          ? `&#${char.codePointAt(0)};`
          : `\\${char}`;
      }).join(""),
  );
  return table ? escaped.replace(/ /g, "&#32;") : escaped;
}

function escapeHtmlText(text: string): string {
  // HTML fallback contents are parsed as HTML, where Markdown escapes are literal.
  // Encode label delimiters too: an HTML span can itself be inside a Markdown link.
  return text.replace(/[\p{P}\p{S}]|(?! )[\s\p{Cf}]/gu, (char) => `&#${char.codePointAt(0)};`);
}

function encodeUrlControls(url: string): string {
  return url.replace(/[<>\r\n\t]/g, encodeURIComponent);
}
function safeDestination(url: string): boolean {
  return normaliseDestination(url) !== null;
}
function destination(url: string): string {
  const escaped = encodeUrlControls(url).replace(/\\/g, "\\\\").replace(/&/g, "&amp;");
  return /[ ()]/.test(url) ? `<${escaped}>` : escaped;
}
function titleSuffix(title: string): string {
  if (!title) return "";
  const quote = title.includes('"') && !title.includes("'") ? "'" : '"';
  const escaped = title.replace(/[\\&\r\n]|["']/g, (char) => {
    if (/[&\r\n]/.test(char)) return `&#${char.charCodeAt(0)};`;
    return char === "\\" || char === quote ? `\\${char}` : char;
  });
  return ` ${quote}${escaped}${quote}`;
}
function inlineCode(text: string): string {
  const delimiter = "`".repeat(longestRun(text, /`+/g) + 1);
  // CommonMark strips one space per edge only when both edges have spaces
  // and the content is not entirely spaces.
  const padding =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text))
      ? " "
      : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

// Attribute inventories are checked against the live editor schema in tests.
// A new schema type/attribute needs an explicit export decision here.
export const MARKDOWN_NODE_RULES: Record<string, { tag: string; attributes: string[] }> = {
  doc: { tag: "", attributes: [] },
  text: { tag: "", attributes: [] },
  paragraph: { tag: "p", attributes: ["textAlign"] },
  heading: { tag: "h", attributes: ["textAlign", "level"] },
  blockquote: { tag: "blockquote", attributes: [] },
  bulletList: { tag: "ul", attributes: [] },
  orderedList: { tag: "ol", attributes: ["start", "type"] },
  listItem: { tag: "li", attributes: [] },
  taskList: { tag: "ul", attributes: [] },
  taskItem: { tag: "li", attributes: ["checked"] },
  codeBlock: { tag: "pre", attributes: ["language"] },
  hardBreak: { tag: "br", attributes: [] },
  horizontalRule: { tag: "hr", attributes: [] },
  image: { tag: "img", attributes: ["src", "alt", "title", "width", "height"] },
  table: { tag: "table", attributes: [] },
  tableRow: { tag: "tr", attributes: [] },
  tableCell: { tag: "td", attributes: ["colspan", "rowspan", "colwidth", "align"] },
  tableHeader: { tag: "th", attributes: ["colspan", "rowspan", "colwidth", "align"] },
};
export const MARKDOWN_MARK_RULES: Record<
  string,
  { delimiter?: string; tag: string; attributes: string[] }
> = {
  link: { tag: "a", attributes: ["href", "target", "rel", "class", "title"] },
  bold: { delimiter: "**", tag: "strong", attributes: [] },
  italic: { delimiter: "*", tag: "em", attributes: [] },
  strike: { delimiter: "~~", tag: "del", attributes: [] },
  highlight: { tag: "mark", attributes: [] },
  underline: { tag: "u", attributes: [] },
  subscript: { tag: "sub", attributes: [] },
  superscript: { tag: "sup", attributes: [] },
  code: { tag: "code", attributes: [] },
};

type InlineMark = NonNullable<JSONContent["marks"]>[number];
type InlineTree = { text: string } | { mark: InlineMark; children: InlineTree[] };
const markPriority = Object.keys(MARKDOWN_MARK_RULES);

/** Turn identical-mark runs into a tree, closing/reopening at the common prefix. */
function inlineTree(nodes: JSONContent[]): InlineTree[] {
  const roots: InlineTree[] = [];
  let stack: Extract<InlineTree, { mark: InlineMark }>[] = [];
  for (const node of nodes) {
    const marks = (node.marks ?? []).toSorted(
      (a, b) => markPriority.indexOf(a.type) - markPriority.indexOf(b.type),
    );
    let common = 0;
    while (
      common < stack.length &&
      common < marks.length &&
      JSON.stringify(stack[common]?.mark) === JSON.stringify(marks[common])
    )
      common++;
    stack = stack.slice(0, common);
    let children = stack.at(-1)?.children ?? roots;
    for (const mark of marks.slice(common)) {
      const branch = { mark, children: [] as InlineTree[] };
      children.push(branch);
      stack.push(branch);
      children = branch.children;
    }
    const previous = children.at(-1);
    if (previous && "text" in previous) previous.text += node.text;
    else children.push({ text: node.text as string });
  }
  return roots;
}

function treeText(tree: InlineTree): string {
  return "text" in tree ? tree.text : tree.children.map(treeText).join("");
}

function htmlAttribute(text: string): string {
  return text.replace(/[&"<>|\r\n\t]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function serializeInline(nodes: JSONContent[], table: boolean, htmlContext = false): string {
  const tree = inlineTree(nodes);
  const text = tree.map(treeText).join("");
  const punctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);
  const whitespace = (char: string) => !char || /\s/u.test(char);
  let position = 0;
  // A connected sequence of nested/touching marks uses one HTML context. Mixing
  // Markdown into HTML would make the HTML parser treat delimiters as text.
  const html =
    htmlContext ||
    tree.some((branch, index) => {
      const value = treeText(branch);
      const start = position;
      position += value.length;
      if ("text" in branch) return false;
      // List lexers expand tabs inside code spans; Unicode line separators also
      // disrupt heading/table lexers. Keep significant whitespace in HTML.
      if (
        htmlOnlyMark(branch.mark) ||
        (branch.mark.type === "code" && /[^\S ]|\p{Cf}/u.test(value))
      )
        return true;
      if (branch.children.some((child) => "mark" in child)) return true;
      const next = tree[index + 1];
      if (
        next &&
        "mark" in next &&
        MARKDOWN_MARK_RULES[branch.mark.type]?.delimiter &&
        MARKDOWN_MARK_RULES[next.mark.type]?.delimiter
      )
        return true;
      if (branch.mark.type === "code" || branch.mark.type === "link") return false;
      const first = Array.from(value)[0] ?? "";
      const last = Array.from(value).at(-1) ?? "";
      const before = Array.from(text.slice(0, start)).at(-1) ?? "";
      const after = Array.from(text.slice(position))[0] ?? "";
      return (
        value.trim() !== value ||
        !value ||
        first.length > 1 ||
        last.length > 1 ||
        before.length > 1 ||
        after.length > 1 ||
        (punctuation(first) && !whitespace(before) && !punctuation(before)) ||
        (punctuation(last) && !whitespace(after) && !punctuation(after))
      );
    });
  const render = (branch: InlineTree, label = false): string => {
    if ("text" in branch)
      return html ? escapeHtmlText(branch.text) : escapeText(branch.text, label, table);
    const { mark, children } = branch;
    const value = children.map((child) => render(child, mark.type === "link")).join("");
    if (html) return htmlMark(mark, value);
    if (mark.type === "code") return inlineCode(children.map(treeText).join(""));
    if (mark.type === "link") {
      const attrs = `${destination(String(mark.attrs?.href))}${titleSuffix(String(mark.attrs?.title ?? ""))}`;
      return `[${value}](${table ? attrs.replace(/\|/g, "&#x7C;") : attrs})`;
    }
    const delimiter = MARKDOWN_MARK_RULES[mark.type]?.delimiter as string;
    return `${delimiter}${value}${delimiter}`;
  };
  const result = tree.map((branch) => render(branch)).join("");
  // The wrapper preserves paragraph-edge whitespace and keeps the entire HTML
  // fragment in one parse, including spaces between adjacent inline elements.
  return html && !htmlContext ? `<span>${result}</span>` : result;
}

function htmlOnlyMark(mark: InlineMark): boolean {
  if (!["link", "code"].includes(mark.type)) return !MARKDOWN_MARK_RULES[mark.type]?.delimiter;
  return (
    mark.type === "link" &&
    (mark.attrs?.title === "" ||
      ["target", "rel", "class"].some(
        (key) =>
          mark.attrs?.[key] !== undefined &&
          mark.attrs[key] !== schema.marks.link?.spec.attrs?.[key]?.default,
      ))
  );
}

function attributes(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ` ${key}="${htmlAttribute(String(value))}"`)
    .join("");
}

function htmlMark(mark: InlineMark, value: string): string {
  const rule = MARKDOWN_MARK_RULES[mark.type] as { tag: string; attributes: string[] };
  const attrs = Object.fromEntries(rule.attributes.map((key) => [key, mark.attrs?.[key]]));
  if (mark.type === "link") attrs.href = encodeUrlControls(String(attrs.href));
  return `<${rule.tag}${attributes(attrs)}${exactAttributes(mark, true)}>${value}</${rule.tag}>`;
}

// HTML attributes cannot distinguish numbers from strings, or an explicit null
// from a missing attribute with a non-null schema default. Retain those values
// alongside ordinary HTML; import only accepts attributes declared by the schema.
function exactAttributes(node: JSONContent | InlineMark, mark = false): string {
  const type = (mark ? schema.marks : schema.nodes)[node.type as string];
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([key, value]) => value !== type?.spec.attrs?.[key]?.default,
    ),
  );
  return Object.keys(attrs).length ? attributes({ "data-docs-attrs": JSON.stringify(attrs) }) : "";
}

function htmlNode(node: JSONContent): string {
  if (node.type === "text") return serializeInline([node], false, true);
  const rule = MARKDOWN_NODE_RULES[node.type as string] as { tag: string };
  const tag = node.type === "heading" ? `h${node.attrs?.level}` : rule.tag;
  const attrs: Record<string, unknown> = {};
  if (node.attrs?.textAlign != null) attrs.style = `text-align: ${node.attrs.textAlign}`;
  if (node.type === "orderedList")
    Object.assign(attrs, { start: node.attrs?.start, type: node.attrs?.type });
  if (node.type === "taskList" || node.type === "taskItem") attrs["data-type"] = node.type;
  if (node.type === "taskItem") attrs["data-checked"] = node.attrs?.checked ?? false;
  if (["tableCell", "tableHeader"].includes(String(node.type))) {
    for (const key of ["colspan", "rowspan", "colwidth", "align"]) attrs[key] = node.attrs?.[key];
  }
  if (node.type === "image") {
    for (const key of ["src", "alt", "title", "width", "height"]) attrs[key] = node.attrs?.[key];
    attrs.src = encodeUrlControls(String(attrs.src));
  }
  let body = (node.content ?? []).map(htmlNode).join("");
  if (node.type === "codeBlock") {
    body = `<code${attributes({ class: node.attrs?.language ? `language-${node.attrs.language}` : null })}>${body}</code>`;
  }
  const opening = `<${tag}${attributes(attrs)}${exactAttributes(node)}>`;
  const closing = !["br", "hr", "img"].includes(tag) ? `</${tag}>` : "";
  let result = opening + body + closing;
  for (const mark of node.marks ?? []) result = htmlMark(mark, result);
  return result;
}

function gfmTable(node: JSONContent): boolean {
  const rows = node.content ?? [];
  const width = rows[0]?.content?.length;
  return (
    !!width &&
    rows.every(
      (row, rowIndex) =>
        row.content?.length === width &&
        row.content.every((cell, index) => {
          const attrs = cell.attrs;
          const paragraph = cell.content?.[0];
          return (
            cell.type === (rowIndex === 0 ? "tableHeader" : "tableCell") &&
            (attrs?.colspan ?? 1) === 1 &&
            (attrs?.rowspan ?? 1) === 1 &&
            attrs?.colwidth == null &&
            (attrs?.align ?? null) === (rows[0]?.content?.[index]?.attrs?.align ?? null) &&
            cell.content?.length === 1 &&
            paragraph?.type === "paragraph" &&
            paragraph.attrs?.textAlign == null &&
            !(paragraph.content ?? []).some(needsHtml)
          );
        }),
    )
  );
}

function needsHtml(node: JSONContent): boolean {
  if (node.type === "text") return false;
  if (node.marks?.length || node.attrs?.textAlign != null) return true;
  if (node.type === "table") return !gfmTable(node);
  if (["paragraph", "heading"].includes(String(node.type)) && !node.content?.length) return true;
  if (
    ["paragraph", "heading"].includes(String(node.type)) &&
    node.content?.some(
      (child, index, content) =>
        child.type === "hardBreak" &&
        (node.type === "heading" ||
          index === 0 ||
          index === content.length - 1 ||
          content[index + 1]?.type === "hardBreak"),
    )
  )
    return true;
  if (node.type === "image")
    return (
      node.attrs?.width != null ||
      node.attrs?.height != null ||
      node.attrs?.alt === null ||
      node.attrs?.title === ""
    );
  if (node.type === "orderedList" && node.attrs?.type != null) return true;
  if (node.type === "codeBlock")
    return (
      node.attrs?.language === "" ||
      /[`\s]/.test(String(node.attrs?.language ?? "")) ||
      // Container lexers can reinterpret Unicode whitespace (including line
      // separators) even inside fences. Ordinary spaces and LF are safe.
      /[^\S \n]|\p{Cf}/u.test(textContent(node))
    );
  const children = node.content ?? [];
  // Containers can hold both Markdown blocks and complete HTML fallbacks.
  // Prefix their rendered lines rather than forcing all descendants into HTML.
  if (["blockquote", "bulletList", "orderedList", "taskList"].includes(String(node.type)))
    return false;
  return (
    node.type !== "doc" &&
    (children.some((child, index) => touchingBlocks(child, children[index + 1])) ||
      children.some(needsHtml))
  );
}

function touchingBlocks(node: JSONContent, next: JSONContent | undefined): boolean {
  return (
    !!next &&
    ((/List$/.test(String(node.type)) && /List$/.test(String(next.type))) ||
      (node.type === "blockquote" && next.type === "blockquote"))
  );
}

function checkRules(node: JSONContent): void {
  if (!MARKDOWN_NODE_RULES[node.type as string])
    throw new Error(`No Markdown export rule for node ${node.type}`);
  for (const mark of node.marks ?? []) {
    if (!MARKDOWN_MARK_RULES[mark.type])
      throw new Error(`No Markdown export rule for mark ${mark.type}`);
  }
  for (const child of node.content ?? []) checkRules(child);
}

/** CommonMark tab stops apply to indentation, never to the remainder of a line. */
function indentation(line: string, start: number): number {
  let column = start;
  for (const char of line) {
    if (char === " ") column++;
    else if (char === "\t") column += 4 - (column % 4);
    else break;
  }
  return column - start;
}

function stripIndent(line: string, columns: number, start: number): string {
  let column = start;
  let offset = 0;
  while (offset < line.length && column < start + columns) {
    const char = line[offset];
    if (char === " ") column++;
    else if (char === "\t") column += 4 - (column % 4);
    else break;
    offset++;
  }
  // A container can consume only part of a structural tab. Its unused columns
  // become indentation; tabs after that boundary remain original characters.
  return " ".repeat(Math.max(0, column - start - columns)) + line.slice(offset);
}

// Tab stops retain their original column while nested containers are removed.
let containerColumn = 0;
function atColumn<T>(column: number, parse: () => T): T {
  const previous = containerColumn;
  containerColumn = column;
  try {
    return parse();
  } finally {
    containerColumn = previous;
  }
}

/** A disposable view for boundary detection; content always comes from source. */
function containerBoundaries(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const prefix = (/^[ \t]*(?:(?:[*+-]|\d{1,9}[.)])[ \t]+)?/.exec(line) as RegExpExecArray)[0];
      let column = containerColumn;
      const expanded = prefix.replace(/./g, (char) => {
        const width = char === "\t" ? 4 - (column % 4) : 1;
        column += width;
        return char === "\t" ? " ".repeat(width) : char;
      });
      return expanded + line.slice(prefix.length);
    })
    .join("\n");
}

function listItemSource(raw: string): { text: string; indent: number } {
  const lines = raw.replace(/\n$/, "").split("\n");
  const first = lines[0] as string;
  const marker = /^([ \t]*)([*+-]|\d{1,9}[.)])/.exec(first) as RegExpExecArray;
  const after = first.slice(marker[0].length);
  const markerWidth = indentation(first, containerColumn) + (marker[2] as string).length;
  const start = containerColumn + markerWidth;
  const padding = indentation(after, start);
  const width = padding > 4 || !after.replace(/^[ \t]*/, "") ? 1 : padding;
  const indent = markerWidth + width;
  return {
    indent,
    text: [
      stripIndent(after, width, start),
      ...lines
        .slice(1)
        .map((line) =>
          indentation(line, containerColumn) >= indent
            ? stripIndent(line, indent, containerColumn)
            : line,
        ),
    ].join("\n"),
  };
}

// JavaScript's multiline ^ also matches Unicode line/paragraph separators.
// CommonMark container prefixes begin only at the start of input or after LF.
const quotePrefix = /(?<=^|\n) {0,3}>[ \t]?/g;

// Use exactly the live editor's nodes, marks and attributes. Only Markdown
// handlers are overridden; HTML parsing still comes from the editor schema.
const extensions = flattenExtensions(baseExtensions(globalThis.fetch))
  .map((extension) => extension.extend({ addExtensions: () => [] }))
  .map((extension) => {
    if (["taskList", "orderedList"].includes(extension.name))
      extension = extension.extend({
        // Use CommonMark's list lexer: the upstream line-based tokenizers split
        // hard breaks and continuation blocks away from the first paragraph.
        markdownTokenizer: {
          name: extension.name,
          level: "block",
          start: () => -1,
          tokenize: () => undefined,
        },
        markdownTokenName: extension.name === "taskList" ? "docsTaskList" : "list",
      });
    if (extension.name === "bulletList")
      return extension.extend({
        markdownTokenName: "docsList",
        markdownTokenizer: {
          name: "docsList",
          level: "block",
          start: () => -1,
          tokenize(source: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
            if (!/^[ \t]*(?:[*+-]|\d{1,9}[.)])(?=[ \t]|\n|$)/.test(source)) return;
            // Delegate list boundaries to CommonMark without the upstream
            // line-based list tokenizers or their shared lexer state.
            const tokenizer = new markdown.instance.Tokenizer();
            tokenizer.lexer = new markdown.instance.Lexer({ gfm: true, tokenizer });
            // A task marker is independent of its label's first character.
            // Clone the rules so other lexer instances keep their own grammar.
            tokenizer.rules = {
              ...tokenizer.rules,
              other: {
                ...tokenizer.rules.other,
                blockquoteSetextReplace2: quotePrefix,
                listIsTask: /^\[[ xX]\](?:[ \t]|$)/,
                listReplaceTask: /^\[[ xX]\](?:[ \t]|$)/,
              },
            };
            const token = tokenizer.list(containerBoundaries(source));
            if (!token) return;
            // Marked expands every tab in item.text and trimEnd() also drops
            // code's trailing whitespace. Use it only for container boundaries;
            // recover the content from its untouched source instead.
            const lines = source.split("\n");
            let lineOffset = 0;
            for (const item of token.items) {
              const newline = item.raw.endsWith("\n") ? "\n" : "";
              const count = item.raw.replace(/\n$/, "").split("\n").length;
              item.raw = lines.slice(lineOffset, lineOffset + count).join("\n") + newline;
              lineOffset += count;
            }
            token.raw = lines.slice(0, lineOffset).join("\n");
            return {
              ...token,
              type: "docsList",
              items: token.items.map((item) => {
                const { text: original, indent } = listItemSource(item.raw);
                const text = item.task ? original.replace(/^\[[ xX]\](?:[ \t]|$)/, "") : original;
                return {
                  ...item,
                  text,
                  tokens: atColumn(containerColumn + indent, () => lexer.blockTokens(text)),
                };
              }),
            };
          },
        },
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          const groups: JSONContent[] = [];
          for (const [index, item] of (token.items as MarkdownToken[]).entries()) {
            const type = item.task ? "taskList" : token.ordered ? "orderedList" : "bulletList";
            let group = groups.at(-1);
            if (group?.type !== type) {
              group = {
                type,
                ...(type === "orderedList"
                  ? { attrs: { start: Number(token.start) + index } }
                  : {}),
                content: [],
              };
              groups.push(group);
            }
            const content = (
              helpers.parseBlockChildren as NonNullable<typeof helpers.parseBlockChildren>
            )(item.tokens as MarkdownToken[]);
            if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
            group.content?.push({
              type: item.task ? "taskItem" : "listItem",
              ...(item.task ? { attrs: { checked: item.checked } } : {}),
              content,
            });
          }
          return groups;
        },
      });
    if (extension.name === "link")
      return extension.configure({ isAllowedUri: safeDestination }).extend({
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          return helpers.applyMark(
            "link",
            helpers.parseInline(token.tokens as NonNullable<typeof token.tokens>),
            {
              href: token.href,
              title: token.title || null,
            },
          );
        },
      });
    if (extension.name === "code")
      return extension.extend({
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          if (/\n/.test(token.raw as string))
            reportSkipped(mappingSkipped, "Code span line breaks converted to spaces");
          return helpers.applyMark("code", [{ type: "text", text: token.text as string }]);
        },
      });
    if (extension.name === "codeBlock")
      return extension.extend({
        // Marked already classified this block. Tiptap's raw.startsWith fence
        // guard rejects valid fences with indentation, including structural tabs.
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          return helpers.createNode(
            "codeBlock",
            { language: token.lang || null },
            token.text ? [helpers.createTextNode(token.text)] : [],
          );
        },
        renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
          const content = helpers.renderChildren(node.content ?? []);
          const fence = "`".repeat(Math.max(3, longestRun(content, /^ {0,3}`+/gm) + 1));
          return `${fence}${node.attrs?.language ?? ""}\n${content}\n${fence}`;
        },
      });
    if (extension.type === "node" && extension.name === "image")
      return extension.extend({
        parseHTML() {
          return [
            {
              tag: "img[src]",
              getAttrs: (element: HTMLElement) => {
                const src = element.getAttribute("src") as string;
                return /^https?:/.test(src) && safeDestination(src) ? null : false;
              },
            },
          ];
        },
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          return helpers.createNode("image", {
            src: token.href,
            alt: helpers
              .parseInline(token.tokens as NonNullable<typeof token.tokens>)
              .map(textContent)
              .join(""),
            title: token.title || null,
          });
        },
        renderMarkdown(node: JSONContent) {
          return `![${node.attrs?.alt}](${node.attrs?.src}${node.attrs?.title})`;
        },
      });
    return extension;
  });
// MarkdownManager parses synchronously; this report belongs to the current import.
let mappingSkipped: SkippedItem[] = [];
function parseHtml(token: MarkdownToken): JSONContent[] {
  if (typeof window === "undefined") return [];
  const dom = new window.DOMParser().parseFromString(
    (token.text as string).trimEnd().replace(/(<\/?h)[4-6](?=[\s>])/gi, "$13"),
    "text/html",
  );
  const rules = SchemaDOMParser.fromSchema(schema).rules;
  const parser = new SchemaDOMParser(
    schema,
    rules.map((rule) => {
      if (!rule.tag) return rule;
      // Tiptap injects getAttrs into every tag rule, merging its declared attrs.
      const original = rule.getAttrs as NonNullable<TagParseRule["getAttrs"]>;
      return {
        ...rule,
        getAttrs(element: HTMLElement) {
          const attrs = original(element);
          if (attrs === false) return false;
          const encoded = element.getAttribute("data-docs-attrs");
          if (!encoded) return attrs;
          let stored: unknown;
          try {
            stored = JSON.parse(encoded);
          } catch {
            return attrs;
          }
          const type = rule.node ? schema.nodes[rule.node] : schema.marks[rule.mark as string];
          const accepted = Object.fromEntries(
            Object.entries(type?.spec.attrs ?? {})
              .filter(
                ([key]) =>
                  stored !== null && typeof stored === "object" && Object.hasOwn(stored, key),
              )
              .map(([key]) => [key, (stored as Record<string, unknown>)[key]]),
          );
          return { ...attrs, ...accepted };
        },
      };
    }),
  );
  // Keep unrecognized HTML inert, matching the upstream importer's fallback.
  if (dom.head.childElementCount) reportSkipped(mappingSkipped, "Unsupported HTML");
  const unknown = Array.from(dom.body.querySelectorAll("*")).some(
    (element) =>
      !["SPAN", "TBODY", "THEAD", "TFOOT"].includes(element.tagName) &&
      !parser.rules.some((rule) => "tag" in rule && !!rule.tag && element.matches(rule.tag)),
  );
  if (unknown) {
    if (token.block) reportSkipped(mappingSkipped, "Unsupported HTML");
    return token.block ? [] : [{ type: "text", text: token.text as string }];
  }
  // ProseMirror normalizes CR/CRLF even with preserveWhitespace: "full".
  // Protect decoded carriage returns before it sees the DOM, avoiding literal
  // sentinel collisions, then restore them in the parsed text nodes.
  let carriage = "DOCSCARRIAGERETURN";
  while (dom.body.textContent?.includes(carriage)) carriage += "X";
  const walker = dom.createTreeWalker(dom.body, window.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    node.textContent = (node.textContent as string).replace(/\r/g, carriage);
  }
  const parsed = parser
    .parse(dom.body, {
      preserveWhitespace: "full",
    })
    .toJSON() as JSONContent;
  const restore = (node: JSONContent) => {
    if (node.text) node.text = node.text.replaceAll(carriage, "\r");
    for (const child of node.content ?? []) restore(child);
  };
  restore(parsed);
  const content = parsed.content as JSONContent[];
  return token.block
    ? content
    : content.flatMap((node) => (node.type === "paragraph" ? (node.content ?? []) : [node]));
}

// Tiptap's default HTML bridge trims fragment edges. Parse complete inline
// elements with full whitespace preservation, including nested equal-name tags.
const inlineHtml = Extension.create({
  name: "docsInlineHtml",
  markdownTokenizer: {
    name: "docsInlineHtml",
    level: "inline",
    start: (source: string) => source.indexOf("<"),
    tokenize(source) {
      if (typeof window === "undefined") return;
      const opening = /^<(a|b|strong|em|i|s|strike|del|code|mark|u|sub|sup|span)\b/i.exec(source);
      if (!opening) return;
      const tags = /<\/?([a-z][\w-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
      let depth = 0;
      for (const tag of source.matchAll(tags)) {
        if (tag[1]?.toLowerCase() !== opening[1]?.toLowerCase()) continue;
        depth += tag[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
          const raw = source.slice(0, tag.index + tag[0].length);
          return { type: "docsInlineHtml", raw, text: raw };
        }
      }
    },
  },
  parseMarkdown: parseHtml,
});
const markdown = new MarkdownManager({
  extensions: [
    ...extensions,
    Extension.create({
      name: "docsEntity",
      markdownTokenizer: {
        name: "docsEntity",
        level: "inline",
        start: (source) => source.indexOf("&"),
        tokenize(source) {
          // Consume even a literal '&' here so Tiptap cannot subsequently decode
          // an invalid or overlong numeric reference using its looser rules.
          const match = /^&(?:(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]*);)?/.exec(
            source,
          );
          if (!match) return;
          return { type: "docsEntity", raw: match[0], text: decodeMarkdownString(match[0]) };
        },
      },
      parseMarkdown: (token, helpers) => helpers.createTextNode(token.text as string),
    }),
    inlineHtml,
    Extension.create({
      name: "docsBlockHtml",
      markdownTokenName: "html",
      parseMarkdown: parseHtml,
    }),
  ],
  markedOptions: { gfm: true },
});
markdown.instance.use({
  tokenizer: {
    link(source) {
      // Keep marked's boundary recognition, but suppress its early attribute
      // unescaping and extra label-bracket unescaping. Inline label parsing uses
      // the real lexer and performs its own single escape/reference pass.
      const rules = {
        ...this.rules,
        inline: { ...this.rules.inline, anyPunctuation: /(?!)/g },
        other: { ...this.rules.other, outputLinkReplace: /(?!)/g },
      };
      const token = markdown.instance.Tokenizer.prototype.link.call({ ...this, rules }, source);
      if (!token) return;
      token.href = decodeMarkdownString(token.href);
      token.title = token.title ? decodeMarkdownString(token.title) : null;
      return token;
    },
    def(source) {
      const rules = {
        ...this.rules,
        inline: { ...this.rules.inline, anyPunctuation: /(?!)/g },
      };
      const token = markdown.instance.Tokenizer.prototype.def.call({ ...this, rules }, source);
      if (!token) return;
      token.href = decodeMarkdownString(token.href);
      token.title = token.title ? decodeMarkdownString(token.title) : token.title;
      return token;
    },
    reflink(source, links) {
      const rules = {
        ...this.rules,
        other: { ...this.rules.other, outputLinkReplace: /(?!)/g },
      };
      // Definitions already contain decoded attributes. Do not decode them again.
      return markdown.instance.Tokenizer.prototype.reflink.call({ ...this, rules }, source, links);
    },
    autolink(source) {
      const token = markdown.instance.Tokenizer.prototype.autolink.call(this, source);
      if (!token) return;
      // CommonMark autolinks do not interpret escapes or character references.
      // Bypass Tiptap's unconditional entity decoding of ordinary text tokens.
      token.tokens = [{ type: "docsEntity", raw: token.text, text: token.text }];
      return token;
    },
    inlineText(source) {
      const token = markdown.instance.Tokenizer.prototype.inlineText.call(
        this,
        source,
      ) as NonNullable<ReturnType<typeof this.inlineText>>;
      // CommonMark discards whitespace on either side of a soft line break.
      // Doing this in prose tokens leaves multiline code spans untouched.
      token.text = token.text.replace(/[ \t]*\n[ \t]*/g, "\n");
      return token;
    },
    blockquote(source) {
      if (!/^[ \t]*>/.test(source)) return;
      // Boundary detection uses a separate lexer. Re-entering this configured
      // lexer here would parse each nested quote twice at every depth.
      const tokenizer = new markdown.instance.Tokenizer();
      tokenizer.lexer = new markdown.instance.Lexer({ gfm: true, tokenizer });
      tokenizer.rules = {
        ...tokenizer.rules,
        other: { ...tokenizer.rules.other, blockquoteSetextReplace2: quotePrefix },
      };
      // The code tokenizer already handled indentation of four or more columns;
      // a remaining quote prefix always matches, and its raw excludes final LF.
      const token = tokenizer.blockquote(containerBoundaries(source)) as NonNullable<
        ReturnType<typeof tokenizer.blockquote>
      >;
      const count = token.raw.split("\n").length;
      token.raw = source.split("\n").slice(0, count).join("\n");
      const marker = (/^[ \t]*>[ \t]?/.exec(token.raw) as RegExpExecArray)[0];
      const indent = indentation(marker, containerColumn) + 1 + (marker.endsWith(">") ? 0 : 1);
      const text = token.raw
        .replace(this.rules.other.blockquoteSetextReplace, "\n    $1")
        .replace(/(?<=^|\n)[ \t]*>[ \t]?/g, (prefix) => {
          const leading = indentation(prefix, containerColumn);
          if (leading > 3) return prefix;
          return stripIndent(
            prefix.slice(prefix.indexOf(">") + 1),
            1,
            containerColumn + leading + 1,
          );
        });
      const top = this.lexer.state.top;
      this.lexer.state.top = true;
      token.tokens = atColumn(containerColumn + indent, () => this.lexer.blockTokens(text));
      this.lexer.state.top = top;
      token.text = text;
      return token;
    },
    code(source) {
      if (indentation(source, containerColumn) < 4) return;
      // Blank lines were consumed by the lexer before this indentation check.
      const token = markdown.instance.Tokenizer.prototype.code.call(this, source) as NonNullable<
        ReturnType<typeof this.code>
      >;
      token.text = token.raw
        .split("\n")
        .map((line) => stripIndent(line, 4, containerColumn))
        .join("\n")
        .replace(/\n+$/, "");
      return token;
    },
    fences(source) {
      if (!/^[ \t]*(?:`{3,}|~{3,})/.test(source)) return;
      const boundaries = containerBoundaries(source);
      const token = markdown.instance.Tokenizer.prototype.fences.call(this, boundaries);
      if (!token) return;
      const match = this.rules.block.fences.exec(boundaries) as RegExpExecArray;
      token.lang = decodeMarkdownString((match[2] as string).trim());
      const lines = source.split("\n");
      const newline = token.raw.endsWith("\n") ? "\n" : "";
      const count = token.raw.replace(/\n$/, "").split("\n").length;
      token.raw = lines.slice(0, count).join("\n") + newline;
      const body = match[3] ?? "";
      const indent = indentation(source, containerColumn);
      token.text = body
        ? lines
            .slice(1, body.split("\n").length + 1)
            .map((line) => stripIndent(line, indent, containerColumn))
            .join("\n")
        : "";
      return token;
    },
  },
});
const schema = getSchema(extensions);
export const MARKDOWN_NOTES =
  "Formatting uses GFM where lossless and HTML for richer content. Images link to their absolute URL.";

/** Markdown images are inline tokens; the editor's images are block nodes. */
function splitImages(node: JSONContent): JSONContent[] {
  if (!["paragraph", "heading"].includes(String(node.type)) || !node.content) return [node];
  const blocks: JSONContent[] = [];
  let inline: JSONContent[] = [];
  const flush = () => {
    if (inline.length) blocks.push({ ...node, content: inline });
    inline = [];
  };
  for (const child of node.content) {
    // Sanitizing an unsafe image also produces a block (an empty paragraph).
    if (["image", "paragraph"].includes(String(child.type))) {
      flush();
      blocks.push(child);
    } else inline.push(child);
  }
  flush();
  return blocks.length ? blocks : [node];
}

function clean(
  node: JSONContent,
  dropHighlights: boolean,
  skipped: SkippedItem[] = [],
): JSONContent {
  const result = { ...node };
  if (result.marks)
    result.marks = result.marks.filter((mark) => {
      const keep =
        mark.type !== "comment" &&
        !(dropHighlights && mark.type === "highlight") &&
        (mark.type !== "link" || safeDestination(String(mark.attrs?.href)));
      if (!keep) reportSkipped(skipped, "Unsupported marks");
      return keep;
    });
  if (
    result.type === "image" &&
    (!/^https?:\/\//.test(String(result.attrs?.src)) || !safeDestination(String(result.attrs?.src)))
  ) {
    reportSkipped(skipped, "Unsafe images");
    return { type: "paragraph" };
  }
  if (result.content)
    result.content = result.content.flatMap((child) =>
      splitImages(clean(child, dropHighlights, skipped)),
    );
  if (
    ["listItem", "taskItem"].includes(String(result.type)) &&
    result.content?.[0]?.type === "image"
  )
    result.content.unshift({ type: "paragraph" });
  return result;
}
function textContent(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(textContent).join(" ");
}

/** Compose containers inside-out, prefixing every physical continuation line. */
function containerPrefix(content: string, first: string, continuation: string): string {
  return content
    .split("\n")
    .map((line, index) =>
      index === 0 ? first + line : line ? continuation + line : continuation.trimEnd(),
    )
    .join("\n");
}

export function exportMarkdown(json: JSONContent, dropHighlights = false): string {
  // The upstream serializer escapes inline delimiters but leaves block syntax
  // and edge whitespace literal. Protect text before serializing, then restore
  // its escapes afterwards so the serializer cannot double-escape them or
  // collapse whitespace. Labels, destinations, titles and code have distinct
  // escaping rules; protect each before it reaches the upstream serializer.
  let prefix = "DOCSLITERAL";
  const source = JSON.stringify(json);
  while (source.includes(prefix)) prefix += "X";
  const escapes: string[] = [];
  const literal = (text: string) => `${prefix}${escapes.push(text) - 1}END`;
  const protect = (node: JSONContent, inCode = false, inTable = false): JSONContent => {
    // render() already handled HTML fallbacks and container boundaries. A GFM
    // table's empty cell paragraphs must stay cells rather than placeholders.
    if (node.type === "hardBreak")
      return { type: "text", text: literal(inTable ? "<br>" : "\\\n") };
    const code = inCode || node.type === "codeBlock";
    const table = inTable || node.type === "table";
    const result = { ...node };
    if (node.type === "image") {
      result.attrs = {
        ...node.attrs,
        alt: literal(escapeText(String(node.attrs?.alt ?? ""), true, table)),
        src: literal(destination(String(node.attrs?.src))),
        title: literal(titleSuffix(String(node.attrs?.title ?? ""))),
      };
    }
    if (node.type === "codeBlock" && node.attrs?.language) {
      result.attrs = {
        ...node.attrs,
        language: literal(escapeText(String(node.attrs.language), false, false)),
      };
    }
    if (node.content) {
      const content: JSONContent[] = [];
      let run: JSONContent[] = [];
      const flush = () => {
        if (run.length) content.push({ type: "text", text: literal(serializeInline(run, table)) });
        run = [];
      };
      for (const child of node.content) {
        if (!code && child.type === "text") run.push(child);
        else {
          flush();
          content.push(protect(child, code, table));
        }
      }
      flush();
      result.content = content;
    }
    return result;
  };
  const cleaned = clean(json, dropHighlights);
  checkRules(cleaned);
  const blocks = (content: JSONContent[]): string =>
    content
      .map((child, index) =>
        touchingBlocks(child, content[index + 1]) ? htmlNode(child) : render(child),
      )
      .join("\n\n");
  const render = (node: JSONContent): string => {
    if (needsHtml(node)) return htmlNode(node);
    const content = node.content ?? [];
    if (node.type === "doc") return blocks(content);
    if (node.type === "blockquote") return containerPrefix(blocks(content), "> ", "> ");
    if (["bulletList", "orderedList", "taskList"].includes(String(node.type)))
      return content
        .map((item, index) => {
          const marker =
            node.type === "taskList"
              ? `- [${item.attrs?.checked ? "x" : " "}] `
              : node.type === "orderedList"
                ? `${Number(node.attrs?.start ?? 1) + index}. `
                : "- ";
          return containerPrefix(
            blocks(item.content as JSONContent[]),
            marker,
            // A task checkbox is inline content, outside the list marker width.
            " ".repeat(node.type === "taskList" ? 2 : marker.length),
          );
        })
        .join("\n");
    if (node.type === "horizontalRule") return "***";
    // Restore literals before any parent container adds its prefixes.
    return markdown
      .serialize(protect(node))
      .replace(
        new RegExp(`${prefix}(\\d+)END`, "g"),
        (_, index: string) => escapes[Number(index)] as string,
      );
  };
  return render(cleaned);
}

/**
 * Dependency-free, conservative YAML subset: flat scalar mappings and JSON
 * flow values. Unsupported YAML stays visible as Markdown rather than being
 * silently discarded. In particular, a delimited scalar is never metadata.
 */
function frontMatterMapping(source: string): Map<string, unknown> | undefined {
  const entries = new Map<string, unknown>();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const pair = /^([\w-]+):(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (!pair || entries.has(pair[1] as string)) return;
    const key = pair[1] as string;
    const input = (pair[2] ?? "").trim();
    const quoted = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')(?:[ \t]+#.*)?$/.exec(input);
    if (/^["']/.test(input) && !quoted) return;
    const raw = quoted ? (quoted[1] as string) : input.replace(/(?:^|[ \t]+)#.*$/, "").trim();
    let value: unknown = raw;
    if (/^["[{]/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        return;
      }
    } else if (raw.startsWith("'")) {
      value = raw.slice(1, -1).replaceAll("''", "'");
    } else {
      // Reserved indicators, mapping separators and unsupported YAML features
      // cannot be accepted as plain scalar values.
      if (/^[!&*\]}|>@`%]|^[-?:](?:\s|$)|:(?:\s|$)/.test(raw)) return;
      if (/^(?:null|~|true|false|[-+]?\d+(?:\.\d+)?)$/i.test(raw) || !raw) value = null;
    }
    entries.set(key, value);
  }
  return entries.size ? entries : undefined;
}

export function importMarkdown(source: string, fileName: string) {
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES)
    throw new Error("Choose a file of 50 MB or less");
  let title = fileName.replace(/\.(md|markdown)$/i, "");
  let body = source.replace(/^\uFEFF/, "");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(body);
  const metadata = frontMatter && frontMatterMapping(frontMatter[1] as string);
  if (frontMatter && metadata) {
    const value = metadata.get("title");
    if (typeof value === "string" && value) title = value;
    body = body.slice(frontMatter[0].length);
  }
  // Parse into the schema's inert nodes, then sanitize URLs and strip unsupported attrs.
  // Sanitizing the Markdown source as HTML would destroy code samples and autolinks.
  mappingSkipped = [];
  if (/\r/.test(body)) reportSkipped(mappingSkipped, "Carriage returns converted to line feeds");
  const json = clean(markdown.parse(body), false, mappingSkipped);
  if (!json.content?.length) json.content = [{ type: "paragraph" }];
  return { title: title.slice(0, 200), ...normaliseImport(json, mappingSkipped) };
}
