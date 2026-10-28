// AUTHORED-BY Codex
import { MarkdownManager } from "@tiptap/markdown";
import { DOMParser as SchemaDOMParser, type TagParseRule } from "@tiptap/pm/model";
import {
  decodeHtmlEntities,
  Extension,
  flattenExtensions,
  getSchema,
  type JSONContent,
  type MarkdownLexerConfiguration,
  type MarkdownParseHelpers,
  type MarkdownToken,
} from "@tiptap/react";
import { baseExtensions } from "../../editor/extensions";
import { validLink } from "../editor/logic";
import { MAX_IMPORT_BYTES } from "./docx-import";

function longestRun(text: string, pattern: RegExp): number {
  let longest = 0;
  for (const match of text.matchAll(pattern)) longest = Math.max(longest, match[0].trim().length);
  return longest;
}

function escapeText(text: string, label: boolean, table: boolean): string {
  const escaped = text.replace(/^[ \t]+|[ \t]+$|[\\`*_[\]<>!#.+()~=|:@&\-\n\r\t]/gm, (value) =>
    Array.from(value, (char) => {
      // Entities avoid the label parser's extra bracket-unescaping pass.
      return /[ \t\n\r:@&]/.test(char) || (label && /[\\[\]]/.test(char))
        ? `&#${char.charCodeAt(0)};`
        : `\\${char}`;
    }).join(""),
  );
  return table ? escaped.replace(/ /g, "&#32;") : escaped;
}

function escapeHtmlText(text: string): string {
  // HTML fallback contents are parsed as HTML, where Markdown escapes are literal.
  // Encode label delimiters too: an HTML span can itself be inside a Markdown link.
  return text.replace(/[\p{P}\p{S}\t\r\n]/gu, (char) => `&#${char.codePointAt(0)};`);
}

function encodeUrlControls(url: string): string {
  return url.replace(/[<>\r\n\t]/g, encodeURIComponent);
}
function safeDestination(url: string): boolean {
  return !!validLink(encodeUrlControls(url).replace(/ /g, "%20"));
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
      if (htmlOnlyMark(branch.mark) || (branch.mark.type === "code" && /[\r\n]/.test(value)))
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
      /[\r\t]/.test(textContent(node))
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
            // Delegate list boundaries to CommonMark without the upstream
            // line-based list tokenizers or their shared lexer state.
            const tokenizer = new markdown.instance.Tokenizer();
            tokenizer.lexer = new markdown.instance.Lexer({ gfm: true, tokenizer });
            const token = tokenizer.list(source);
            if (!token) return;
            return {
              ...token,
              type: "docsList",
              items: token.items.map((item) => ({
                ...item,
                // CommonMark already removed the list's content offset.
                // Keep all remaining indentation, including fenced code lines.
                tokens: lexer.blockTokens(item.text),
              })),
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
              href: decodeHtmlEntities(token.href),
              title: token.title ? decodeHtmlEntities(token.title) : null,
            },
          );
        },
      });
    if (extension.name === "codeBlock")
      return extension.extend({
        renderMarkdown(node, helpers) {
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
            src: decodeHtmlEntities(token.href),
            alt: helpers
              .parseInline(token.tokens as NonNullable<typeof token.tokens>)
              .map(textContent)
              .join(""),
            title: token.title ? decodeHtmlEntities(token.title) : null,
          });
        },
        renderMarkdown(node: JSONContent) {
          return `![${node.attrs?.alt}](${node.attrs?.src}${node.attrs?.title})`;
        },
      });
    return extension;
  });
function parseHtml(token: MarkdownToken): JSONContent[] {
  if (typeof window === "undefined") return [];
  const dom = new window.DOMParser().parseFromString((token.text as string).trimEnd(), "text/html");
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
  const unknown = Array.from(dom.body.querySelectorAll("*")).some(
    (element) =>
      !["SPAN", "TBODY", "THEAD", "TFOOT"].includes(element.tagName) &&
      !parser.rules.some((rule) => "tag" in rule && !!rule.tag && element.matches(rule.tag)),
  );
  if (unknown) return token.block ? [] : [{ type: "text", text: token.text as string }];
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
    inlineHtml,
    Extension.create({
      name: "docsBlockHtml",
      markdownTokenName: "html",
      parseMarkdown: parseHtml,
    }),
  ],
  markedOptions: { gfm: true },
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

function clean(node: JSONContent, dropHighlights: boolean): JSONContent {
  const result = { ...node };
  if (result.marks)
    result.marks = result.marks.filter(
      (mark) =>
        mark.type !== "comment" &&
        !(dropHighlights && mark.type === "highlight") &&
        (mark.type !== "link" || safeDestination(String(mark.attrs?.href))),
    );
  if (
    result.type === "image" &&
    (!/^https?:\/\//.test(String(result.attrs?.src)) || !safeDestination(String(result.attrs?.src)))
  ) {
    return { type: "paragraph" };
  }
  if (result.content)
    result.content = result.content.flatMap((child) => splitImages(clean(child, dropHighlights)));
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
        language: literal(String(node.attrs.language)),
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
  const json = clean(markdown.parse(body), false);
  if (!json.content?.length) json.content = [{ type: "paragraph" }];
  const parsed = schema.nodeFromJSON(json);
  parsed.check();
  return { title: title.slice(0, 200), json: parsed.toJSON() as JSONContent };
}
