import { RdfFetchError } from '@jeswr/fetch-rdf';
import { describe, expect, it } from 'vitest';
import { listContainer } from '../src/pod/container.js';
import { MockPod, containerTurtle, richContainerTurtle } from './helpers/mock-pod.js';

const CONTAINER = 'https://alice.example/photos/';

describe('listContainer', () => {
  it('lists direct children, skipping a self-listed container entry', async () => {
    const pod = new MockPod();
    // Some servers list the container itself among ldp:contains — it must be
    // skipped (the self-description), never returned as a child.
    pod.seed(
      CONTAINER,
      containerTurtle(CONTAINER, [
        CONTAINER,
        `${CONTAINER}a.ttl`,
        `${CONTAINER}b.ttl`,
        `${CONTAINER}sub/`,
      ]),
    );
    const entries = await listContainer(CONTAINER, pod.fetch);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(`${CONTAINER}a.ttl`);
    expect(urls).toContain(`${CONTAINER}b.ttl`);
    expect(urls).not.toContain(CONTAINER);
  });

  it('normalises a container URL missing its trailing slash', async () => {
    const pod = new MockPod();
    pod.seed(CONTAINER, containerTurtle(CONTAINER, [`${CONTAINER}a.ttl`]));
    const entries = await listContainer('https://alice.example/photos', pod.fetch);
    expect(entries.map((e) => e.url)).toEqual([`${CONTAINER}a.ttl`]);
  });

  it('returns [] for an empty container', async () => {
    const pod = new MockPod();
    pod.seed(CONTAINER, containerTurtle(CONTAINER, []));
    expect(await listContainer(CONTAINER, pod.fetch)).toEqual([]);
  });

  it('returns [] for a missing (404) container', async () => {
    const pod = new MockPod();
    expect(await listContainer(CONTAINER, pod.fetch)).toEqual([]);
  });

  it('returns [] for a forbidden (403) container', async () => {
    const forbidden: typeof fetch = async () => new Response('no', { status: 403 });
    expect(await listContainer(CONTAINER, forbidden)).toEqual([]);
  });

  it('returns [] for an unauthorized (401) container', async () => {
    const unauth: typeof fetch = async () => new Response('no', { status: 401 });
    expect(await listContainer(CONTAINER, unauth)).toEqual([]);
  });

  it('propagates a non-WAC error', async () => {
    const boom: typeof fetch = async () => new Response('err', { status: 500 });
    await expect(listContainer(CONTAINER, boom)).rejects.toBeInstanceOf(RdfFetchError);
  });

  it('surfaces per-child modified / size / mimeType when present', async () => {
    const pod = new MockPod();
    pod.seed(
      CONTAINER,
      richContainerTurtle(CONTAINER, [
        {
          url: `${CONTAINER}photo.ttl`,
          modified: '2026-06-15T09:41:07.000Z',
          size: 2048,
          mimeType: 'image/jpeg',
        },
      ]),
    );
    const [entry] = await listContainer(CONTAINER, pod.fetch);
    expect(entry?.modified).toBe('2026-06-15T09:41:07.000Z');
    expect(entry?.size).toBe(2048);
    // @solid/object derives mimeType from the IANA media-type rdf:type IRI and
    // returns the full IRI (its `match[0]`), so the entry carries that IRI.
    expect(entry?.mimeType).toBe('http://www.w3.org/ns/iana/media-types/image/jpeg#Resource');
  });

  it('sorts sub-containers before resources, then by name', async () => {
    const pod = new MockPod();
    pod.seed(
      CONTAINER,
      richContainerTurtle(CONTAINER, [
        { url: `${CONTAINER}z.ttl` },
        { url: `${CONTAINER}sub/`, container: true },
        { url: `${CONTAINER}a.ttl` },
      ]),
    );
    const order = (await listContainer(CONTAINER, pod.fetch)).map((e) => e.url);
    expect(order).toEqual([`${CONTAINER}sub/`, `${CONTAINER}a.ttl`, `${CONTAINER}z.ttl`]);
  });
});
