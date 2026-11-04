// AUTHORED-BY Claude Opus 5.5
import type { Schema } from "@tiptap/pm/model";
import { markdownOmitsMark } from "../../src/apps/docs/lib/convert/markdown";

/**
 * Markdown export deliberately omits some styling (MARKDOWN_NOTES). Round-trip
 * properties cover every schema mark that Markdown still exports.
 */
export function exportedMarks(schema: Schema): string[] {
  return Object.keys(schema.marks).filter((type) => !markdownOmitsMark(type));
}
