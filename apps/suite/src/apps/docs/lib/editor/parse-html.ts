// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { type Extensions, getSchema, type JSONContent } from "@tiptap/react";

/** Parse the intact DOM: generateJSON strips whitespace-only nodes between marks. */
export function parseDocumentHtml(source: string, extensions: Extensions): JSONContent {
  const dom = new window.DOMParser().parseFromString(source, "text/html");
  return SchemaDOMParser.fromSchema(getSchema(extensions)).parse(dom.body).toJSON();
}
