// AUTHORED-BY Codex GPT-6.1-Sol
import { DocumentOutlineError, type NodePath } from "./types";

/** Limits include metadata; the character budget measures input UTF-16 code units. */
export const DOCUMENT_LIMITS = { depth: 128, values: 100_000, characters: 1_000_000 } as const;

export interface DocumentNode {
  readonly type: string;
  readonly text: string;
  readonly level: 1 | 2 | 3;
  readonly content: readonly DocumentNode[];
}

const blocks = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
  "horizontalRule",
  "image",
  "table",
];
const inline = ["text", "hardBreak"];
const children: Record<string, readonly string[]> = {
  doc: blocks,
  paragraph: inline,
  heading: inline,
  codeBlock: ["text"],
  blockquote: blocks,
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  taskList: ["taskItem"],
  listItem: blocks,
  taskItem: blocks,
  table: ["tableRow"],
  tableRow: ["tableCell", "tableHeader"],
  tableCell: blocks,
  tableHeader: blocks,
  text: [],
  hardBreak: [],
  horizontalRule: [],
  image: [],
};
const marks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "subscript",
  "superscript",
  "highlight",
  "code",
  "link",
  "comment",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, path: NodePath): never {
  throw new DocumentOutlineError("invalid-document", message, path);
}

function validateJson(input: unknown): void {
  const ancestors = new Set<object>();
  let values = 0;
  let characters = 0;
  function visit(value: unknown, depth: number): void {
    values += 1;
    if (depth > DOCUMENT_LIMITS.depth || values > DOCUMENT_LIMITS.values) {
      throw new DocumentOutlineError("limit-exceeded", "Document exceeds traversal limits");
    }
    if (typeof value === "string") {
      characters += value.length;
      if (characters > DOCUMENT_LIMITS.characters) {
        throw new DocumentOutlineError("limit-exceeded", "Document exceeds character limit");
      }
      if (!value.isWellFormed()) invalid("Expected well-formed Unicode", []);
      return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") invalid("Expected plain JSON values", []);
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype) &&
      prototype !== null
    ) {
      invalid("Expected plain JSON objects or arrays", []);
    }
    if (ancestors.has(value)) invalid("Cyclic documents are unsupported", []);
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (Object.keys(descriptors).length !== value.length + 1) {
        invalid("Expected dense JSON arrays without extra fields", []);
      }
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(descriptors, index)) invalid("Expected dense JSON arrays", []);
      }
      delete descriptors.length;
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") invalid("Expected string JSON property keys", []);
      const descriptor = descriptors[key] as PropertyDescriptor;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        invalid("Expected enumerable JSON data properties", []);
      }
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(input, 0);
}

/** Validate the known first-cut schema before extracting any text. */
function parseDocument(input: unknown): DocumentNode {
  validateJson(input);
  function read(value: unknown, path: NodePath, allowed: readonly string[]): DocumentNode {
    if (!record(value) || typeof value.type !== "string") invalid("Expected a typed node", path);
    const type = value.type;
    if (!Object.hasOwn(children, type)) {
      throw new DocumentOutlineError("unsupported-node", "Unsupported document node", path);
    }
    if (!allowed.includes(type)) invalid("Invalid node nesting", path);
    if (
      Object.keys(value).some((key) => !["type", "attrs", "content", "text", "marks"].includes(key))
    ) {
      invalid("Unknown node field", path);
    }
    if ("attrs" in value && !record(value.attrs)) invalid("Expected node attributes", path);
    if ("content" in value && !Array.isArray(value.content)) invalid("Expected node content", path);
    if ("marks" in value) {
      if (!inline.includes(type) || !Array.isArray(value.marks))
        invalid("Invalid node marks", path);
      for (const mark of value.marks) {
        if (!record(mark) || typeof mark.type !== "string") invalid("Invalid mark", path);
        if (!marks.has(mark.type)) {
          throw new DocumentOutlineError("unsupported-mark", "Unsupported document mark", path);
        }
        if (
          Object.keys(mark).some((key) => !["type", "attrs"].includes(key)) ||
          ("attrs" in mark && !record(mark.attrs))
        )
          invalid("Invalid mark fields", path);
      }
    }
    if (type === "text") {
      if (typeof value.text !== "string" || value.text.length === 0 || "content" in value) {
        invalid("Expected a nonempty text leaf", path);
      }
    } else if ("text" in value) invalid("Only text nodes may carry text", path);
    const attrs = value.attrs as Record<string, unknown> | undefined;
    const level = attrs?.level;
    if (type === "heading" && level !== 1 && level !== 2 && level !== 3) {
      invalid("Expected heading level 1, 2 or 3", path);
    }
    const content = (value.content ?? []) as unknown[];
    const allowedChildren = children[type] as readonly string[];
    if (allowedChildren.length === 0 && content.length > 0) invalid("Expected a leaf node", path);
    if (
      [
        "bulletList",
        "orderedList",
        "taskList",
        "table",
        "tableRow",
        "blockquote",
        "tableCell",
        "tableHeader",
      ].includes(type) &&
      content.length === 0
    ) {
      invalid("Expected nonempty container", path);
    }
    if (
      ["listItem", "taskItem"].includes(type) &&
      (!record(content[0]) || content[0].type !== "paragraph")
    ) {
      invalid("List items must start with a paragraph", path);
    }
    return {
      type,
      text: type === "text" ? (value.text as string) : "",
      level: type === "heading" ? (level as 1 | 2 | 3) : 1,
      content: content.map((child, index) => read(child, [...path, index], allowedChildren)),
    };
  }
  return read(input, [], ["doc"]);
}

export function readDocument(input: unknown): DocumentNode {
  try {
    return parseDocument(input);
  } catch (error) {
    if (error instanceof DocumentOutlineError) throw error;
    // Exotic objects (for example revoked proxies) must not leak native errors or input data.
    throw new DocumentOutlineError("invalid-document", "Unable to read plain document JSON");
  }
}
