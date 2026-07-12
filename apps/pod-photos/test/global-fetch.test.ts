import { Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { photosStore } from '../src/photos/stores.js';
import { deleteResource, freshRdf, writeResource } from '../src/pod/rdf.js';
import { MockPod } from './helpers/mock-pod.js';

/**
 * The production paths omit `fetchImpl` so the auth-patched `globalThis.fetch`
 * runs. These tests stub the global to exercise those default branches (the
 * `fetchImpl ? … : …` ternaries) without a network.
 */
describe('production global-fetch paths', () => {
  const pod = new MockPod();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    pod.resources.clear();
    globalThis.fetch = vi.fn(pod.fetch) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('freshRdf uses globalThis.fetch when no fetchImpl is given', async () => {
    const url = 'https://alice.example/photos/a.ttl';
    pod.seed(url, '<#it> <https://schema.org/name> "Hi" .');
    const { dataset } = await freshRdf(url);
    expect([...dataset]).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('writeResource and deleteResource use globalThis.fetch with no fetchImpl', async () => {
    const url = 'https://alice.example/photos/a.ttl';
    const store = new Store();
    store.addQuad(
      (await import('n3')).DataFactory.namedNode(`${url}#it`),
      (await import('n3')).DataFactory.namedNode('https://schema.org/name'),
      (await import('n3')).DataFactory.literal('A'),
    );
    const { etag } = await writeResource(url, store);
    expect(etag).toBeTruthy();
    await deleteResource(url);
    expect(pod.resources.has(url)).toBe(false);
  });

  it('a store with no fetchImpl drives the whole create flow through the global', async () => {
    const POD = 'https://alice.example/';
    const WEBID = 'https://alice.example/profile/card#me';
    pod.seed(
      WEBID,
      `<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://idp.example/> .`,
    );
    const store = photosStore({ podRoot: POD, webId: WEBID });
    const { url } = await store.create({ name: 'X', contentUrl: '', keywords: [], exif: {} });
    expect(url.startsWith(`${POD}photos/`)).toBe(true);
  });
});
