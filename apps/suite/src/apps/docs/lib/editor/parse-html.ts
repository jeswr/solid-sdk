// AUTHORED-BY Codex
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import { type Extensions, getSchema, type JSONContent } from "@tiptap/react";

const inertDocuments = new WeakMap<Document, Document>();

/** Parse fragments in an empty, scripting-disabled document shared by this page's imports. */
export function parseHtmlDocument(source: string) {
  // A fresh DOMParser document per fragment makes jsdom allocate selector
  // engines/listeners per import. Cache only the empty owner document; each
  // detached root is fresh and never attaches untrusted nodes to the page.
  let inert = inertDocuments.get(document);
  if (!inert) {
    inert = new window.DOMParser().parseFromString("", "text/html");
    inertDocuments.set(document, inert);
  }
  const root = inert.createElement("html");
  root.innerHTML = source;
  // The HTML fragment parser's html context always supplies both head and body.
  return {
    head: root.firstElementChild as HTMLHeadElement,
    body: root.lastElementChild as HTMLBodyElement,
  };
}

/** Parse the intact DOM: generateJSON strips whitespace-only nodes between marks. */
export function parseDocumentHtml(source: string, extensions: Extensions): JSONContent {
  const dom = parseHtmlDocument(source);
  return SchemaDOMParser.fromSchema(getSchema(extensions)).parse(dom.body).toJSON();
}
