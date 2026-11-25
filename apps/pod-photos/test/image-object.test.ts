// AUTHORED-BY Claude Sonnet 5.5
/**
 * `schema:ImageObject` documents written by other apps (creative-assets) are read as
 * photos; `schema:Photograph` is unchanged; the thumbnail node is skipped; edits keep
 * the other app's triples.
 *
 * The documents below follow the layout `@jeswr/solid-creative-assets` writes (`<doc#it>`
 * with `#thumbnail`, `#run`, `#prompt`, `#model`, `#setting-n`). They are Turtle fixtures,
 * not the package's own output: see the creative-assets README for why.
 */
import { DataFactory, Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { mergePhoto, parsePhoto } from '../src/photos/photograph.js';
import { albumsStore, photosStore } from '../src/photos/stores.js';
import { IMAGE_OBJECT_CLASS, PHOTOGRAPH_CLASS, SCHEMA } from '../src/photos/vocab.js';
import { MockPod, containerTurtle } from './helpers/mock-pod.js';

const POD = 'https://alice.example/';
const WEBID = 'https://alice.example/profile/card#me';
const SOLID = 'http://www.w3.org/ns/solid/terms#';
const DOC = 'https://alice.example/photos/sunset';
const PROV = 'http://www.w3.org/ns/prov#';

function parse(ttl: string): Store {
  return new Store(new Parser({ baseIRI: DOC }).parse(ttl));
}

/** An image document in the creative-assets layout, typed with `type` (default ImageObject). */
function assetTtl(type = `<${SCHEMA}ImageObject>`): string {
  return `
@prefix schema: <${SCHEMA}> .
@prefix prov: <${PROV}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${DOC}#it> a ${type} ;
  schema:name "Sunset fox" ;
  schema:description "A red fox at sunset." ;
  schema:contentUrl <https://alice.example/creative/files/sunset.png> ;
  schema:keywords "ai", "sunset" ;
  schema:width 1024 ; schema:height 768 ;
  schema:dateCreated "2026-06-15T09:41:07.000Z"^^xsd:dateTime ;
  schema:encodingFormat "image/png" ;
  schema:thumbnail <${DOC}#thumbnail> ;
  prov:wasGeneratedBy <${DOC}#run> .
<${DOC}#thumbnail> a <${SCHEMA}ImageObject> ;
  schema:contentUrl <https://alice.example/creative/files/sunset-thumb.webp> ;
  schema:width 128 ; schema:height 96 .
<${DOC}#run> a prov:Activity ;
  prov:used <${DOC}#prompt> ;
  prov:wasAssociatedWith <${DOC}#model> ;
  schema:additionalProperty <${DOC}#setting-1> .
<${DOC}#prompt> a prov:Entity ; schema:text "a red fox at sunset" .
<${DOC}#model> a <${SCHEMA}SoftwareApplication> ; schema:name "Flux Pro" .
<${DOC}#setting-1> a <${SCHEMA}PropertyValue> ; schema:propertyID "seed" ; schema:value "42" .
`;
}

describe('parsePhoto: schema:ImageObject', () => {
  it('reads an ImageObject document as a photo', () => {
    const photo = parsePhoto(DOC, parse(assetTtl()));
    expect(photo).toEqual({
      name: 'Sunset fox',
      description: 'A red fox at sunset.',
      contentUrl: 'https://alice.example/creative/files/sunset.png',
      keywords: ['ai', 'sunset'],
      exif: { pixelWidth: 1024, pixelHeight: 768, dateTimeOriginal: '2026-06-15T09:41:07.000Z' },
    });
  });

  it('still reads a schema:Photograph', () => {
    expect(parsePhoto(DOC, parse(assetTtl(`<${PHOTOGRAPH_CLASS}>`)))?.name).toBe('Sunset fox');
  });

  it('reads a Photograph that is also an ImageObject target of a thumbnail', () => {
    const ds = parse(assetTtl(`<${PHOTOGRAPH_CLASS}>, <${IMAGE_OBJECT_CLASS}>`));
    ds.addQuad(
      DataFactory.namedNode(`${DOC}#other`),
      DataFactory.namedNode(`${SCHEMA}thumbnail`),
      DataFactory.namedNode(`${DOC}#it`),
    );
    expect(parsePhoto(DOC, ds)?.name).toBe('Sunset fox');
  });

  it('does not read the thumbnail node as a photo', () => {
    // The library item is <doc#it>; a node that is a schema:thumbnail object is skipped.
    const ds = parse(`
      <${DOC}#parent> <${SCHEMA}thumbnail> <${DOC}#it> .
      <${DOC}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}name> "thumb" .
    `);
    expect(parsePhoto(DOC, ds)).toBeUndefined();
  });

  it('ignores the extra provenance nodes (one photo per document)', () => {
    const ds = parse(assetTtl());
    expect(parsePhoto(DOC, ds)?.keywords).toEqual(['ai', 'sunset']);
    // Only #it is ever a photo subject; the #thumbnail image is never a second photo.
    expect(parsePhoto(`${DOC}-other`, ds)).toBeUndefined();
  });

  it('behaves as before for the legacy http://schema.org/ scheme (not a photo)', () => {
    const legacy = `
      <${DOC}#it> a <http://schema.org/Photograph> ; <http://schema.org/name> "Old" .
    `;
    expect(parsePhoto(DOC, parse(legacy))).toBeUndefined();
    const legacyImage = `
      <${DOC}#it> a <http://schema.org/ImageObject> ; <http://schema.org/name> "Old" .
    `;
    expect(parsePhoto(DOC, parse(legacyImage))).toBeUndefined();
  });

  it('is not a photo when the type is neither', () => {
    expect(parsePhoto(DOC, parse(assetTtl(`<${SCHEMA}VideoObject>`)))).toBeUndefined();
  });
});

describe('listing through the store', () => {
  it('lists an ImageObject, a Photograph and a creative-assets document once each', async () => {
    const pod = new MockPod();
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const a = `${POD}photos/a`;
    const b = `${POD}photos/b`;
    const c = `${POD}photos/c`;
    const rewrite = (ttl: string, url: string) => ttl.replaceAll(DOC, url);
    pod.seed(a, rewrite(assetTtl(), a));
    pod.seed(b, rewrite(assetTtl(`<${PHOTOGRAPH_CLASS}>`), b));
    pod.seed(
      c,
      `<${c}#it> a <${SCHEMA}VideoObject> ; <${SCHEMA}name> "clip" .`,
    );
    pod.seed(`${POD}photos/`, containerTurtle(`${POD}photos/`, [a, b, c]));
    const listed = await store.list();
    expect(listed.map((i) => i.url)).toEqual([a, b]);
    expect(listed.map((i) => i.data.name)).toEqual(['Sunset fox', 'Sunset fox']);
  });
});

describe('editing a foreign ImageObject keeps the other app’s triples', () => {
  it('mergePhoto replaces modelled triples and keeps type and provenance nodes', () => {
    const existing = parse(assetTtl());
    const photo = parsePhoto(DOC, existing);
    if (!photo) throw new Error('expected a photo');
    const merged = mergePhoto(DOC, existing, {
      ...photo,
      name: 'Renamed',
      description: undefined,
      keywords: ['fox'],
    });
    const reread = parsePhoto(DOC, merged);
    expect(reread?.name).toBe('Renamed');
    expect(reread?.description).toBeUndefined();
    expect(reread?.keywords).toEqual(['fox']);
    expect(reread?.contentUrl).toBe(photo.contentUrl);

    const has = (s: string, p: string) =>
      merged.match(DataFactory.namedNode(s), DataFactory.namedNode(p), null).size;
    // Type is kept (not re-stamped schema:Photograph) and no duplicates appear.
    const types = [
      ...merged.match(
        DataFactory.namedNode(`${DOC}#it`),
        DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
        null,
      ),
    ].map((q) => q.object.value);
    expect(types).toEqual([IMAGE_OBJECT_CLASS]);
    expect(has(`${DOC}#it`, `${SCHEMA}name`)).toBe(1);
    // Other app's nodes and properties survive.
    expect(has(`${DOC}#it`, `${SCHEMA}thumbnail`)).toBe(1);
    expect(has(`${DOC}#it`, `${SCHEMA}encodingFormat`)).toBe(1);
    expect(has(`${DOC}#it`, `${PROV}wasGeneratedBy`)).toBe(1);
    expect(has(`${DOC}#thumbnail`, `${SCHEMA}contentUrl`)).toBe(1);
    expect(has(`${DOC}#run`, `${PROV}used`)).toBe(1);
    expect(has(`${DOC}#prompt`, `${SCHEMA}text`)).toBe(1);
    expect(has(`${DOC}#model`, `${SCHEMA}name`)).toBe(1);
    expect(has(`${DOC}#setting-1`, `${SCHEMA}value`)).toBe(1);
  });

  it('replaces an owned geo node and keeps a foreign one', () => {
    const existing = parse(`
      <${DOC}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}name> "x" ; <${SCHEMA}geo> <${DOC}#geo> .
      <${DOC}#geo> <http://www.w3.org/2003/01/geo/wgs84_pos#lat> 1 .
    `);
    const merged = mergePhoto(DOC, existing, {
      name: 'x',
      contentUrl: '',
      keywords: [],
      exif: { location: { lat: 2, long: 3 } },
    });
    expect(parsePhoto(DOC, merged)?.exif.location).toEqual({ lat: 2, long: 3 });

    const foreign = parse(`
      <${DOC}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}geo> <https://elsewhere.example/place> .
      <https://elsewhere.example/place> <${SCHEMA}name> "Place" .
    `);
    const kept = mergePhoto(DOC, foreign, { name: 'x', contentUrl: '', keywords: [], exif: {} });
    expect(
      kept.match(DataFactory.namedNode('https://elsewhere.example/place'), null, null).size,
    ).toBe(1);

    const blank = parse(`
      <${DOC}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}geo> [ <${SCHEMA}name> "blank" ] .
    `);
    const dropped = mergePhoto(DOC, blank, { name: 'x', contentUrl: '', keywords: [], exif: {} });
    expect(dropped.match(null, DataFactory.namedNode(`${SCHEMA}name`), null).size).toBe(1);
  });

  it('drops a malformed literal schema:geo value', () => {
    const odd = parse(`<${DOC}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}geo> "nowhere" .`);
    const merged = mergePhoto(DOC, odd, { name: 'x', contentUrl: '', keywords: [], exif: {} });
    expect(merged.match(null, DataFactory.namedNode(`${SCHEMA}geo`), null).size).toBe(0);
  });

  it('falls back to a fresh Photograph when the document holds no photo node', () => {
    const merged = mergePhoto(DOC, new Store(), {
      name: 'New',
      contentUrl: '',
      keywords: [],
      exif: {},
    });
    expect(parsePhoto(DOC, merged)?.name).toBe('New');
  });

  it('store.update writes the merged document through to the pod', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, `<${WEBID}> <${SOLID}oidcIssuer> <https://idp.example/> .`);
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    pod.seed(DOC, assetTtl());
    const item = await store.read(DOC);
    if (!item) throw new Error('expected an item');
    await store.update(DOC, { ...item.data, name: 'Renamed' }, item.etag);
    const body = pod.resources.get(DOC)?.body ?? '';
    expect(body).toContain('Renamed');
    expect(body).toContain('wasGeneratedBy');
    expect(body).toContain('setting-1');
    expect(body).toContain('ImageObject');
    expect(body).not.toContain('Photograph');
  });
});

describe('albums are still rewritten from the model (no merge)', () => {
  it('updates an album document', async () => {
    const pod = new MockPod();
    const albums = albumsStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const url = `${POD}albums/trip`;
    pod.seed(
      url,
      `<${url}#it> a <${SCHEMA}ImageGallery> ; <${SCHEMA}name> "Trip" .`,
    );
    await albums.update(url, { name: 'Trip 2', members: [`${DOC}#it`] });
    expect(pod.resources.get(url)?.body).toContain('Trip 2');
  });
});
