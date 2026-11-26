// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { type AnnotationData, entities } from "./generated/model.js";
import { OA } from "./vocab.js";
export interface CommentAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: string;
  end: string;
}
export interface DocumentComment {
  url: string;
  etag: string | null;
  text: string;
  creator: string;
  created: string;
  target: string;
  kind: "root" | "reply";
  anchor?: CommentAnchor | undefined;
  resolved: boolean;
}
export interface CommentThread {
  root: DocumentComment;
  replies: DocumentComment[];
}
const CONTEXT = 32;
const MAX_QUOTE = 10_000;
const MAX_POSITION = 1_024;
export function readComment(
  url: string,
  dataset: DatasetCore,
  etag: string | null,
): DocumentComment {
  const node = new entities.Annotation.Wrapper(url, dataset, DataFactory);
  const data = entities.Annotation.parse(url, dataset);
  if (!data || !node.types.has(OA.Annotation)) throw new Error("Malformed comment");
  const { motivation, text, creator, created, target } = data;
  const root = motivation === OA.commenting;
  let anchor: CommentAnchor | undefined;
  let source = target;
  if (root) {
    const targetNode = new entities.Annotation.Wrapper(target, dataset, DataFactory);
    const selector = targetNode.selector;
    source = targetNode.source as string;
    if (!selector) throw new Error("Malformed comment anchor");
    const quote = new entities.Quote.Wrapper(selector as string, dataset, DataFactory);
    const quoteData = entities.Quote.parse(selector, dataset);
    const start = node.start;
    const end = node.end;
    if (!source || !quote.types.has(OA.TextQuoteSelector) || !quoteData || !start || !end)
      throw new Error("Malformed comment anchor");
    const { exact, prefix, suffix } = quoteData;
    // Other users write these: bound them so anchor resolution stays cheap.
    if (exact.length > MAX_QUOTE || start.length > MAX_POSITION || end.length > MAX_POSITION)
      throw new Error("Malformed comment anchor");
    anchor = {
      exact,
      prefix: Array.from(prefix).slice(-CONTEXT).join(""),
      suffix: Array.from(suffix).slice(0, CONTEXT).join(""),
      start,
      end,
    };
  }
  return {
    url,
    etag,
    text,
    creator,
    created: created.toISOString(),
    target: source,
    kind: root ? "root" : "reply",
    anchor,
    resolved: node.resolved ?? false,
  };
}
/** Compose the conditional Web Annotation target without adding types to untyped targets. */
export function buildComment(comment: DocumentComment): Store {
  const anchor = comment.anchor;
  const dataset = entities.Annotation.build(comment.url, {
    // Vocabulary constants keep their legacy public string type; SHACL narrows this field.
    motivation: (comment.kind === "root"
      ? OA.commenting
      : OA.replying) as AnnotationData["motivation"],
    text: comment.text,
    creator: comment.creator,
    created: new Date(comment.created),
    target: anchor ? `${comment.url}#target` : comment.target,
    start: anchor?.start,
    end: anchor?.end,
  });
  if (anchor) {
    const target = new entities.Annotation.Wrapper(`${comment.url}#target`, dataset, DataFactory);
    target.source = comment.target;
    target.selector = `${comment.url}#quote`;
    const quote = entities.Quote.build(`${comment.url}#quote`, anchor);
    dataset.addQuads([...quote]);
  }
  return dataset;
}
export function setCommentResolution(
  url: string,
  dataset: DatasetCore,
  resolved: boolean,
  actor: string,
  now: Date,
): void {
  const node = new entities.Annotation.Wrapper(url, dataset, DataFactory);
  node.resolved = resolved ? true : undefined;
  node.resolvedBy = resolved ? actor : undefined;
  node.resolvedAt = resolved ? now : undefined;
}
export function setCommentText(url: string, dataset: DatasetCore, text: string): void {
  new entities.Annotation.Wrapper(url, dataset, DataFactory).text = text;
}
