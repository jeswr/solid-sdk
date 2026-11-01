// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBodySize,
  base64ToBytes,
  bytesToBase64,
  decodedBase64Length,
  encodeResponseBody,
  MAX_BODY_BYTES,
  REQUEST_BODY_LIMIT_ERROR,
  readBodyBounded,
  validateBase64,
  validateBodyFields,
} from '../src/shared/body-codec';

describe('bounded standard base64', () => {
  it.each([
    0, 1, 2, 3, 4, 5, 256, 24_576, 24_577, 24_578, 65_536,
  ])('round-trips %i random bytes with standard encoding', (length) => {
    const bytes = randomBytes(length);
    const encoded = bytesToBase64(bytes);
    expect(encoded).toBe(bytes.toString('base64'));
    expect(base64ToBytes(encoded)).toEqual(new Uint8Array(bytes));
  });

  it('decodes a multi-MiB valid payload without materialising a string iterator', () => {
    const bytes = randomBytes(4 * 1024 * 1024);
    const decoded = base64ToBytes(bytes.toString('base64'));
    expect(decoded.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(decoded).equals(bytes)).toBe(true);
  });

  it.each([
    'A',
    'AAA',
    'AAAAA',
    'AA A',
    'AA\nA',
    'AA-A',
    'AA_A',
    '=AAA',
    'A===',
    'AA=A',
    '====',
    'AB==',
    'AAB=',
  ])('rejects invalid or noncanonical base64 %j before decoding', (value) => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(() => base64ToBytes(value)).toThrow('Invalid base64 body');
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it('checks the raw and encoded boundary arithmetically, including padding within the same quartet', () => {
    const length = Math.ceil(MAX_BODY_BYTES / 3) * 4;
    expect(() => assertBodySize(MAX_BODY_BYTES)).not.toThrow();
    expect(() => assertBodySize(MAX_BODY_BYTES + 1)).toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(decodedBase64Length(length, 2)).toBe(MAX_BODY_BYTES);
    expect(() => decodedBase64Length(length, 1)).toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(() => decodedBase64Length(length + 4, 2)).toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(() => decodedBase64Length(4, 3)).toThrow('Invalid base64 body');
    expect(() => decodedBase64Length(0, 1)).toThrow('Invalid base64 body');
  });

  it('rejects attacker-sized encoded length without decoding, scanning or allocating bytes', () => {
    // A length-only stand-in proves the guard precedes even the first string operation.
    const oversized = { length: Math.ceil(MAX_BODY_BYTES / 3) * 4 + 4 } as string;
    const decode = vi.spyOn(globalThis, 'atob');
    expect(() => base64ToBytes(oversized)).toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it('validates mutually exclusive string fields and UTF-8 byte size', () => {
    for (const [body, binary] of [
      [null, undefined],
      [42, undefined],
      [undefined, null],
      ['', ''],
    ])
      expect(() => validateBodyFields(body, binary)).toThrow('mutually exclusive strings');
    expect(() => validateBodyFields(undefined, undefined)).not.toThrow();
    expect(() => validateBodyFields('', undefined)).not.toThrow();
    expect(() => validateBodyFields(undefined, '')).not.toThrow();
    expect(() => validateBase64('AA==')).not.toThrow();
  });
});

describe('bounded body streams', () => {
  const errorMessage = 'body too large';

  it('handles absent and empty bodies, and coalesces chunks up to the exact limit', async () => {
    expect(await readBodyBounded(null, 0, errorMessage)).toEqual(new Uint8Array(0));
    expect(
      await readBodyBounded(new ReadableStream({ start: (c) => c.close() }), 0, errorMessage),
    ).toEqual(new Uint8Array(0));
    const bytes = randomBytes(200_000);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(0));
        for (let offset = 0; offset < bytes.length; offset += 1000)
          controller.enqueue(bytes.subarray(offset, offset + 1000));
        controller.close();
      },
    });
    const result = await readBodyBounded(body, bytes.length, errorMessage);
    expect(Buffer.from(result).equals(bytes)).toBe(true);
    expect(result.buffer.byteLength).toBe(bytes.length);
    expect(body.locked).toBe(false);
  });

  it('cancels and rejects overflow before EOF even if cancellation never settles', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        // Intentionally never close: an arrayBuffer-style read would hang.
      },
      cancel,
    });
    await expect(readBodyBounded(body, 3, errorMessage)).rejects.toThrow(errorMessage);
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ message: errorMessage }));
    expect(body.locked).toBe(false);
  });

  it.each([
    'before reading',
    'during a pending read',
  ])('honours abort %s and releases the reader', async (when) => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    if (when === 'before reading') controller.abort(reason);
    const result = readBodyBounded(body, 3, errorMessage, controller.signal);
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
    await expect(readBodyBounded(null, 3, errorMessage, controller.signal)).rejects.toBe(reason);
  });

  it('propagates a stream failure and removes the abort listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const error = new Error('read failed');
    const body = new ReadableStream<Uint8Array>({ start: (c) => c.error(error) });
    await expect(readBodyBounded(body, 3, errorMessage, controller.signal)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(body.locked).toBe(false);
  });
});

it.each([
  null,
  'text/turtle',
  'TEXT/PLAIN; charset=utf-8',
  'application/json',
  'application/ld+json',
  'application/custom+json',
  'application/custom+xml',
  'application/xml',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
  'application/sparql-results+json',
  'application/javascript',
])('keeps valid UTF-8 as text for %s', (contentType) => {
  expect(encodeResponseBody(new TextEncoder().encode('hello 🌍'), contentType)).toEqual({
    body: 'hello 🌍',
  });
});

it('preserves binary MIME types and invalid UTF-8 as base64', () => {
  expect(encodeResponseBody(new Uint8Array([65]), 'image/png')).toEqual({ bodyBase64: 'QQ==' });
  expect(encodeResponseBody(new Uint8Array([255]), 'text/plain')).toEqual({ bodyBase64: '/w==' });
});
