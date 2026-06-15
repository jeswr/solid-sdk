import { RdfFetchError } from '@jeswr/fetch-rdf';
import { describe, expect, it } from 'vitest';
import type { Photo } from '../src/photos/photograph.js';
import { albumsStore, photosStore } from '../src/photos/stores.js';
import { OutOfScopeError } from '../src/pod/errors.js';
import { MockPod, containerTurtle } from './helpers/mock-pod.js';

const POD = 'https://alice.example/';
const WEBID = 'https://alice.example/profile/card#me';
const SOLID = 'http://www.w3.org/ns/solid/terms#';

function seedProfile(pod: MockPod): void {
  pod.seed(WEBID, `<${WEBID}> <${SOLID}oidcIssuer> <https://idp.example/> .`);
}

const PHOTO: Photo = {
  name: 'Aurora',
  contentUrl: 'https://alice.example/photos/aurora.jpg',
  keywords: ['aurora', 'iceland'],
  exif: { make: 'SONY', iso: 1600, location: { lat: 64.1, long: -21.9 } },
};

describe('photosStore CRUD', () => {
  it('creates (registering the type index), reads and lists a photo', async () => {
    const pod = new MockPod();
    seedProfile(pod);
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });

    const { url } = await store.create(PHOTO, 'Aurora');
    expect(url.startsWith('https://alice.example/photos/aurora-')).toBe(true);

    // Type index was bootstrapped + registered.
    const index = pod.resources.get('https://alice.example/settings/privateTypeIndex.ttl');
    expect(index?.body).toContain('Photograph');

    const read = await store.read(url);
    expect(read?.data.name).toBe('Aurora');
    expect(read?.data.exif.iso).toBe(1600);

    // The container listing makes the photo discoverable via list().
    pod.seed(`${POD}photos/`, containerTurtle(`${POD}photos/`, [url]));
    const listed = await store.list();
    expect(listed.map((i) => i.data.name)).toEqual(['Aurora']);
  });

  it('updates with If-Match and removes a photo', async () => {
    const pod = new MockPod();
    seedProfile(pod);
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const { url, etag } = await store.create(PHOTO);

    const updated = await store.update(url, { ...PHOTO, name: 'Northern Lights' }, etag);
    expect(updated.etag).toBeTruthy();
    expect((await store.read(url))?.data.name).toBe('Northern Lights');

    await store.remove(url);
    await expect(store.read(url)).rejects.toBeInstanceOf(RdfFetchError);
  });

  it('updates an in-scope item without an etag (unconditional PUT)', async () => {
    const pod = new MockPod();
    seedProfile(pod);
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const { url } = await store.create(PHOTO);
    const res = await store.update(url, { ...PHOTO, name: 'No-etag write' });
    expect(res.etag).toBeTruthy();
    expect((await store.read(url))?.data.name).toBe('No-etag write');
  });

  it('newItemUrl falls back to a random name with no slug, and never contains a colon', () => {
    const pod = new MockPod();
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    expect(store.newItemUrl()).toMatch(/^https:\/\/alice\.example\/photos\/[a-z0-9]+\.ttl$/);
    // The minted filename (the part after the container) must be colon-free.
    const fileName = store.newItemUrl('a:b').slice(`${POD}photos/`.length);
    expect(fileName).not.toContain(':');
    expect(fileName.startsWith('a-b-')).toBe(true);
    expect(store.container).toBe(`${POD}photos/`);
  });

  it('list returns [] for a missing container', async () => {
    const pod = new MockPod();
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    expect(await store.list()).toEqual([]);
  });

  it('list skips sub-containers and unparseable items', async () => {
    const pod = new MockPod();
    const container = `${POD}photos/`;
    const good = `${container}good.ttl`;
    const junk = `${container}junk.ttl`;
    pod.seed(good, '<#it> a <https://schema.org/Photograph> ; <https://schema.org/name> "G" .');
    pod.seed(junk, '<#it> a <https://schema.org/Thing> .'); // wrong class → parse undefined
    pod.seed(container, containerTurtle(container, [good, junk, `${container}sub/`]));
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const listed = await store.list();
    expect(listed.map((i) => i.url)).toEqual([good]);
  });

  it('list keeps loading when one item read throws', async () => {
    const pod = new MockPod();
    const container = `${POD}photos/`;
    const good = `${container}good.ttl`;
    const broken = `${container}broken.ttl`;
    pod.seed(good, '<#it> a <https://schema.org/Photograph> ; <https://schema.org/name> "G" .');
    pod.seed(container, containerTurtle(container, [good, broken]));
    // `broken` is listed but 404s on read.
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const listed = await store.list();
    expect(listed.map((i) => i.url)).toEqual([good]);
  });

  it('returns undefined when reading a resource of the wrong class', async () => {
    const pod = new MockPod();
    const url = `${POD}photos/x.ttl`;
    pod.seed(url, '<#it> a <https://schema.org/Thing> .');
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    expect(await store.read(url)).toBeUndefined();
  });
});

describe('confused-deputy scope guard', () => {
  const pod = new MockPod();
  const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });

  const outOfScope = [
    'https://alice.example/secrets/key.ttl', // different container
    'https://evil.example/photos/x.ttl', // different origin
    `${POD}photos/`, // the container root itself
    `${POD}photos/sub/x.ttl`, // a nested descendant
    `${POD}photos/x.ttl?id=1`, // query string
    `${POD}photos/x.ttl#frag`, // fragment
    `${POD}photos/a%2fb.ttl`, // encoded slash
    'not a url', // unparseable
  ];

  for (const url of outOfScope) {
    it(`rejects ${url}`, async () => {
      await expect(store.read(url)).rejects.toBeInstanceOf(OutOfScopeError);
      await expect(store.update(url, PHOTO)).rejects.toBeInstanceOf(OutOfScopeError);
      await expect(store.remove(url)).rejects.toBeInstanceOf(OutOfScopeError);
    });
  }

  it('accepts a direct child resource', () => {
    expect(() => store.newItemUrl('ok')).not.toThrow();
  });
});

describe('albumsStore CRUD', () => {
  it('creates an album and registers ImageGallery', async () => {
    const pod = new MockPod();
    seedProfile(pod);
    const store = albumsStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const { url } = await store.create({ name: 'Iceland', members: [] }, 'Iceland');
    expect(url.startsWith(`${POD}albums/iceland-`)).toBe(true);
    const index = pod.resources.get('https://alice.example/settings/privateTypeIndex.ttl');
    expect(index?.body).toContain('ImageGallery');
    expect((await store.read(url))?.data.name).toBe('Iceland');
  });
});
