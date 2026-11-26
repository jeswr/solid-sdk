// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { entities } from "./generated/model.js";
import { orderedStore } from "./order.js";
import { documentUrl, httpIri, isoDate, optionalHttpIri } from "./validation.js";
import { ImageGalleryDoc, ListItemDoc, lenientPhoto } from "./views.js";
import { RDF_TYPE, SCHEMA } from "./vocab.js";

export { ImageGalleryDoc, ListItemDoc };
export interface Album {
  name: string;
  description?: string;
  dateCreated?: string;
  coverUrl?: string;
  /** Photo subject IRIs, ordered, unique. Positions on disk are one-based. */
  members: string[];
}

export function normaliseMembers(members: readonly string[]): string[] {
  return [
    ...new Set(members.filter((value) => value.trim()).map((value) => httpIri(value.trim()))),
  ];
}

export function buildAlbum(url: string, album: Album): Store {
  url = documentUrl(url);
  const dataset = entities.ImageGallery.build(`${url}#it`, {
    name: album.name,
    description: album.description,
    coverUrl: album.coverUrl === undefined ? undefined : httpIri(album.coverUrl),
    dateCreated: album.dateCreated ? new Date(isoDate(album.dateCreated)) : undefined,
  });
  const doc = new ImageGalleryDoc(`${url}#it`, dataset, DataFactory);
  normaliseMembers(album.members).forEach((member, index) => {
    const ref = `${url}#member-${index + 1}`;
    for (const quad of entities.ListItem.build(ref, { item: member, position: index + 1 })) {
      dataset.add(quad);
    }
    doc.elements.add(DataFactory.namedNode(ref));
  });
  return orderedStore(dataset, [
    RDF_TYPE,
    ...["name", "description", "image", "dateCreated", "itemListElement", "item", "position"].map(
      (name) => `${SCHEMA}${name}`,
    ),
  ]);
}

export function parseAlbum(url: string, dataset: DatasetCore): Album | undefined {
  return readAlbum(url, dataset, false);
}

/**
 * Read an album for write-back. Like {@link parseAlbum}, but name, description,
 * creation date and cover fall back to the first literal/IRI the strict generated reader
 * drops (language-tagged text, `xsd:date`, repeated singletons). Use before rebuilding.
 */
export function parseStoredAlbum(url: string, dataset: DatasetCore): Album | undefined {
  return readAlbum(url, dataset, true);
}

function readAlbum(url: string, dataset: DatasetCore, tolerant: boolean): Album | undefined {
  const subject = `${documentUrl(url)}#it`;
  const core = entities.ImageGallery.parse(subject, dataset);
  if (!core) return undefined;
  const doc = new ImageGalleryDoc(subject, dataset, DataFactory);
  const lenient = tolerant ? lenientPhoto(subject, dataset) : undefined;
  const cover = optionalHttpIri(core.coverUrl ?? lenient?.iri(`${SCHEMA}image`));
  const description = core.description ?? lenient?.text(`${SCHEMA}description`);
  const created = (core.dateCreated ?? lenient?.date(`${SCHEMA}dateCreated`))?.toISOString();
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
    : [...(core.legacyMembers ?? [])].sort();
  return {
    name: core.name ?? lenient?.text(`${SCHEMA}name`) ?? "",
    ...(description !== undefined ? { description } : {}),
    ...(created ? { dateCreated: created } : {}),
    ...(cover !== undefined ? { coverUrl: cover } : {}),
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
