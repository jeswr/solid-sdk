// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * App-managed trash index (04-drive §5.3): one `prov:Entity` subject per
 * trashed item in `<drive>/.trash/index.ttl`, read and written through
 * `@rdfjs/wrapper` accessors and serialised with `n3.Writer`. Only existing
 * vocabularies are used (vocab DECISIONS V8).
 */

import type { DatasetCore } from "@rdfjs/types";
import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

const PROV = "http://www.w3.org/ns/prov#";
const DCT = "http://purl.org/dc/terms/";
const POSIX = "http://www.w3.org/ns/posix/stat#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ENTITY = `${PROV}Entity`;

/** A trashed item as the UI consumes it. */
export interface TrashEntry {
  /** Where the item lives now (inside `.trash/<uuid>/`). */
  readonly url: string;
  /** Where it was before it was trashed. */
  readonly original: string;
  readonly trashedAt: Date;
  readonly trashedBy?: string;
  readonly name: string;
  readonly contentType?: string;
  readonly size?: number;
  /** Recovery copy from an interrupted transfer; restore merges missing files. */
  readonly status?: "partial";
  /** Remaining recovery resource URLs, derived from the current recovery tree. */
  readonly remaining?: readonly string[];
}

export class TrashRecord extends TermWrapper {
  /** JSON archive of each original container's own ACL, before Trash privatizes it. */
  get containerAcls(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}accessRights`, LiteralAs.string);
  }
  set containerAcls(value: string | undefined) {
    OptionalAs.object(this, `${DCT}accessRights`, value, LiteralFrom.string);
  }
  get leaseOwner(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasAssociatedWith`, NamedNodeAs.string);
  }
  set leaseOwner(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasAssociatedWith`, value, NamedNodeFrom.string);
  }
  get leaseUntil(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}valid`, LiteralAs.date);
  }
  set leaseUntil(value: Date | undefined) {
    OptionalAs.object(this, `${DCT}valid`, value, LiteralFrom.dateTime);
  }
  /** Source URL/ETag tuples captured before the pending intent is persisted. */
  get sourceVersions(): Set<string> {
    return SetFrom.subjectPredicate(this, `${DCT}identifier`, LiteralAs.string, LiteralFrom.string);
  }
  get status(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}description`, LiteralAs.string);
  }
  set status(value: string) {
    OptionalAs.object(this, `${DCT}description`, value, LiteralFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get originalLocation(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasDerivedFrom`, NamedNodeAs.string);
  }
  set originalLocation(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasDerivedFrom`, value, NamedNodeFrom.string);
  }
  get trashedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}invalidatedAtTime`, LiteralAs.date);
  }
  set trashedAt(value: Date | undefined) {
    OptionalAs.object(this, `${PROV}invalidatedAtTime`, value, LiteralFrom.dateTime);
  }
  get trashedBy(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasAttributedTo`, NamedNodeAs.string);
  }
  set trashedBy(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasAttributedTo`, value, NamedNodeFrom.string);
  }
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}title`, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, `${DCT}title`, value, LiteralFrom.string);
  }
  get format(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}format`, LiteralAs.string);
  }
  set format(value: string | undefined) {
    OptionalAs.object(this, `${DCT}format`, value, LiteralFrom.string);
  }
  get size(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${POSIX}size`, LiteralAs.number);
  }
  set size(value: number | undefined) {
    OptionalAs.object(this, `${POSIX}size`, value, LiteralFrom.integer);
  }
  /** Remove every statement about this record. */
  clear(): void {
    const subject = DataFactory.namedNode(this.value);
    for (const quad of [...this.dataset.match(subject, null, null)]) this.dataset.delete(quad);
  }
}

export class TrashIndex extends DatasetWrapper {
  get records(): TrashRecord[] {
    return [...this.instancesOf(ENTITY, TrashRecord)];
  }
  record(url: string): TrashRecord {
    return new TrashRecord(url, this, DataFactory);
  }
}

export function emptyTrashIndex(): TrashIndex {
  return new TrashIndex(new Store(), DataFactory);
}

export function trashIndexFrom(dataset: DatasetCore): TrashIndex {
  return new TrashIndex(dataset, DataFactory);
}

/** Records with the fields Drive needs; malformed records are skipped. */
export function trashEntries(index: TrashIndex): TrashEntry[] {
  const out: TrashEntry[] = [];
  for (const record of index.records) {
    try {
      const original = record.originalLocation;
      const trashedAt = record.trashedAt;
      if (!original || !trashedAt || Number.isNaN(trashedAt.getTime())) continue;
      const by = record.trashedBy;
      const format = record.format;
      const size = record.size;
      const path = original.replace(/\/$/, "");
      out.push({
        url: record.value,
        original,
        trashedAt,
        name: record.title ?? decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)),
        ...(by ? { trashedBy: by } : {}),
        ...(format ? { contentType: format } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(record.status === "partial" ? { status: "partial" as const } : {}),
      });
    } catch {
      // A wrong-typed literal makes one record unreadable, never the whole trash.
    }
  }
  return out.sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime());
}

export function addTrashRecord(
  index: TrashIndex,
  entry: Omit<TrashEntry, "name"> & { name: string },
): void {
  const record = index.record(entry.url);
  record.clear();
  record.types.add(ENTITY);
  record.originalLocation = entry.original;
  record.trashedAt = entry.trashedAt;
  record.trashedBy = entry.trashedBy;
  record.title = entry.name;
  record.format = entry.contentType;
  record.size = entry.size;
  if (entry.status) record.status = entry.status;
}

export function removeTrashRecord(index: TrashIndex, url: string): void {
  index.record(url).clear();
}

export function serializeTrashIndex(index: TrashIndex): Promise<string> {
  const writer = new Writer({
    format: "text/turtle",
    prefixes: { prov: PROV, dct: DCT, posix: POSIX },
  });
  writer.addQuads([...index]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
