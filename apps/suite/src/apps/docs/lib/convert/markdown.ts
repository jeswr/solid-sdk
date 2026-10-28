// AUTHORED-BY Codex
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import {
  decodeHtmlEntities,
  Extension,
  flattenExtensions,
  getSchema,
  type JSONContent,
  type MarkdownToken,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { compatibleCodeExtensions } from "../editor/code-mark";
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

const emphasisSyntax: Record<string, { delimiter: string; tag: string }> = {
  bold: { delimiter: "**", tag: "strong" },
  italic: { delimiter: "*", tag: "em" },
  strike: { delimiter: "~~", tag: "del" },
  highlight: { delimiter: "==", tag: "mark" },
};

type InlineMark = NonNullable<JSONContent["marks"]>[number];
type InlineTree = { text: string } | { mark: InlineMark; children: InlineTree[] };
const markPriority = ["link", "bold", "italic", "strike", "highlight", "code"];

/** Turn identical-mark runs into a tree, closing/reopening at the common prefix. */
function inlineTree(nodes: JSONContent[]): InlineTree[] {
  const roots: InlineTree[] = [];
  let stack: Extract<InlineTree, { mark: InlineMark }>[] = [];
  for (const node of nodes) {
    const marks = (node.marks ?? [])
      .filter((mark) => markPriority.includes(mark.type))
      .toSorted((a, b) => markPriority.indexOf(a.type) - markPriority.indexOf(b.type));
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

function serializeInline(nodes: JSONContent[], table: boolean): string {
  const tree = inlineTree(nodes);
  const text = tree.map(treeText).join("");
  const punctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);
  const whitespace = (char: string) => !char || /\s/u.test(char);
  let position = 0;
  // A connected sequence of nested/touching marks uses one HTML context. Mixing
  // Markdown into HTML would make the HTML parser treat delimiters as text.
  const html = tree.some((branch, index) => {
    const value = treeText(branch);
    const start = position;
    position += value.length;
    if ("text" in branch) return false;
    if (branch.children.some((child) => "mark" in child)) return true;
    const next = tree[index + 1];
    if (
      next &&
      "mark" in next &&
      emphasisSyntax[branch.mark.type] &&
      emphasisSyntax[next.mark.type]
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
      (punctuation(last) && !whitespace(after) && !punctuation(after)) ||
      (branch.mark.type === "highlight" && value.includes("="))
    );
  });
  const render = (branch: InlineTree, label = false): string => {
    if ("text" in branch)
      return html ? escapeHtmlText(branch.text) : escapeText(branch.text, label, table);
    const { mark, children } = branch;
    const value = children.map((child) => render(child, mark.type === "link")).join("");
    if (html) {
      if (mark.type === "link") {
        const attrs: Record<string, unknown> = {
          ...mark.attrs,
          href: encodeUrlControls(String(mark.attrs?.href)),
        };
        const attributes = ["href", "title", "target", "rel", "class"]
          .filter((key) => attrs[key] != null)
          .map((key) => ` ${key}="${htmlAttribute(String(attrs[key]))}"`)
          .join("");
        return `<a${attributes}>${value}</a>`;
      }
      const tag =
        mark.type === "code" ? "code" : (emphasisSyntax[mark.type] as { tag: string }).tag;
      return `<${tag}>${value}</${tag}>`;
    }
    if (mark.type === "code") return inlineCode(children.map(treeText).join(""));
    if (mark.type === "link") {
      const attrs = `${destination(String(mark.attrs?.href))}${titleSuffix(String(mark.attrs?.title ?? ""))}`;
      return `[${value}](${table ? attrs.replace(/\|/g, "&#x7C;") : attrs})`;
    }
    const delimiter = (emphasisSyntax[mark.type] as { delimiter: string }).delimiter;
    return `${delimiter}${value}${delimiter}`;
  };
  const result = tree.map((branch) => render(branch)).join("");
  // The wrapper preserves paragraph-edge whitespace and keeps the entire HTML
  // fragment in one parse, including spaces between adjacent inline elements.
  return html ? `<span>${result}</span>` : result;
}

// These serializers receive protected, context-escaped attributes from export.
// Keep StarterKit's schema while decoding entities in parsed URL/title attrs.
const customExtensions = flattenExtensions([StarterKit, Highlight])
  .filter((extension) =>
    ["codeBlock", "link", ...Object.keys(emphasisSyntax)].includes(extension.name),
  )
  .map((extension) => {
    const syntax = emphasisSyntax[extension.name];
    if (syntax) return extension;
    return extension.name === "link"
      ? extension.extend({
          parseMarkdown(token, helpers) {
            // Marked supplies inline tokens for every link, including empty labels.
            return helpers.applyMark(
              "link",
              helpers.parseInline(token.tokens as NonNullable<typeof token.tokens>),
              {
                href: decodeHtmlEntities(token.href),
                title: token.title ? decodeHtmlEntities(token.title) : null,
              },
            );
          },
        })
      : extension.extend({
          renderMarkdown(node, helpers) {
            const content = helpers.renderChildren(node.content ?? []);
            const fence = "`".repeat(Math.max(3, longestRun(content, /^ {0,3}`+/gm) + 1));
            return `${fence}${node.attrs?.language ?? ""}\n${content}\n${fence}`;
          },
        });
  });
const extensions = [
  StarterKit.configure({
    link: false,
    codeBlock: false,
    code: false,
    bold: false,
    italic: false,
    strike: false,
  }),
  ...compatibleCodeExtensions,
  ...customExtensions,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.extend({
    parseMarkdown(token, helpers) {
      return helpers.createNode("image", {
        src: decodeHtmlEntities(token.href),
        alt: helpers
          .parseInline(token.tokens as NonNullable<typeof token.tokens>)
          .map(textContent)
          .join(""),
        title: token.title ? decodeHtmlEntities(token.title) : null,
      });
    },
    renderMarkdown(node) {
      return `![${node.attrs?.alt}](${node.attrs?.src}${node.attrs?.title})`;
    },
  }),
];
function parseHtml(token: MarkdownToken): JSONContent[] {
  if (typeof window === "undefined") return [];
  const dom = new window.DOMParser().parseFromString(token.text as string, "text/html");
  const parser = SchemaDOMParser.fromSchema(schema);
  // Keep unrecognized HTML inert, matching the upstream importer's fallback.
  const unknown = Array.from(dom.body.querySelectorAll("*")).some(
    (element) =>
      element.tagName !== "SPAN" &&
      !parser.rules.some((rule) => "tag" in rule && !!rule.tag && element.matches(rule.tag)),
  );
  if (unknown) return token.block ? [] : [{ type: "text", text: token.text as string }];
  const parsed = parser
    .parse(dom.body, {
      preserveWhitespace: "full",
    })
    .toJSON() as JSONContent;
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
      const opening = /^<(a|b|strong|em|i|s|strike|del|code|mark|span)\b/i.exec(source);
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
  "Underline and alignment are omitted. Nested tables are flattened. Highlights use ==text==. Images link to their absolute URL.";

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

function clean(node: JSONContent, dropHighlights: boolean, tableDepth = 0): JSONContent {
  const result = { ...node };
  if (result.attrs) {
    result.attrs = { ...result.attrs };
    delete result.attrs.textAlign;
  }
  if (result.marks)
    result.marks = result.marks.filter(
      (mark) =>
        !["underline", "comment"].includes(mark.type) &&
        !(dropHighlights && mark.type === "highlight") &&
        (mark.type !== "link" || safeDestination(String(mark.attrs?.href))),
    );
  if (
    result.type === "image" &&
    (!/^https?:\/\//.test(String(result.attrs?.src)) || !safeDestination(String(result.attrs?.src)))
  ) {
    return { type: "paragraph" };
  }
  if (result.type === "table" && tableDepth > 0) {
    return { type: "paragraph", content: [{ type: "text", text: textContent(result) }] };
  }
  if (result.content)
    result.content = result.content.flatMap((child) =>
      splitImages(clean(child, dropHighlights, tableDepth + (result.type === "table" ? 1 : 0))),
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
    const code = inCode || node.type === "codeBlock";
    const table = inTable || node.type === "table";
    const attribute = (text: string) =>
      literal(table ? text.replace(/\|/g, (char) => `&#${char.charCodeAt(0)};`) : text);
    const result = { ...node };
    if (node.type === "image") {
      result.attrs = {
        ...node.attrs,
        alt: literal(escapeText(String(node.attrs?.alt ?? ""), true, table)),
        src: attribute(destination(String(node.attrs?.src))),
        title: attribute(titleSuffix(String(node.attrs?.title ?? ""))),
      };
    }
    if (node.type === "codeBlock" && node.attrs?.language) {
      result.attrs = {
        ...node.attrs,
        language: literal(
          String(node.attrs.language).replace(/[`\r\n]/g, (char) => `&#${char.charCodeAt(0)};`),
        ),
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
  return markdown
    .serialize(protect(clean(json, dropHighlights)))
    .replace(
      new RegExp(`${prefix}(\\d+)END`, "g"),
      (_, index: string) => escapes[Number(index)] as string,
    );
}
export function importMarkdown(source: string, fileName: string) {
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES)
    throw new Error("Choose a file of 50 MB or less");
  let title = fileName.replace(/\.(md|markdown)$/i, "");
  let body = source.replace(/^\uFEFF/, "");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if (frontMatter) {
    const value = /^title:\s*(.+)$/m.exec(String(frontMatter[1]))?.[1]?.trim();
    if (value) title = value.replace(/^(['"])(.*)\1$/, "$2");
    body = body.slice(frontMatter[0].length);
  }
  // Parse into the schema's inert nodes, then sanitize URLs and strip unsupported attrs.
  // Sanitizing the Markdown source as HTML would destroy code samples and autolinks.
  const json = clean(markdown.parse(body), false);
  const parsed = schema.nodeFromJSON(json);
  parsed.check();
  return { title: title.slice(0, 200), json: parsed.toJSON() as JSONContent };
}
