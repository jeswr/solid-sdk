// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from pod-photos ImageGalleryDoc, with ordered schema:ListItem membership.
import type { DatasetCore, Term } from "@rdfjs/types";
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
import { DataFactory, Store } from "n3";
import { documentUrl, httpIri, isoDate } from "./validation.js";
import { IMAGE_GALLERY_CLASS, RDF_TYPE, SCHEMA } from "./vocab.js";

export interface Album {
  name: string;
  description?: string;
  dateCreated?: string;
  coverUrl?: string;
  /** Photo subject IRIs, ordered, unique. Positions on disk are one-based. */
  members: string[];
}

export class ImageGalleryDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, value, LiteralFrom.string);
  }
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}description`, LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}description`, value, LiteralFrom.string);
  }
  get dateCreated(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateCreated`, LiteralAs.date);
  }
  set dateCreated(value: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}dateCreated`, value, LiteralFrom.dateTime);
  }
  get coverUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}image`, NamedNodeAs.string);
  }
  set coverUrl(value: string | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}image`,
      value === undefined ? undefined : httpIri(value),
      NamedNodeFrom.string,
    );
  }
  get elements(): Set<Term> {
    return SetFrom.subjectPredicate(this, `${SCHEMA}itemListElement`, TermAs.term, TermFrom.itself);
  }
  /** Existing pod-photos albums used unordered schema:hasPart. Read for interop. */
  get legacyMembers(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}hasPart`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

export class ListItemDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get item(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}item`, NamedNodeAs.string);
  }
  set item(value: string | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}item`,
      value === undefined ? undefined : httpIri(value),
      NamedNodeFrom.string,
    );
  }
  get position(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}position`, LiteralAs.number);
  }
  set position(value: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}position`, value, LiteralFrom.integer);
  }
}

export function normaliseMembers(members: readonly string[]): string[] {
  return [
    ...new Set(members.filter((value) => value.trim()).map((value) => httpIri(value.trim()))),
  ];
}

export function buildAlbum(url: string, album: Album): Store {
  url = documentUrl(url);
  const dataset = new Store();
  const doc = new ImageGalleryDoc(`${url}#it`, dataset, DataFactory);
  doc.types.add(IMAGE_GALLERY_CLASS);
  doc.name = album.name;
  doc.description = album.description;
  doc.coverUrl = album.coverUrl;
  if (album.dateCreated) doc.dateCreated = new Date(isoDate(album.dateCreated));
  normaliseMembers(album.members).forEach((member, index) => {
    const ref = `${url}#member-${index + 1}`;
    const element = new ListItemDoc(ref, dataset, DataFactory);
    element.types.add(`${SCHEMA}ListItem`);
    element.item = member;
    element.position = index + 1;
    doc.elements.add(DataFactory.namedNode(ref));
  });
  return dataset;
}

export function parseAlbum(url: string, dataset: DatasetCore): Album | undefined {
  const doc = new ImageGalleryDoc(`${documentUrl(url)}#it`, dataset, DataFactory);
  if (!doc.types.has(IMAGE_GALLERY_CLASS)) return undefined;
  const elements = [...doc.elements].map((ref) => new ListItemDoc(ref, dataset, DataFactory));
  const members = elements.length
    ? elements
        .map((element) => {
          if (
            !element.item ||
            !element.position ||
            !Number.isInteger(element.position) ||
            element.position < 1
          ) {
            throw new TypeError("Invalid album ListItem");
          }
          return { item: element.item, position: element.position };
        })
        .sort((a, b) => a.position - b.position || a.item.localeCompare(b.item))
        .map(({ item }) => item)
    : [...doc.legacyMembers].sort();
  return {
    name: doc.name ?? "",
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(doc.dateCreated ? { dateCreated: doc.dateCreated.toISOString() } : {}),
    ...(doc.coverUrl !== undefined ? { coverUrl: doc.coverUrl } : {}),
    members: normaliseMembers(members),
  };
}

export function addMember(album: Album, member: string): Album {
  return { ...album, members: normaliseMembers([...album.members, member]) };
}
export function removeMember(album: Album, member: string): Album {
  return { ...album, members: album.members.filter((value) => value !== member) };
}
export function reorderMembers(album: Album, members: readonly string[]): Album {
  const ordered = normaliseMembers(members);
  if (
    ordered.length !== album.members.length ||
    members.length !== ordered.length ||
    ordered.some((member) => !album.members.includes(member))
  ) {
    throw new TypeError("Reordering must be a permutation of album members");
  }
  return { ...album, members: ordered };
}
