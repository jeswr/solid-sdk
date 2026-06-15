import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  ensureTypeRegistrations,
  typeIndexLinks,
} from '../src/pod/type-index.js';
import { MockPod } from './helpers/mock-pod.js';

const POD = 'https://alice.example/';
const WEBID = 'https://alice.example/profile/card#me';
const PROFILE_DOC = 'https://alice.example/profile/card';
const PRIVATE_INDEX = 'https://alice.example/settings/privateTypeIndex.ttl';
const PHOTO_CLASS = 'https://schema.org/Photograph';
const PHOTOS_CONTAINER = 'https://alice.example/photos/';
const SOLID = 'http://www.w3.org/ns/solid/terms#';

function profileWithIndex(): string {
  return `
    @prefix solid: <${SOLID}> .
    <${WEBID}> solid:privateTypeIndex <${PRIVATE_INDEX}> ;
               <http://www.w3.org/ns/pim/space#storage> <${POD}> .
  `;
}

function bareProfile(): string {
  return `<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://idp.example/> .`;
}

describe('typeIndexLinks', () => {
  it('reads the private/public index links off the profile subject', () => {
    const pod = new MockPod();
    pod.seed(WEBID, profileWithIndex());
    return pod.fetch(WEBID).then(async () => {
      const { dataset } = await import('../src/pod/rdf.js').then((m) =>
        m.freshRdf(WEBID, pod.fetch),
      );
      const links = typeIndexLinks(WEBID, dataset);
      expect(links.privateIndex).toBe(PRIVATE_INDEX);
      expect(links.publicIndex).toBeUndefined();
    });
  });
});

describe('ProfileTypeIndexAnchor', () => {
  it('reads + writes the private index link', () => {
    const store = new Store();
    const anchor = new ProfileTypeIndexAnchor(WEBID, store, DataFactory);
    expect(anchor.privateIndex).toBeUndefined();
    anchor.privateIndex = PRIVATE_INDEX;
    expect(anchor.privateIndex).toBe(PRIVATE_INDEX);
  });
});

describe('TypeRegistration accessors', () => {
  it('round-trips the forClass / instance / instanceContainer setters', async () => {
    const { TypeRegistration } = await import('../src/pod/type-index.js');
    const store = new Store();
    const reg = new TypeRegistration(`${PRIVATE_INDEX}#r`, store, DataFactory);
    reg.markRegistration();
    reg.forClass = PHOTO_CLASS;
    reg.instance = 'https://alice.example/single.ttl';
    reg.instanceContainer = PHOTOS_CONTAINER;
    expect(reg.forClass).toBe(PHOTO_CLASS);
    expect(reg.instance).toBe('https://alice.example/single.ttl');
    expect(reg.instanceContainer).toBe(PHOTOS_CONTAINER);
  });
});

describe('TypeIndexDataset', () => {
  it('locates by class (container + instance forms) and skips entries with no forClass', () => {
    const OTHER = 'https://schema.org/ImageGallery';
    const ttl = `
      @prefix solid: <${SOLID}> .
      <${PRIVATE_INDEX}#a> a solid:TypeRegistration ;
        solid:forClass <${PHOTO_CLASS}> ; solid:instanceContainer <${PHOTOS_CONTAINER}> .
      <${PRIVATE_INDEX}#b> a solid:TypeRegistration ;
        solid:forClass <${OTHER}> ; solid:instance <https://alice.example/x.ttl> .
      <${PRIVATE_INDEX}#c> a solid:TypeRegistration ;
        solid:instance <https://alice.example/orphan.ttl> .
    `;
    const pod = new MockPod();
    pod.seed(PRIVATE_INDEX, ttl);
    return import('../src/pod/rdf.js').then(async (m) => {
      const { dataset } = await m.freshRdf(PRIVATE_INDEX, pod.fetch);
      const index = new TypeIndexDataset(dataset, DataFactory);
      expect(index.locate(PHOTO_CLASS).map((l) => l.container)).toEqual([PHOTOS_CONTAINER]);
      // The instance form is read back too.
      expect(index.locate(OTHER)[0]?.instance).toBe('https://alice.example/x.ttl');
      // The `#c` entry has no solid:forClass, so all() skips it — only #a + #b.
      expect(index.all()).toHaveLength(2);
    });
  });
});

describe('ensureTypeRegistrations', () => {
  it('adds a registration to an existing private index', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, profileWithIndex());
    pod.seed(PRIVATE_INDEX, `@prefix solid: <${SOLID}> .\n`);
    const res = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
      fetchImpl: pod.fetch,
    });
    expect(res.indexUrl).toBe(PRIVATE_INDEX);
    expect(res.added).toBe(1);
    expect(res.bootstrapped).toBe(false);
    expect(pod.resources.get(PRIVATE_INDEX)?.body).toContain('Photograph');
  });

  it('is idempotent — re-running adds nothing', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, profileWithIndex());
    pod.seed(PRIVATE_INDEX, `@prefix solid: <${SOLID}> .\n`);
    const opts = {
      webId: WEBID,
      podRoot: POD,
      registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
      fetchImpl: pod.fetch,
    };
    await ensureTypeRegistrations(opts);
    const second = await ensureTypeRegistrations(opts);
    expect(second.added).toBe(0);
  });

  it('bootstraps a private index when the profile has none and links it', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, bareProfile());
    const res = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
      fetchImpl: pod.fetch,
    });
    expect(res.bootstrapped).toBe(true);
    expect(res.indexUrl).toBe(PRIVATE_INDEX);
    expect(pod.resources.has(PRIVATE_INDEX)).toBe(true);
    // The profile document now links the new index.
    expect(pod.resources.get(PROFILE_DOC)?.body).toContain('privateTypeIndex');
  });

  it('reuses an out-of-band index that already exists (412 on create)', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, bareProfile());
    // The index already exists but is not linked from the profile.
    pod.seed(PRIVATE_INDEX, `@prefix solid: <${SOLID}> .\n`);
    const res = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
      fetchImpl: pod.fetch,
    });
    expect(res.bootstrapped).toBe(true);
    expect(res.added).toBe(1);
    expect(pod.resources.get(PRIVATE_INDEX)?.body).toContain('Photograph');
  });

  it('propagates a non-412 failure when creating the index document', async () => {
    const pod = new MockPod();
    pod.seed(WEBID, bareProfile());
    const baseFetch = pod.fetch;
    const failingCreate: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT' && url === PRIVATE_INDEX) {
        return new Response('boom', { status: 500 });
      }
      return baseFetch(input, init);
    };
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
        fetchImpl: failingCreate,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('falls back to the public index when only that is linked', async () => {
    const PUBLIC_INDEX = 'https://alice.example/settings/publicTypeIndex.ttl';
    const pod = new MockPod();
    pod.seed(
      WEBID,
      `@prefix solid: <${SOLID}> .\n<${WEBID}> solid:publicTypeIndex <${PUBLIC_INDEX}> .`,
    );
    pod.seed(PUBLIC_INDEX, `@prefix solid: <${SOLID}> .\n`);
    const res = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [{ forClass: PHOTO_CLASS, container: PHOTOS_CONTAINER }],
      fetchImpl: pod.fetch,
    });
    expect(res.indexUrl).toBe(PUBLIC_INDEX);
    expect(res.bootstrapped).toBe(false);
  });
});
