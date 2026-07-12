import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  type Album,
  ImageGalleryDoc,
  addMember,
  buildAlbum,
  normaliseMembers,
  parseAlbum,
  removeMember,
} from '../src/photos/album.js';
import { IMAGE_GALLERY_CLASS, SCHEMA } from '../src/photos/vocab.js';

const ITEM = 'https://alice.example/albums/iceland.ttl';
const P1 = 'https://alice.example/photos/aurora.ttl#it';
const P2 = 'https://alice.example/photos/glacier.ttl#it';

const FULL: Album = {
  name: 'Iceland 2026',
  description: 'Ten days chasing the aurora',
  dateCreated: '2026-06-15T09:41:07.000Z',
  members: [P2, P1],
};

describe('normaliseMembers', () => {
  it('trims, dedupes, drops blanks and sorts', () => {
    expect(normaliseMembers([` ${P2} `, P1, P2, ''])).toEqual([P1, P2]);
  });
});

describe('buildAlbum + parseAlbum round-trip', () => {
  it('round-trips a fully-populated album', () => {
    const store = buildAlbum(ITEM, FULL);
    expect(parseAlbum(ITEM, store)).toEqual({
      name: FULL.name,
      description: FULL.description,
      dateCreated: FULL.dateCreated,
      members: [P1, P2], // sorted
    });
  });

  it('stamps the schema:ImageGallery type', () => {
    const store = buildAlbum(ITEM, FULL);
    const doc = new ImageGalleryDoc(`${ITEM}#it`, store, DataFactory);
    expect(doc.types.has(IMAGE_GALLERY_CLASS)).toBe(true);
  });

  it('links members with schema:hasPart', () => {
    const store = buildAlbum(ITEM, FULL);
    const parts = [...store.match(null, DataFactory.namedNode(`${SCHEMA}hasPart`), null)].map(
      (q) => q.object.value,
    );
    expect(parts.sort()).toEqual([P1, P2]);
  });

  it('round-trips a minimal album (name only)', () => {
    const store = buildAlbum(ITEM, { name: 'Untitled', members: [] });
    expect(parseAlbum(ITEM, store)).toEqual({ name: 'Untitled', members: [] });
  });

  it('round-trips an empty-name album to an empty string (no schema:name triple)', () => {
    const store = buildAlbum(ITEM, { name: '', members: [] });
    expect(parseAlbum(ITEM, store)).toEqual({ name: '', members: [] });
    expect([...store.match(null, DataFactory.namedNode(`${SCHEMA}name`), null)]).toHaveLength(0);
  });

  it('omits an undefined description / dateCreated on parse', () => {
    const store = buildAlbum(ITEM, { name: 'X', members: [] });
    const parsed = parseAlbum(ITEM, store);
    expect(parsed && 'description' in parsed).toBe(false);
    expect(parsed && 'dateCreated' in parsed).toBe(false);
  });

  it('ignores an invalid dateCreated at build time', () => {
    const store = buildAlbum(ITEM, { name: 'X', dateCreated: 'not-a-date', members: [] });
    const parsed = parseAlbum(ITEM, store);
    expect(parsed && 'dateCreated' in parsed).toBe(false);
  });

  it('returns undefined for a document that is not an ImageGallery', () => {
    expect(parseAlbum(ITEM, new Store())).toBeUndefined();
  });
});

describe('addMember / removeMember', () => {
  const base: Album = { name: 'A', members: [P1] };

  it('adds a member idempotently and keeps sorted order', () => {
    expect(addMember(base, P2).members).toEqual([P1, P2]);
    expect(addMember(base, P1).members).toEqual([P1]);
  });

  it('removes a member idempotently', () => {
    expect(removeMember({ name: 'A', members: [P1, P2] }, P1).members).toEqual([P2]);
    expect(removeMember(base, 'https://nope.example/x#it').members).toEqual([P1]);
  });

  it('preserves the other album fields', () => {
    const withMeta: Album = {
      name: 'A',
      description: 'd',
      dateCreated: FULL.dateCreated,
      members: [],
    };
    const out = addMember(withMeta, P1);
    expect(out.name).toBe('A');
    expect(out.description).toBe('d');
    expect(out.dateCreated).toBe(FULL.dateCreated);
  });
});
