// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import {
  applyRevisionPolicy,
  type BuildDocumentInput,
  buildDocument,
  DocumentDoc,
  documentSubject,
  type PodDocument,
  parseDocument,
} from "../../../docs/lib/model/document";
import { DEFAULT_FORMAT, NS } from "../../../docs/lib/model/vocab";
import { assertLabels } from "../validation";

export type NoteLocation = "active" | "archived" | "trashed";
export interface Note
  extends Pick<
    PodDocument,
    "title" | "body" | "format" | "created" | "modified" | "creator" | "revisions"
  > {
  url: string;
  labels: string[];
  location: NoteLocation;
  trashedAt?: string | undefined;
  previous?: "active" | "archived" | undefined;
}

/** Extra interoperable properties on the shared document's #it subject. */
export class NoteDoc extends DocumentDoc {
  override mark(): this {
    super.mark();
    this.types.add(`${NS.SCHEMA}TextDigitalDocument`);
    return this;
  }
  get labels(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.SCHEMA}keywords`,
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  get trashedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.PROV}invalidatedAtTime`, LiteralAs.date);
  }
  set trashedAt(value: Date | undefined) {
    OptionalAs.object(this, `${NS.PROV}invalidatedAtTime`, value, LiteralFrom.dateTime);
  }
  get previousContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.PROV}atLocation`, NamedNodeAs.string);
  }
  set previousContainer(value: string | undefined) {
    OptionalAs.object(this, `${NS.PROV}atLocation`, value, NamedNodeFrom.string);
  }
}

export interface BuildNoteInput extends Omit<BuildDocumentInput, "format"> {
  labels?: readonly string[] | undefined;
  trashedAt?: Date | string | undefined;
  previousContainer?: string | undefined;
}

/** Apply the Docs snapshot policy, retaining at most twenty linked revisions. */
export function buildNote(url: string, input: BuildNoteInput): Store {
  const labels = input.labels ?? [];
  assertLabels(labels);
  const now = input.now ?? new Date();
  const revisions = applyRevisionPolicy(url, input.priorRevisions ?? [], {
    body: input.body ?? "",
    format: DEFAULT_FORMAT,
    now,
    attributedTo: input.editor ?? input.creator,
    label: input.revisionLabel,
  }).slice(0, 20);
  for (const [index, revision] of revisions.entries())
    revision.wasRevisionOf = revisions[index + 1]?.id;
  // The policy has already run; omitting revisionLabel avoids adding a second named entry.
  const dataset = buildDocument(url, {
    ...input,
    now,
    format: DEFAULT_FORMAT,
    priorRevisions: revisions,
    revisionLabel: undefined,
  });
  const doc = new NoteDoc(documentSubject(url), dataset, DataFactory).mark();
  for (const label of labels) doc.labels.add(label);
  doc.trashedAt = input.trashedAt === undefined ? undefined : new Date(input.trashedAt);
  doc.previousContainer = input.previousContainer;
  return dataset;
}

export function parseNote(
  url: string,
  dataset: DatasetCore,
  location: NoteLocation,
): Note | undefined {
  const document = parseDocument(url, dataset);
  if (!document) return undefined;
  const doc = new NoteDoc(documentSubject(url), dataset, DataFactory);
  const notesRoot = new URL(location === "active" ? "./" : "../", url).href;
  const previous = doc.previousContainer;
  return {
    ...document,
    url,
    labels: [...doc.labels],
    location,
    trashedAt: location === "trashed" ? doc.trashedAt?.toISOString() : undefined,
    previous:
      location === "trashed"
        ? previous === `${notesRoot}archive/`
          ? "archived"
          : previous === notesRoot
            ? "active"
            : undefined
        : undefined,
  };
}
