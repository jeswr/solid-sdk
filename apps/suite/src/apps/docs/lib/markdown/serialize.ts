// AUTHORED-BY Codex GPT-6.1-Sol
import { markdownToDocs } from "./parse";
import {
  block,
  checkString,
  depthGuard,
  fail,
  mergeText,
  safeLink,
  same,
  sortedMarks,
  text,
} from "./shared";
import { type DocsMark, type DocsNode, MarkdownError } from "./types";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MarkdownError("invalid-input", "Expected a JSON object");
  }
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unsupported JSON field or attribute");
}
function mark(value: unknown): DocsMark {
  const source = object(value);
  keys(source, ["type", "attrs"]);
  const attrs = source.attrs === undefined ? {} : object(source.attrs);
  if (source.type === "link") {
    keys(attrs, ["href", "title"]);
    checkString(attrs.href);
    safeLink(attrs.href);
    if (attrs.title !== undefined && attrs.title !== null) checkString(attrs.title);
    return {
      type: "link",
      attrs: { href: attrs.href, ...(attrs.title ? { title: attrs.title } : {}) },
    };
  }
  keys(attrs, []);
  if (source.type !== "bold" && source.type !== "italic" && source.type !== "code")
    fail("Unsupported Docs mark");
  return { type: source.type };
}
const inlineTypes = ["text", "hardBreak"];
const blockTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "taskList",
];
function normalize(value: unknown, depth: number): DocsNode {
  depthGuard(depth);
  const source = object(value);
  keys(source, ["type", "attrs", "content", "text", "marks"]);
  if (typeof source.type !== "string") fail("Missing Docs node type");
  const type = source.type;
  const attrs = source.attrs === undefined ? {} : object(source.attrs);
  const attributeNames: Record<string, string[]> = {
    heading: ["level"],
    orderedList: ["start"],
    taskItem: ["checked"],
    codeBlock: ["language"],
  };
  keys(attrs, Object.hasOwn(attributeNames, type) ? (attributeNames[type] as string[]) : []);
  if (type === "text") {
    if (source.content !== undefined) fail("Text nodes cannot have content");
    checkString(source.text);
    if (!source.text) fail("Empty text nodes are invalid");
    if (source.marks !== undefined && !Array.isArray(source.marks)) fail("Marks must be an array");
    const marks = sortedMarks(((source.marks ?? []) as unknown[]).map(mark));
    if (new Set(marks.map((item) => item.type)).size !== marks.length)
      fail("Duplicate marks are invalid");
    return text(source.text, marks)[0] as DocsNode;
  }
  if (source.text !== undefined || source.marks !== undefined)
    fail("Only text nodes may carry text or marks");
  if (source.content !== undefined && !Array.isArray(source.content))
    fail("Content must be an array");
  const content = mergeText(
    ((source.content ?? []) as unknown[]).map((child) => normalize(child, depth + 1)),
  );
  switch (type) {
    case "doc":
    case "blockquote":
    case "listItem":
    case "taskItem":
      if (content.some((child) => !blockTypes.includes(child.type))) fail("Expected block content");
      if (type !== "doc" && !content.length) fail("Container cannot be empty");
      if ((type === "listItem" || type === "taskItem") && content[0]?.type !== "paragraph")
        fail("List items must start with a paragraph");
      if (type === "taskItem") {
        if (typeof attrs.checked !== "boolean") fail("Task item requires checked boolean");
        return block(type, content, { checked: attrs.checked });
      }
      return block(type, content.length ? content : [block("paragraph")]);
    case "paragraph":
    case "heading":
      if (content.some((child) => !inlineTypes.includes(child.type)))
        fail("Expected inline content");
      if (type === "heading") {
        if (![1, 2, 3].includes(attrs.level as number)) fail("Docs supports heading levels 1–3");
        return block(type, content, { level: attrs.level });
      }
      return block(type, content);
    case "codeBlock":
      if (content.some((child) => child.type !== "text" || child.marks))
        fail("Code blocks require unmarked text");
      if (attrs.language !== undefined && attrs.language !== null && attrs.language !== "") {
        if (typeof attrs.language !== "string" || !/^[\w+-]+$/.test(attrs.language))
          fail("Invalid code language");
        return block(type, content, { language: attrs.language });
      }
      return block(type, content);
    case "horizontalRule":
    case "hardBreak":
      if (content.length) fail("Leaf nodes cannot have children");
      return block(type);
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const itemType = type === "taskList" ? "taskItem" : "listItem";
      if (!content.length || content.some((child) => child.type !== itemType))
        fail("Invalid list content");
      if (type === "orderedList") {
        const start = attrs.start ?? 1;
        if (!Number.isInteger(start) || (start as number) < 0 || (start as number) > 999_999_999)
          fail("Invalid list start");
        return block(type, content, { start });
      }
      return block(type, content);
    }
    default:
      return fail("Unsupported Docs node");
  }
}
function escapeText(value: string): string {
  // Escape all ASCII punctuation so text never becomes Markdown structure or an entity.
  return value.replace(/[!-/:-@[\x5b-\x60{-~]/g, "\\$&");
}
function code(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  const pad = /^`|`$|^ [\s\S]* $/.test(value) && /\S/.test(value) ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}
function attributeText(value: string): string {
  return value.replace(/[&"\\]/g, (character) => `&#${character.charCodeAt(0)};`);
}
function close(mark: DocsMark): string {
  switch (mark.type) {
    case "link": {
      const attrs = mark.attrs as ObjectValue;
      const title = attrs.title ? ` "${attributeText(attrs.title as string)}"` : "";
      return `](<${attributeText(attrs.href as string)}>${title})`;
    }
    case "bold":
      return "**";
    default:
      return "_";
  }
}
function inline(content: DocsNode[]): string {
  let result = "";
  for (let index = 0; index < content.length; ) {
    const node = content[index] as DocsNode;
    const candidates = (node.marks ?? []).filter((item) => item.type !== "code");
    let chosen: DocsMark | undefined;
    let end = index;
    for (const candidate of candidates) {
      let next = index;
      while (next < content.length && content[next]?.marks?.some((item) => same(item, candidate)))
        next++;
      if (next > end) {
        chosen = candidate;
        end = next;
      }
    }
    if (chosen) {
      const selected = chosen;
      const body = inline(
        content.slice(index, end).map((child) => ({
          ...child,
          marks: (child.marks as DocsMark[]).filter((item) => !same(item, selected)),
        })),
      );
      result += (selected.type === "link" ? "[" : close(selected)) + body + close(selected);
      index = end;
    } else {
      if (node.type === "hardBreak") result += "\\\n";
      else if (node.marks?.some((item) => item.type === "code"))
        result += code(node.text as string);
      else result += escapeText(node.text as string);
      index++;
    }
  }
  return result;
}

function render(node: DocsNode): string {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return inline(content);
    case "heading":
      return `${"#".repeat(node.attrs?.level as number)} ${inline(content)}`;
    case "horizontalRule":
      return "---";
    case "codeBlock": {
      const value = content.map((child) => child.text).join("");
      const runs = value.match(/`+/g) ?? [];
      const fence = "`".repeat(Math.max(2, ...runs.map((run) => run.length)) + 1);
      return `${fence}${(node.attrs?.language as string | undefined) ?? ""}\n${value}\n${fence}`;
    }
    case "blockquote":
      return content
        .map(render)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "bulletList":
    case "orderedList":
    case "taskList":
      return content
        .map((item, index) => {
          const prefix =
            node.type === "orderedList" ? `${(node.attrs?.start as number) + index}. ` : "- ";
          const checkbox = node.type === "taskList" ? `[${item.attrs?.checked ? "x" : " "}] ` : "";
          const children = item.content as DocsNode[];
          const skipEmpty =
            !children[0]?.content && children.length > 1 && children[1]?.type !== "paragraph";
          const body = (skipEmpty ? children.slice(1) : children).map(render).join("\n\n");
          const [first, ...rest] = body.split("\n");
          return `${first || checkbox ? prefix : prefix.trimEnd()}${checkbox}${first}${rest.map((line) => `\n${" ".repeat(prefix.length)}${line}`).join("")}`;
        })
        .join("\n\n");
    // Only normalized doc roots reach this arm; item bodies are rendered by their lists.
    default:
      return content.map(render).join("\n\n");
  }
}

/** Export only when reparsing preserves normalized JSON. Never drops unknown nodes/marks/attrs. */
export function docsToMarkdown(document: unknown): string {
  const normalized = normalize(document, 0);
  if (normalized.type !== "doc") fail("Expected a Docs document root");
  const output = render(normalized);
  let reparsed: DocsNode;
  try {
    reparsed = normalize(markdownToDocs(output), 0);
  } catch {
    throw new MarkdownError(
      "unrepresentable",
      "Document cannot be represented by the Markdown subset",
    );
  }
  if (!same(normalized, reparsed)) {
    throw new MarkdownError(
      "unrepresentable",
      "Markdown would change the document structure or text",
    );
  }
  return output;
}
