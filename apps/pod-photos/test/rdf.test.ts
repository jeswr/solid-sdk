import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { ResourceDeleteError, ResourceWriteError } from '../src/pod/errors.js';
import {
  deleteResource,
  freshRdf,
  nameFromUrl,
  readResource,
  serializeTurtle,
  toSlug,
  writeResource,
} from '../src/pod/rdf.js';
import { MockPod } from './helpers/mock-pod.js';

const SCHEMA = 'https://schema.org/';

function sampleStore(): Store {
  const s = new Store();
  s.addQuad(
    DataFactory.namedNode('https://x.example/p#it'),
    DataFactory.namedNode(`${SCHEMA}name`),
    DataFactory.literal('Hello'),
  );
  return s;
}

describe('serializeTurtle', () => {
  it('serialises a dataset with prefixes', async () => {
    const ttl = await serializeTurtle(sampleStore(), { schema: SCHEMA });
    expect(ttl).toContain('schema:name');
    expect(ttl).toContain('"Hello"');
  });
});

describe('writeResource / readResource', () => {
  it('creates create-only then reads it back with an etag', async () => {
    const pod = new MockPod();
    const url = 'https://x.example/photos/a.ttl';
    const { etag } = await writeResource(url, sampleStore(), {
      createOnly: true,
      fetchImpl: pod.fetch,
      prefixes: { schema: SCHEMA },
    });
    expect(etag).toBeTruthy();
    const read = await readResource(url, pod.fetch);
    expect(read.etag).toBeTruthy();
    expect([...read.dataset]).toHaveLength(1);
  });

  it('throws ResourceWriteError(412) on create-only collision', async () => {
    const pod = new MockPod();
    const url = 'https://x.example/photos/a.ttl';
    await writeResource(url, sampleStore(), { createOnly: true, fetchImpl: pod.fetch });
    await expect(
      writeResource(url, sampleStore(), { createOnly: true, fetchImpl: pod.fetch }),
    ).rejects.toMatchObject({ status: 412 } satisfies Partial<ResourceWriteError>);
  });

  it('honours If-Match (412 on stale etag, ok on the current one)', async () => {
    const pod = new MockPod();
    const url = 'https://x.example/photos/a.ttl';
    await writeResource(url, sampleStore(), { createOnly: true, fetchImpl: pod.fetch });
    const current = pod.resources.get(url)?.etag ?? null;
    await expect(
      writeResource(url, sampleStore(), { etag: '"stale"', fetchImpl: pod.fetch }),
    ).rejects.toBeInstanceOf(ResourceWriteError);
    const ok = await writeResource(url, sampleStore(), { etag: current, fetchImpl: pod.fetch });
    expect(ok.etag).toBeTruthy();
  });
});

describe('deleteResource', () => {
  it('deletes an existing resource', async () => {
    const pod = new MockPod();
    const url = 'https://x.example/photos/a.ttl';
    pod.seed(url, '<#it> a <https://schema.org/Photograph> .');
    await deleteResource(url, pod.fetch);
    expect(pod.resources.has(url)).toBe(false);
  });

  it('treats a missing resource as success (idempotent)', async () => {
    const pod = new MockPod();
    await expect(deleteResource('https://x.example/gone.ttl', pod.fetch)).resolves.toBeUndefined();
  });

  it('throws ResourceDeleteError on a non-idempotent failure', async () => {
    const failing: typeof fetch = async () => new Response(null, { status: 500 });
    await expect(deleteResource('https://x.example/a.ttl', failing)).rejects.toBeInstanceOf(
      ResourceDeleteError,
    );
  });
});

describe('freshRdf', () => {
  it('sends a revalidation header and parses the body', async () => {
    const pod = new MockPod();
    const url = 'https://x.example/photos/a.ttl';
    pod.seed(url, '<#it> <https://schema.org/name> "Hi" .');
    const { dataset } = await freshRdf(url, pod.fetch);
    expect([...dataset]).toHaveLength(1);
  });
});

describe('nameFromUrl', () => {
  it('returns the last path segment, decoded', () => {
    expect(nameFromUrl('https://x.example/photos/My%20Pic.ttl')).toBe('My Pic.ttl');
  });
  it('falls back to the host for a root URL', () => {
    expect(nameFromUrl('https://x.example/')).toBe('x.example');
  });
  it('returns the input unchanged when it is not a URL', () => {
    expect(nameFromUrl('not a url')).toBe('not a url');
  });
});

describe('toSlug', () => {
  it('lower-cases, hyphenates and strips diacritics', () => {
    expect(toSlug('Café Déjà Vu!')).toBe('cafe-deja-vu');
  });
  it('returns empty for blank / uncleanable input', () => {
    expect(toSlug(undefined)).toBe('');
    expect(toSlug('   ')).toBe('');
    expect(toSlug('!!!')).toBe('');
  });
  it('never contains a colon', () => {
    expect(toSlug('a:b:c')).not.toContain(':');
  });
  it('caps the length', () => {
    expect(toSlug('a'.repeat(100)).length).toBeLessThanOrEqual(48);
  });
});
