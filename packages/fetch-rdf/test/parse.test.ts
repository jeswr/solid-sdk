import { describe, expect, it } from 'vitest';
import {
  parseRdf,
  extractMediaType,
  RdfFetchError,
  SUPPORTED_RDF_MEDIA_TYPES,
} from '../src/index.js';
import {
  JSON_LD_SAMPLE,
  N_QUADS_SAMPLE,
  N_TRIPLES_SAMPLE,
  TURTLE_SAMPLE,
} from './helpers.js';

describe('parseRdf', () => {
  it('parses Turtle into a dataset', async () => {
    const ds = await parseRdf(TURTLE_SAMPLE, 'text/turtle', {
      baseIRI: 'http://example.org/',
    });
    expect(ds.size).toBe(5);
  });

  it('parses Turtle when Content-Type carries parameters', async () => {
    const ds = await parseRdf(TURTLE_SAMPLE, 'text/turtle; charset=utf-8', {
      baseIRI: 'http://example.org/',
    });
    expect(ds.size).toBe(5);
  });

  it('parses N-Triples into a dataset', async () => {
    const ds = await parseRdf(N_TRIPLES_SAMPLE, 'application/n-triples');
    expect(ds.size).toBe(3);
  });

  it('parses N-Quads into a dataset, preserving graph', async () => {
    const ds = await parseRdf(N_QUADS_SAMPLE, 'application/n-quads');
    expect(ds.size).toBe(2);
    for (const q of ds) {
      expect(q.graph.value).toBe('http://example.org/g1');
    }
  });

  it('parses JSON-LD into a dataset', async () => {
    const ds = await parseRdf(JSON_LD_SAMPLE, 'application/ld+json', {
      baseIRI: 'http://example.org/',
    });
    // Alice has @type, name, knows → 3 quads.
    expect(ds.size).toBe(3);
  });

  it('parses JSON-LD when Content-Type carries parameters', async () => {
    const ds = await parseRdf(JSON_LD_SAMPLE, 'application/ld+json; profile="http://www.w3.org/ns/json-ld#expanded"');
    expect(ds.size).toBe(3);
  });

  it('defaults to text/turtle when Content-Type header is null', async () => {
    const ds = await parseRdf(TURTLE_SAMPLE, null, { baseIRI: 'http://example.org/' });
    expect(ds.size).toBe(5);
  });

  it('throws RdfFetchError on unsupported media type', async () => {
    await expect(
      parseRdf('whatever', 'application/rdf+xml'),
    ).rejects.toBeInstanceOf(RdfFetchError);
    await expect(
      parseRdf('whatever', 'application/rdf+xml'),
    ).rejects.toMatchObject({
      contentType: 'application/rdf+xml',
    });
  });

  it('throws RdfFetchError on a malformed Content-Type header', async () => {
    await expect(parseRdf('whatever', 'not a media type ///')).rejects.toBeInstanceOf(
      RdfFetchError,
    );
  });

  it('throws RdfFetchError wrapping a Turtle parse failure', async () => {
    await expect(
      parseRdf('this is { not valid turtle', 'text/turtle'),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });

  it('throws RdfFetchError wrapping a JSON-LD parse failure', async () => {
    await expect(
      parseRdf('{ this is not json', 'application/ld+json'),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });

  it('exposes the supported media-type list', () => {
    expect(SUPPORTED_RDF_MEDIA_TYPES).toEqual(
      expect.arrayContaining([
        'text/turtle',
        'application/n-triples',
        'application/n-quads',
        'application/ld+json',
      ]),
    );
  });

  it('parses a ReadableStream body, decoding multi-byte UTF-8 split across chunks', async () => {
    // The literal "café" — `é` is two bytes in UTF-8 (0xC3 0xA9). We
    // split the stream right between those two bytes to make sure the
    // streaming `TextDecoder` carries the partial sequence across the
    // chunk boundary instead of emitting a replacement character.
    const turtle = `<http://example.org/s> <http://example.org/p> "café" .\n`;
    const bytes = new TextEncoder().encode(turtle);
    const split = turtle.indexOf('é') + 1; // sits between the two bytes of `é`
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });

    const ds = await parseRdf(stream, 'application/n-triples');
    expect(ds.size).toBe(1);
    const [quad] = [...ds];
    expect(quad?.object.value).toBe('café');
  });

  it('parses a ReadableStream body byte-by-byte without losing data', async () => {
    // Pathological chunking: one byte per enqueue. Exercises the
    // streaming pump's backpressure / many-iterations path and
    // confirms `TextDecoder({ stream: true })` reassembles the
    // document correctly.
    const bytes = new TextEncoder().encode(TURTLE_SAMPLE);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });

    const ds = await parseRdf(stream, 'text/turtle', {
      baseIRI: 'http://example.org/',
    });
    expect(ds.size).toBe(5);
  });
});

describe('extractMediaType', () => {
  it('strips parameters and lowercases', () => {
    expect(extractMediaType('Text/Turtle; charset=UTF-8')).toBe('text/turtle');
  });

  it('returns null for null input', () => {
    expect(extractMediaType(null)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(extractMediaType('not a media type ///')).toBeNull();
  });
});
