// AUTHORED-BY Codex GPT-6.1-Sol
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
