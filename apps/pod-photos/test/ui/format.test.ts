// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation-helper tests (node environment — no DOM, no RDF).

import { describe, expect, it } from 'vitest';
import type { Photo } from '../../src/index.js';
import { errorMessage, photoAltText, photoDimensions, photoTitle } from '../../src/ui/index.js';

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    name: 'Sunset over the bay',
    contentUrl: 'https://pod.example/photos/sunset.jpg',
    keywords: [],
    exif: {},
    ...overrides,
  };
}

describe('photoTitle', () => {
  it('uses schema:name when present', () => {
    expect(photoTitle('https://pod.example/photos/x.ttl', photo())).toBe('Sunset over the bay');
  });

  it('falls back to the URL tail when the name is blank', () => {
    expect(photoTitle('https://pod.example/photos/aurora.ttl', photo({ name: '   ' }))).toBe(
      'aurora.ttl',
    );
  });
});

describe('photoAltText', () => {
  it('is just the title when there are no keywords', () => {
    expect(photoAltText('https://pod.example/photos/x.ttl', photo())).toBe('Sunset over the bay');
  });

  it('appends the keyword list when present', () => {
    expect(
      photoAltText('https://pod.example/photos/x.ttl', photo({ keywords: ['sunset', 'bay'] })),
    ).toBe('Sunset over the bay — sunset, bay');
  });
});

describe('photoDimensions', () => {
  it('formats "W × H" when both EXIF dimensions are present', () => {
    expect(photoDimensions(photo({ exif: { pixelWidth: 6240, pixelHeight: 4160 } }))).toBe(
      '6240 × 4160',
    );
  });

  it('returns undefined when a dimension is missing', () => {
    expect(photoDimensions(photo({ exif: { pixelWidth: 6240 } }))).toBeUndefined();
    expect(photoDimensions(photo({ exif: { pixelHeight: 4160 } }))).toBeUndefined();
    expect(photoDimensions(photo())).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
  });
});
