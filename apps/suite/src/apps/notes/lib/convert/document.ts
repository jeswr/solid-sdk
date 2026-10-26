// AUTHORED-BY Codex GPT-6.1-Sol
import type { DocsDocument, NotesDocument } from "./types";
import { array, record, requireValue, text } from "./validation";

const blocks = ["paragraph", "heading", "bulletList", "orderedList", "taskList"];
const nodeTypes = ["doc", ...blocks, "listItem", "taskItem", "text"];

function link(value: Record<string, unknown>): void {
  text(value.href);
  // Reject whitespace, control characters and backslash URL reinterpretation.
  requireValue(!/[\s\p{Cc}\\]/u.test(value.href));
  if (value.href.startsWith("/") && !value.href.startsWith("//")) {
    requireValue(value.href.length > 1);
  } else {
    let url: URL;
    try {
      url = new URL(value.href);
    } catch {
      requireValue(false);
    }
    requireValue(["http:", "https:", "mailto:"].includes(url.protocol));
    requireValue(url.protocol !== "mailto:" || url.pathname.length > 0);
  }
  for (const key of ["target", "rel", "class", "title"]) {
    if (key in value && value[key] !== null) text(value[key]);
  }
}

function mark(value: unknown): unknown {
  const item = record(value, ["type", "attrs"]);
  requireValue(["bold", "italic", "link"].includes(item.type as string), "unsupported-mark");
  const result = { ...item };
  if (item.type === "link") {
    const attrs = record(item.attrs, ["href", "target", "rel", "class", "title"]);
    link(attrs);
    result.attrs = { ...attrs };
  } else if ("attrs" in item) {
    result.attrs = { ...record(item.attrs, []) };
  }
  return result;
}

function node(value: unknown, allowed: readonly string[], depth: number, tasks: number): unknown {
  // Bounds also reject cyclic non-JSON inputs before the JS call stack can overflow.
  requireValue(depth <= 64, "limit-exceeded");
  const item = record(value, ["type", "attrs", "content", "text", "marks"]);
  const type = item.type as string;
  requireValue(nodeTypes.includes(type), "unsupported-node");
  requireValue(allowed.includes(type), "invalid-structure");
  const result = { ...item };
  if (type === "text") {
    requireValue(!("attrs" in item) && !("content" in item), "invalid-structure");
    text(item.text);
    requireValue(item.text.length > 0, "invalid-structure");
    if ("marks" in item) {
      const marks = array(item.marks);
      const seen = new Set<unknown>();
      result.marks = marks.map((value) => {
        const converted = mark(value) as { type: string };
        requireValue(!seen.has(converted.type), "invalid-structure");
        seen.add(converted.type);
        return converted;
      });
    }
    return result;
  }
  requireValue(!("text" in item) && !("marks" in item), "invalid-structure");
  if (type === "heading") {
    const attrs = record(item.attrs, ["level"]);
    requireValue([1, 2, 3].includes(attrs.level as number));
    result.attrs = { ...attrs };
  } else if (type === "taskItem") {
    const attrs = record(item.attrs, ["checked"]);
    requireValue(typeof attrs.checked === "boolean");
    result.attrs = { ...attrs };
  } else if ("attrs" in item) {
    const attrs = record(item.attrs, type === "orderedList" ? ["start"] : []);
    if ("start" in attrs) {
      requireValue(Number.isSafeInteger(attrs.start) && (attrs.start as number) >= 1);
    }
    result.attrs = { ...attrs };
  }
  const inline = type === "paragraph" || type === "heading";
  if (inline && !("content" in item)) return result;
  const children = array(item.content);
  requireValue(inline || children.length > 0, "invalid-structure");
  let childTypes = blocks;
  if (inline) childTypes = ["text"];
  else if (type === "bulletList" || type === "orderedList") childTypes = ["listItem"];
  else if (type === "taskList") {
    tasks += 1;
    requireValue(tasks <= 3, "limit-exceeded");
    childTypes = ["taskItem"];
  }
  result.content = children.map((child) => node(child, childTypes, depth + 1, tasks));
  if (type === "listItem" || type === "taskItem") {
    requireValue(
      (result.content as { type: string }[])[0]?.type === "paragraph",
      "invalid-structure",
    );
  }
  return result;
}

/** Validate the shared Notes profile and return fully detached ProseMirror JSON. */
export function notesToDocs(input: unknown): DocsDocument {
  return node(input, ["doc"], 0, 0) as DocsDocument;
}

/** Reject Docs-only features, rather than flattening them or discarding formatting. */
export function docsToNotes(input: unknown): NotesDocument {
  return node(input, ["doc"], 0, 0) as NotesDocument;
}
