// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import {
  addMember,
  buildAlbum,
  ImageGalleryDoc,
  ListItemDoc,
  normaliseMembers,
  parseAlbum,
  removeMember,
  reorderMembers,
} from "../../src/apps/photos/lib/model/album.js";

const url = "https://pod.example/photos/albums/holiday.ttl";
const a = "https://pod.example/photos/items/a.ttl#it";
const b = "https://pod.example/photos/items/b.ttl#it";
const c = "https://pod.example/photos/items/c.ttl#it";
it("round-trips album fields and writes contiguous one-based ListItem positions", () => {
  const album = {
    name: "Holiday",
    description: "Our photos",
    dateCreated: "2026-06-15T10:00:00.000Z",
    coverUrl: a,
    members: [c, a, b],
  };
  const dataset = buildAlbum(url, album);
  expect(parseAlbum(url, dataset)).toEqual(album);
  const doc = new ImageGalleryDoc(`${url}#it`, dataset, DataFactory);
  expect(
    [...doc.elements].map((ref) => {
      const item = new ListItemDoc(ref, dataset, DataFactory);
      expect([...item.types]).toEqual(["https://schema.org/ListItem"]);
      return [item.item, item.position];
    }),
  ).toEqual([
    [c, 1],
    [a, 2],
    [b, 3],
  ]);
  const reordered = reorderMembers(album, [b, c, a]);
  expect(parseAlbum(url, buildAlbum(url, reordered))?.members).toEqual([b, c, a]);
  expect(album.members).toEqual([c, a, b]);
});
it("normalises members in insertion order and supports immutable idempotent add/remove", () => {
  expect(normaliseMembers([` ${a} `, "", a, b])).toEqual([a, b]);
  const album = { name: "", members: [a] };
  expect(addMember(album, a)).toEqual(album);
  expect(addMember(album, b).members).toEqual([a, b]);
  expect(removeMember(album, a).members).toEqual([]);
  expect(removeMember(album, b)).toEqual(album);
  expect(parseAlbum(url, buildAlbum(url, { name: "", members: [] }))).toEqual({
    name: "",
    members: [],
  });
  const empty = buildAlbum(url, { name: "", members: [] });
  new ImageGalleryDoc(`${url}#it`, empty, DataFactory).name = undefined;
  expect(parseAlbum(url, empty)?.name).toBe("");
  expect(parseAlbum(url, new Store())).toBeUndefined();
  for (const members of [[a, a], [b], [], [a, b]])
    expect(() => reorderMembers(album, members)).toThrow();
});
it("reads legacy pod-photos hasPart membership and rejects malformed ListItems", () => {
  const dataset = new Store();
  const doc = new ImageGalleryDoc(`${url}#it`, dataset, DataFactory);
  doc.types.add("https://schema.org/ImageGallery");
  doc.legacyMembers.add(c);
  doc.legacyMembers.add(a);
  expect(parseAlbum(url, dataset)?.members).toEqual([a, c]);
  const ref = `${url}#entry`;
  doc.elements.add(ref);
  const entry = new ListItemDoc(ref, dataset, DataFactory);
  expect(() => parseAlbum(url, dataset)).toThrow();
  entry.item = a;
  for (const position of [undefined, 0, -1, 1.5]) {
    entry.position = position;
    expect(() => parseAlbum(url, dataset)).toThrow();
  }
  entry.position = 1;
  entry.item = undefined;
  expect(() => parseAlbum(url, dataset)).toThrow();
  doc.coverUrl = undefined;
});
it("sorts equal positions deterministically", async () => {
  const dataset = await parseRdf(
    `@prefix s: <https://schema.org/>. <#it> a s:ImageGallery; s:itemListElement <#b>,<#a>. <#b> s:item <${b}>; s:position 1. <#a> s:item <${a}>; s:position 1.`,
    "text/turtle",
    { baseIRI: url },
  );
  expect(parseAlbum(url, dataset)?.members).toEqual([a, b]);
});
