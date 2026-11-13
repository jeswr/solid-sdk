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
  TermAs,
  TermFrom,
  TermWrapper,
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
  type Revision,
} from "../../../docs/lib/model/document";
import { DEFAULT_FORMAT, NS } from "../../../docs/lib/model/vocab";
import { assertLabels } from "../validation";

/** Notes reminders retain the scheduling wire namespace specified for this model. */
export const SCHED = "https://w3id.org/jeswr/sectors/scheduling#";

export type NoteLocation = "active" | "archived" | "trashed";
export interface NoteRevision extends Revision {
  /** Older revisions have no recorded title; restoring those keeps the current title. */
  title?: string | undefined;
}
export interface Note
  extends Pick<PodDocument, "title" | "body" | "format" | "created" | "modified" | "creator"> {
  revisions: NoteRevision[];
  url: string;
  labels: string[];
  reminder?: string | undefined;
  reminderId?: string | undefined;
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
  get reminder(): Date | undefined {
    const link = OptionalFrom.subjectPredicate(this, `${SCHED}hasReminder`, TermAs.term);
    if (link?.termType !== "NamedNode") return undefined;
    const node = new TermWrapper(link, this.dataset, this.factory);
    const time = OptionalFrom.subjectPredicate(node, `${SCHED}triggerTime`, TermAs.term);
    if (
      time?.termType !== "Literal" ||
      time.datatype.value !== `${NS.XSD}dateTime` ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(time.value)
    )
      return undefined;
    const date = new Date(time.value);
    if (!Number.isFinite(date.getTime())) return undefined;
    // Date.parse normalises impossible days such as 30 February.
    const day = time.value.slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return undefined;
    return date;
  }
  get reminderId(): string | undefined {
    const link = OptionalFrom.subjectPredicate(this, `${SCHED}hasReminder`, TermAs.term);
    if (link?.termType !== "NamedNode") return undefined;
    const node = new TermWrapper(link, this.dataset, this.factory);
    const id = OptionalFrom.subjectPredicate(node, `${NS.DCT}identifier`, TermAs.term);
    return id?.termType === "Literal" ? id.value : undefined;
  }
  set reminderId(value: string | undefined) {
    const link = OptionalFrom.subjectPredicate(this, `${SCHED}hasReminder`, TermAs.term);
    if (link?.termType !== "NamedNode") return;
    const node = new TermWrapper(link, this.dataset, this.factory);
    OptionalAs.object(node, `${NS.DCT}identifier`, value, LiteralFrom.string);
  }
  set reminder(value: Date | undefined) {
    if (value !== undefined && !Number.isFinite(value.getTime()))
      throw new RangeError("Invalid reminder date");
    const reminderId = this.reminderId;
    const links = SetFrom.subjectPredicate(
      this,
      `${SCHED}hasReminder`,
      TermAs.term,
      TermFrom.itself,
    );
    for (const link of links) {
      if (link.termType !== "NamedNode") continue;
      const node = new TermWrapper(link, this.dataset, this.factory);
      for (const quad of [...this.dataset.match(link)])
        SetFrom.subjectPredicate(node, quad.predicate.value, TermAs.term, TermFrom.itself).clear();
    }
    links.clear();
    if (value === undefined) return;
    const id = `${this.value.split("#")[0]}#reminder`;
    const node = new TermWrapper(id, this.dataset, this.factory);
    OptionalAs.object(node, `${NS.RDF}type`, `${SCHED}Reminder`, NamedNodeFrom.string);
    OptionalAs.object(node, `${SCHED}triggerTime`, value, LiteralFrom.dateTime);
    OptionalAs.object(this, `${SCHED}hasReminder`, id, NamedNodeFrom.string);
    this.reminderId = reminderId ?? crypto.randomUUID();
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

export interface BuildNoteInput extends Omit<BuildDocumentInput, "format" | "priorRevisions"> {
  priorRevisions?: readonly NoteRevision[] | undefined;
  /** Capture the replaced content even inside the automatic revision interval. */
  beforeRestore?: Pick<Note, "title" | "body"> | undefined;
  labels?: readonly string[] | undefined;
  reminder?: Date | string | null | undefined;
  reminderId?: string | undefined;
  trashedAt?: Date | string | undefined;
  previousContainer?: string | undefined;
}

/** Apply the Docs snapshot policy, retaining at most twenty linked revisions. */
export function buildNote(url: string, input: BuildNoteInput): Store {
  const labels = input.labels ?? [];
  assertLabels(labels);
  const now = input.now ?? new Date();
  let prior: readonly NoteRevision[] = input.priorRevisions ?? [];
  if (input.beforeRestore) {
    const snapshots: NoteRevision[] = applyRevisionPolicy(url, prior, {
      body: input.beforeRestore.body,
      format: DEFAULT_FORMAT,
      now,
      attributedTo: input.editor ?? input.creator,
      label: "Before restore",
    });
    (snapshots[0] as NoteRevision).title = input.beforeRestore.title;
    prior = snapshots;
  }
  const revisions: NoteRevision[] = applyRevisionPolicy(url, prior, {
    body: input.body ?? "",
    format: DEFAULT_FORMAT,
    now,
    attributedTo: input.editor ?? input.creator,
    label: input.revisionLabel,
  }).slice(0, 20);
  const priorIds = new Set(prior.map((revision) => revision.id));
  for (const revision of revisions) if (!priorIds.has(revision.id)) revision.title = input.title;
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
  // Reuse the shared document title accessor on each existing revision entity.
  for (const revision of revisions)
    new DocumentDoc(revision.id, dataset, DataFactory).title = revision.title;
  for (const label of labels) doc.labels.add(label);
  doc.trashedAt = input.trashedAt === undefined ? undefined : new Date(input.trashedAt);
  doc.previousContainer = input.previousContainer;
  doc.reminder = input.reminder == null ? undefined : new Date(input.reminder);
  if (input.reminderId !== undefined) doc.reminderId = input.reminderId;
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
    revisions: document.revisions.map((revision) => ({
      ...revision,
      title: new DocumentDoc(revision.id, dataset, DataFactory).title,
    })),
    url,
    labels: [...doc.labels],
    reminder: doc.reminder?.toISOString(),
    reminderId: doc.reminderId,
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
