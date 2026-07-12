// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * An album/gallery as `schema:ImageGallery`. Membership links the gallery to
 * the photos it contains with `schema:hasPart` (an IRI per member photo) — the
 * standard schema.org collection idiom. Built/parsed only through the typed
 * `@rdfjs/wrapper` accessors (never hand-built quads).
 *
 *   <#it> a schema:ImageGallery ;
 *       schema:name        "Iceland 2026" ;
 *       schema:description "…" ;
 *       schema:dateCreated "2026-06-15T09:41:07Z"^^xsd:dateTime ;
 *       schema:hasPart <…/photos/aurora.ttl#it> , <…/photos/glacier.ttl#it> .
 *
 * Members are referenced by their photo *subject* IRI (`…/x.ttl#it`), which is
 * stable and resolvable, so any other Solid app can follow `schema:hasPart`
 * straight to the `schema:Photograph` description.
 */
import type { DatasetCore } from '@rdfjs/types';
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from '@rdfjs/wrapper';
import { DataFactory, Store } from 'n3';
import { IMAGE_GALLERY_CLASS, RDF_TYPE, SCHEMA } from './vocab.js';

/** An album as the UI works with it (plain, serialisable). */
export interface Album {
  /** Display title — `schema:name`. */
  name: string;
  /** Optional description — `schema:description`. */
  description?: string;
  /** ISO-8601 creation instant — `schema:dateCreated`. */
  dateCreated?: string;
  /** Member photo subject IRIs — `schema:hasPart` (deduped, sorted). */
  members: string[];
}

/** Typed `@rdfjs/wrapper` view of a single album's subject. */
export class ImageGalleryDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(IMAGE_GALLERY_CLASS);
    return this;
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, v, LiteralFrom.string);
  }
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}description`, LiteralAs.string);
  }
  set description(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}description`, v, LiteralFrom.string);
  }
  get dateCreated(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateCreated`, LiteralAs.date);
  }
  set dateCreated(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}dateCreated`, v, LiteralFrom.dateTime);
  }
  /** `schema:hasPart` — the member photo subject IRIs (a live set). */
  get members(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}hasPart`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** Dedupe + sort a member IRI list, dropping blanks (deterministic output). */
export function normaliseMembers(members: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of members) {
    const m = raw.trim();
    if (m) seen.add(m);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Parse an album document into an {@link Album}, or `undefined` if not one. */
export function parseAlbum(itemUrl: string, dataset: DatasetCore): Album | undefined {
  const doc = new ImageGalleryDoc(`${itemUrl}#it`, dataset, DataFactory);
  if (!doc.types.has(IMAGE_GALLERY_CLASS)) return undefined;
  const created = doc.dateCreated;
  return {
    name: doc.name ?? '',
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(created ? { dateCreated: created.toISOString() } : {}),
    members: normaliseMembers([...doc.members]),
  };
}

/** Serialise an {@link Album} into a fresh dataset rooted at `${itemUrl}#it`. */
export function buildAlbum(itemUrl: string, album: Album): Store {
  const store = new Store();
  const doc = new ImageGalleryDoc(`${itemUrl}#it`, store, DataFactory).mark();
  doc.name = album.name || undefined;
  doc.description = album.description || undefined;
  if (album.dateCreated) {
    const d = new Date(album.dateCreated);
    if (!Number.isNaN(d.getTime())) doc.dateCreated = d;
  }
  for (const m of normaliseMembers(album.members)) doc.members.add(m);
  return store;
}

/** Add a photo to an album's member set (idempotent). Returns the new list. */
export function addMember(album: Album, photoIri: string): Album {
  return { ...album, members: normaliseMembers([...album.members, photoIri]) };
}

/** Remove a photo from an album's member set (idempotent). Returns the new list. */
export function removeMember(album: Album, photoIri: string): Album {
  return { ...album, members: normaliseMembers(album.members.filter((m) => m !== photoIri)) };
}
