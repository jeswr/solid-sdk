// AUTHORED-BY Codex
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import { decodeHtmlEntities, flattenExtensions, getSchema, type JSONContent } from "@tiptap/react";
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
  return text.replace(/[\p{P}\p{S}\s]/gu, (char) => `&#${char.codePointAt(0)};`);
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

/** Resolve whole mark runs before placeholders hide their whitespace/punctuation. */
function prepareEmphasis(nodes: JSONContent[]): JSONContent[] {
  const code = (node: JSONContent) => !!node.marks?.some((mark) => mark.type === "code");
  // Inline code is atomic: its edge spaces belong inside the code span.
  const text = nodes
    .map((node) => {
      const value = node.text ?? "\0";
      return code(node) ? "x".repeat(value.length) : value;
    })
    .join("");
  const runs: { type: string; start: number; end: number; code: boolean; html: boolean }[] = [];
  for (const type of Object.keys(emphasisSyntax)) {
    let position = 0;
    let current: (typeof runs)[number] | undefined;
    for (const node of nodes) {
      const end = position + (node.text ?? "\0").length;
      if (node.type === "text" && node.marks?.some((mark) => mark.type === type)) {
        if (current) {
          current.end = end;
          current.code ||= code(node);
        } else {
          current = { type, start: position, end, code: code(node), html: false };
          runs.push(current);
        }
      } else current = undefined;
      position = end;
    }
  }
  if (!runs.length) return nodes;
  for (const run of runs) {
    const value = text.slice(run.start, run.end);
    run.start += value.length - value.trimStart().length;
    run.end -= value.length - value.trimEnd().length;
  }
  const punctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);
  const whitespace = (char: string) => !char || /\s/u.test(char);
  for (const run of runs) {
    const core = Array.from(text.slice(run.start, run.end));
    const first = core[0] ?? "";
    const last = core.at(-1) ?? "";
    const before = Array.from(text.slice(0, run.start)).at(-1) ?? "";
    const after = Array.from(text.slice(run.end))[0] ?? "";
    // CommonMark flanking rules. Touching/overlapping runs and code use HTML
    // too, so their delimiters cannot combine into a different mark sequence.
    run.html =
      run.code ||
      // Marked's delimiter scanner can split astral edge characters into surrogates.
      first.length > 1 ||
      last.length > 1 ||
      before.length > 1 ||
      after.length > 1 ||
      (punctuation(first) && !whitespace(before) && !punctuation(before)) ||
      (punctuation(last) && !whitespace(after) && !punctuation(after)) ||
      runs.some((other) => other !== run && other.start <= run.end && other.end >= run.start);
  }
  let position = 0;
  return nodes.flatMap((node) => {
    const start = position;
    position += (node.text ?? "\0").length;
    if (!node.text) return [node];
    const cuts = [...new Set([start, position, ...runs.flatMap((run) => [run.start, run.end])])]
      .filter((cut) => cut >= start && cut <= position)
      .sort((a, b) => a - b);
    return cuts.slice(0, -1).map((from, index) => {
      const to = cuts[index + 1] as number;
      return {
        ...node,
        text: (node.text as string).slice(from - start, to - start),
        marks: (node.marks ?? []).flatMap((mark) => {
          if (!emphasisSyntax[mark.type]) return [mark];
          const run = runs.find(
            (range) => range.type === mark.type && range.start <= from && range.end >= to,
          );
          return run ? [{ ...mark, attrs: { ...mark.attrs, docsHtml: run.html } }] : [];
        }),
      };
    });
  });
}

// These serializers receive protected, context-escaped attributes from export.
// Keep StarterKit's schema while decoding entities in parsed URL/title attrs.
const customExtensions = flattenExtensions([StarterKit, Highlight])
  .filter((extension) =>
    ["codeBlock", "link", ...Object.keys(emphasisSyntax)].includes(extension.name),
  )
  .map((extension) => {
    const syntax = emphasisSyntax[extension.name];
    if (syntax)
      return extension.extend({
        renderMarkdown(node, helpers) {
          const text = helpers.renderChildren(node);
          return node.attrs?.docsHtml
            ? `<${syntax.tag}>${text}</${syntax.tag}>`
            : `${syntax.delimiter}${text}${syntax.delimiter}`;
        },
      });
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
          renderMarkdown(node, helpers) {
            return `[${helpers.renderChildren(node)}](${node.attrs?.href}${node.attrs?.title})`;
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
const markdown = new MarkdownManager({ extensions, markedOptions: { gfm: true } });
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
    const html = !!node.marks?.some((mark) => mark.attrs?.docsHtml);
    if (node.text && !code && node.marks?.some((mark) => mark.type === "code")) {
      // Protect the complete span: the upstream mark serializer moves edge
      // whitespace outside marks, including code, before rendering delimiters.
      result.text = literal(
        html ? `<code>${escapeHtmlText(node.text)}</code>` : inlineCode(node.text),
      );
      result.marks = node.marks.filter((mark) => mark.type !== "code");
    } else if (node.text && !code) {
      result.text = literal(
        html
          ? escapeHtmlText(node.text)
          : escapeText(node.text, !!node.marks?.some((mark) => mark.type === "link"), table),
      );
    }
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
    if (result.marks)
      result.marks = result.marks.map((mark) =>
        mark.type === "link"
          ? {
              ...mark,
              attrs: {
                ...mark.attrs,
                href: attribute(destination(String(mark.attrs?.href))),
                title: attribute(titleSuffix(String(mark.attrs?.title ?? ""))),
              },
            }
          : mark,
      );
    if (node.content)
      result.content = (code ? node.content : prepareEmphasis(node.content)).map((child) =>
        protect(child, code, table),
      );
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
