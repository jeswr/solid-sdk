// AUTHORED-BY Codex GPT-6.1-Sol
import { type DocsMark, type DocsNode, MarkdownError } from "./types";

export const MAX_LENGTH = 1_000_000;
export function fail(message: string): never {
  throw new MarkdownError("unsupported", message);
}
export function depthGuard(depth: number): void {
  if (depth > 32) throw new MarkdownError("limit", "Document nesting exceeds 32 levels");
}
export function checkString(value: unknown): asserts value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject text that Markdown normalizes
  if (typeof value !== "string" || /[\u0000\r]/.test(value)) {
    throw new MarkdownError("invalid-input", "Expected text without NUL or carriage returns");
  }
  if (value.length > MAX_LENGTH)
    throw new MarkdownError("limit", "Text exceeds 1000000 characters");
}
export function text(value: string, marks: DocsMark[] = []): DocsNode[] {
  if (!value) return [];
  return [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }];
}
export function block(
  type: string,
  content: DocsNode[] = [],
  attrs?: Record<string, unknown>,
): DocsNode {
  return { type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function mergeText(nodes: DocsNode[]): DocsNode[] {
  const result: DocsNode[] = [];
  for (const node of nodes) {
    const previous = result.at(-1);
    if (node.type === "text" && previous?.type === "text" && same(node.marks, previous.marks)) {
      previous.text += node.text as string;
    } else result.push(node);
  }
  return result;
}
export function safeLink(href: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject obfuscated URL schemes
  if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\s<>\\\u0000-\u001f\u007f]/.test(href)) {
    fail("Only http(s) and mailto links without whitespace or controls are supported");
  }
  try {
    new URL(href);
  } catch {
    fail("Invalid link URL");
  }
}
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decode(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (_raw, name: string) => {
    if (name.startsWith("#")) {
      const hex = name[1]?.toLowerCase() === "x";
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        code < 32 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff) ||
        (code >= 127 && code <= 159)
      ) {
        fail("Unsupported numeric character reference");
      }
      return String.fromCodePoint(code);
    }
    const decoded = Object.hasOwn(entities, name) ? entities[name] : undefined;
    if (decoded === undefined) fail("Unsupported named character reference");
    return decoded;
  });
}
export function sortedMarks(marks: DocsMark[]): DocsMark[] {
  const order = ["link", "bold", "italic", "code"];
  return [...marks].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}
