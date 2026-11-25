// AUTHORED-BY Codex (GPT-6.1 Sol)
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { entities } from "./generated/model.js";
import { applyRevisionPolicy } from "./revision-policy.js";
import type { BuildDocumentInput, PodDocument, Revision } from "./types.js";
import { assertWordCount, DocumentDoc, RevisionDoc } from "./views.js";

export { applyRevisionPolicy, revisionSubject } from "./revision-policy.js";
export type { BuildDocumentInput, PodDocument, Revision } from "./types.js";

import { DEFAULT_FORMAT, PROV } from "./vocab.js";

export { DocumentDoc, RevisionDoc } from "./views.js";
/** The document subject IRI for a resource (`<resource>#it`). */
export function documentSubject(resourceUrl: string): string {
  return entities.Document.subject(resourceUrl);
}

/**
 * Walk the revision chain from `pd:currentRevision` along `prov:wasRevisionOf`,
 * head-first. Self-referential or cyclic `wasRevisionOf` links are broken by a
 * visited-set guard (a malformed/hostile document must not loop forever).
 */
function readRevisions(doc: DocumentDoc, dataset: DatasetCore): Revision[] {
  const out: Revision[] = [];
  const seen = new Set<string>();
  let cursor = doc.currentRevision;
  while (cursor && isSafeAbsoluteIri(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const rev = new RevisionDoc(cursor, dataset, DataFactory);
    if (!rev.types.has(PROV.Entity)) break;
    const generatedAt = rev.generatedAt;
    out.push({
      id: cursor,
      label: rev.label,
      body: rev.body ?? "",
      format: rev.format ?? DEFAULT_FORMAT,
      generatedAt: (generatedAt ?? new Date(0)).toISOString(),
      attributedTo: rev.attributedTo,
      wasRevisionOf: rev.wasRevisionOf,
    });
    cursor = rev.wasRevisionOf;
  }
  return out;
}

/**
 * Parse a document resource's dataset into a {@link PodDocument}, or `undefined`
 * if the resource holds no `pd:Document`.
 */
export function parseDocument(resourceUrl: string, dataset: DatasetCore): PodDocument | undefined {
  if (!entities.Document.parse(resourceUrl, dataset)) return undefined;
  const doc = new DocumentDoc(documentSubject(resourceUrl), dataset, DataFactory);
  return {
    instanceId: doc.instanceId,
    updateLog: doc.updateLog,
    assets: doc.assets,
    comments: doc.comments,
    wordCount: doc.wordCount,
    wasDerivedFrom: doc.wasDerivedFrom,
    title: doc.title ?? "",
    body: doc.body ?? "",
    format: doc.format ?? DEFAULT_FORMAT,
    creator: doc.creator,
    created: doc.created?.toISOString(),
    modified: doc.modified?.toISOString(),
    revisions: readRevisions(doc, dataset),
  };
}

/**
 * Serialise a {@link BuildDocumentInput} into a fresh dataset rooted at
 * `<resource>#it`, materialising history according to the ten-minute/named revision policy.
 *
 * The new revision is indexed one past the highest existing index parsed from
 * the prior revisions' IRIs, so revision IRIs never collide across saves.
 */
export function buildDocument(resourceUrl: string, input: BuildDocumentInput): Store {
  const now = input.now ?? new Date();
  const format = input.format?.trim() || DEFAULT_FORMAT;
  const body = input.body ?? "";
  const prior = input.priorRevisions ?? [];
  if (input.title.length > 200) throw new RangeError("Document title exceeds 200 characters");
  if (input.revisionLabel !== undefined && !input.revisionLabel.trim())
    throw new RangeError("Revision label must not be blank");
  assertWordCount(input.wordCount);
  const created = input.created === undefined ? now : new Date(input.created);
  const revisions = applyRevisionPolicy(resourceUrl, prior, {
    body,
    format,
    now,
    attributedTo: input.editor ?? input.creator,
    label: input.revisionLabel,
  });
  const store = entities.Document.build(resourceUrl, {
    instanceId: input.instanceId,
    updateLog: input.updateLog,
    assets: input.assets,
    comments: input.comments,
    wordCount: input.wordCount,
    wasDerivedFrom: input.wasDerivedFrom,
    title: input.title || undefined,
    body,
    format,
    creator: input.creator,
    created,
    modified: now,
    currentRevision: revisions[0]?.id,
  });
  for (const rev of revisions) {
    store.addQuads([
      ...entities.Revision.build(rev.id, {
        body: rev.body,
        format: rev.format,
        generatedAt: new Date(rev.generatedAt),
        attributedTo: rev.attributedTo,
        wasRevisionOf: rev.wasRevisionOf,
        label: rev.label,
      }),
    ]);
  }

  return store;
}
