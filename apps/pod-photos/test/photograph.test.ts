import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
function namedNode(iri: string) {
  return DataFactory.namedNode(iri);
}
function literal(v: string, dt: ReturnType<typeof namedNode>) {
  return DataFactory.literal(v, dt);
}
import {
  type Photo,
  PhotographDoc,
  buildPhoto,
  normaliseKeywords,
  parseKeywordsInput,
  parsePhoto,
} from '../src/photos/photograph.js';
import { EXIF, GEO, PHOTOGRAPH_CLASS, SCHEMA } from '../src/photos/vocab.js';

const ITEM = 'https://alice.example/photos/sunset.ttl';

const FULL: Photo = {
  name: 'Sunset over the bay',
  description: 'Golden hour from the pier',
  contentUrl: 'https://alice.example/photos/sunset.jpg',
  keywords: ['sunset', 'bay'],
  exif: {
    make: 'FUJIFILM',
    model: 'X-T5',
    lensModel: 'XF 35mm F1.4',
    focalLengthMm: 35,
    fNumber: 1.4,
    exposureTimeSec: 0.008,
    iso: 200,
    pixelWidth: 6240,
    pixelHeight: 4160,
    orientation: 1,
    dateTimeOriginal: '2026-06-15T18:41:07.000Z',
    location: { lat: 51.5, long: -0.12 },
  },
};

describe('keyword helpers', () => {
  it('trims, lower-dedupes (case-insensitive) and preserves order', () => {
    expect(normaliseKeywords([' Bay ', 'bay', 'Sunset', ''])).toEqual(['Bay', 'Sunset']);
  });
  it('parses comma/newline-separated input', () => {
    expect(parseKeywordsInput('bay, sunset\npier')).toEqual(['bay', 'sunset', 'pier']);
  });
});

describe('buildPhoto + parsePhoto round-trip', () => {
  it('round-trips a fully-populated photo', () => {
    const store = buildPhoto(ITEM, FULL);
    const parsed = parsePhoto(ITEM, store);
    expect(parsed).toEqual({
      name: FULL.name,
      description: FULL.description,
      contentUrl: FULL.contentUrl,
      keywords: ['bay', 'sunset'], // parse sorts keywords
      exif: FULL.exif,
    });
  });

  it('stamps the schema:Photograph type', () => {
    const store = buildPhoto(ITEM, FULL);
    const doc = new PhotographDoc(`${ITEM}#it`, store, DataFactory);
    expect(doc.types.has(PHOTOGRAPH_CLASS)).toBe(true);
  });

  it('round-trips an empty photo (no name / contentUrl) to empty strings', () => {
    const empty: Photo = { name: '', contentUrl: '', keywords: [], exif: {} };
    const store = buildPhoto(ITEM, empty);
    const parsed = parsePhoto(ITEM, store);
    expect(parsed).toEqual({ name: '', contentUrl: '', keywords: [], exif: {} });
    // An empty name/contentUrl writes no schema:name / schema:contentUrl triple.
    expect([...store.match(null, namedNode(`${SCHEMA}name`), null)]).toHaveLength(0);
    expect([...store.match(null, namedNode(`${SCHEMA}contentUrl`), null)]).toHaveLength(0);
  });

  it('round-trips a minimal photo (name + contentUrl only, no exif)', () => {
    const minimal: Photo = {
      name: 'Untitled',
      contentUrl: 'https://alice.example/photos/x.jpg',
      keywords: [],
      exif: {},
    };
    const store = buildPhoto(ITEM, minimal);
    const parsed = parsePhoto(ITEM, store);
    expect(parsed).toEqual({
      name: 'Untitled',
      contentUrl: minimal.contentUrl,
      keywords: [],
      exif: {},
    });
  });

  it('omits an undefined description on parse', () => {
    const { description: _drop, ...rest } = FULL;
    const store = buildPhoto(ITEM, { ...rest, keywords: [], exif: {} });
    const parsed = parsePhoto(ITEM, store);
    expect(parsed && 'description' in parsed).toBe(false);
  });

  it('writes EXIF pixel dimensions as schema:width/height triples', () => {
    const store = buildPhoto(ITEM, FULL);
    const widths = [...store.match(null, namedNode(`${SCHEMA}width`), null)];
    const heights = [...store.match(null, namedNode(`${SCHEMA}height`), null)];
    expect(widths[0]?.object.value).toBe('6240');
    expect(heights[0]?.object.value).toBe('4160');
  });

  it('writes the capture location as a nested geo:Point', () => {
    const store = buildPhoto(ITEM, FULL);
    const geoRef = `${ITEM}#geo`;
    const types = [...store.match(namedNode(geoRef), namedNode(RDF_TYPE), null)];
    expect(types[0]?.object.value).toBe(`${GEO}Point`);
    const lats = [...store.match(namedNode(geoRef), namedNode(`${GEO}lat`), null)];
    expect(Number(lats[0]?.object.value)).toBeCloseTo(51.5, 6);
  });

  it('writes exif: technical triples', () => {
    const store = buildPhoto(ITEM, FULL);
    const makes = [...store.match(null, namedNode(`${EXIF}make`), null)];
    expect(makes[0]?.object.value).toBe('FUJIFILM');
    const iso = [...store.match(null, namedNode(`${EXIF}isoSpeedRatings`), null)];
    expect(iso[0]?.object.value).toBe('200');
  });

  it('drops a corrupt EXIF value at build time (re-normalised)', () => {
    const store = buildPhoto(ITEM, {
      ...FULL,
      exif: { ...FULL.exif, iso: -5, fNumber: 0 },
    });
    const parsed = parsePhoto(ITEM, store);
    expect(parsed?.exif.iso).toBeUndefined();
    expect(parsed?.exif.fNumber).toBeUndefined();
    expect(parsed?.exif.make).toBe('FUJIFILM');
  });

  it('returns undefined for a document that is not a Photograph', () => {
    const empty = new Store();
    expect(parsePhoto(ITEM, empty)).toBeUndefined();
  });

  it('re-reads a tampered out-of-range geo as no location', () => {
    // Build a doc, then poison the geo:lat with an out-of-range value directly.
    const store = buildPhoto(ITEM, FULL);
    const geoRef = `${ITEM}#geo`;
    for (const q of [...store.match(namedNode(geoRef), namedNode(`${GEO}lat`), null)]) {
      store.delete(q);
    }
    store.addQuad(
      namedNode(geoRef),
      namedNode(`${GEO}lat`),
      literal('200', namedNode('http://www.w3.org/2001/XMLSchema#double')),
    );
    const parsed = parsePhoto(ITEM, store);
    expect(parsed?.exif.location).toBeUndefined();
  });
});
