import { describe, expect, it, vi } from 'vitest';
import { fetchRdf, RdfFetchError, DEFAULT_ACCEPT } from '../src/index.js';
import { JSON_LD_SAMPLE, TURTLE_SAMPLE, makeResponse } from './helpers.js';

describe('fetchRdf', () => {
  it('GETs the URL with the default Accept header and parses Turtle', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(TURTLE_SAMPLE, {
        contentType: 'text/turtle',
        etag: '"abc123"',
        url: 'http://example.org/resource',
      }),
    );

    const result = await fetchRdf('http://example.org/resource', {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('accept')).toBe(DEFAULT_ACCEPT);

    expect(result.dataset.size).toBe(5);
    expect(result.etag).toBe('"abc123"');
    expect(result.contentType).toBe('text/turtle');
    expect(result.url).toBe('http://example.org/resource');
    expect(result.response.status).toBe(200);
  });

  it('parses JSON-LD when the server returns it', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(JSON_LD_SAMPLE, {
        contentType: 'application/ld+json',
        url: 'http://example.org/resource',
      }),
    );

    const result = await fetchRdf('http://example.org/resource', {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.dataset.size).toBe(3);
    expect(result.contentType).toBe('application/ld+json');
    expect(result.etag).toBeNull();
  });

  it('strips Content-Type parameters in the returned `contentType` field', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(TURTLE_SAMPLE, {
        contentType: 'text/turtle; charset=utf-8',
        url: 'http://example.org/resource',
      }),
    );

    const result = await fetchRdf('http://example.org/resource', {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.contentType).toBe('text/turtle');
    expect(result.dataset.size).toBe(5);
  });

  it('honours a custom accept header', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(TURTLE_SAMPLE, { contentType: 'text/turtle' }),
    );

    await fetchRdf('http://example.org/resource', {
      fetch: fetchMock as unknown as typeof fetch,
      accept: 'application/ld+json',
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('accept')).toBe('application/ld+json');
  });

  it('overrides any caller-supplied accept in `headers`', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(TURTLE_SAMPLE, { contentType: 'text/turtle' }),
    );

    await fetchRdf('http://example.org/resource', {
      fetch: fetchMock as unknown as typeof fetch,
      headers: { accept: 'text/html' },
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('accept')).toBe(DEFAULT_ACCEPT);
  });

  it('wraps a network error in RdfFetchError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection refused');
    });

    await expect(
      fetchRdf('http://example.org/resource', {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: 'RdfFetchError',
      url: 'http://example.org/resource',
    });
  });

  it('throws RdfFetchError with status on a 404', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse('not found', {
        status: 404,
        contentType: 'text/plain',
        url: 'http://example.org/missing',
      }),
    );

    const err = await fetchRdf('http://example.org/missing', {
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdfFetchError);
    expect(err).toMatchObject({
      status: 404,
      url: 'http://example.org/missing',
      contentType: 'text/plain',
    });
  });

  it('throws RdfFetchError with status on a 500', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse('boom', { status: 500, url: 'http://example.org/r' }),
    );

    const err = await fetchRdf('http://example.org/r', {
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdfFetchError);
    expect((err as RdfFetchError).status).toBe(500);
  });

  it('treats a missing Content-Type header as Turtle', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse(TURTLE_SAMPLE, {
        omitContentType: true,
        url: 'http://example.org/r',
      }),
    );

    const result = await fetchRdf('http://example.org/r', {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.dataset.size).toBe(5);
    expect(result.contentType).toBeNull();
  });

  it('throws RdfFetchError on an unsupported response Content-Type', async () => {
    const fetchMock = vi.fn(async () =>
      makeResponse('<html/>', {
        contentType: 'text/html',
        url: 'http://example.org/r',
      }),
    );

    await expect(
      fetchRdf('http://example.org/r', {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });
});
