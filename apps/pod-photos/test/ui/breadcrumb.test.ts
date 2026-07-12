// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Breadcrumb-derivation tests (node environment — pure string logic).

import { describe, expect, it } from 'vitest';
import { breadcrumbFor } from '../../src/ui/index.js';

describe('breadcrumbFor', () => {
  it('returns a single root crumb for the root itself (default "Photos" label)', () => {
    expect(breadcrumbFor('https://pod.example/photos/', 'https://pod.example/photos/')).toEqual([
      { url: 'https://pod.example/photos/', label: 'Photos' },
    ]);
  });

  it('honours a custom root label', () => {
    expect(
      breadcrumbFor('https://pod.example/photos/', 'https://pod.example/photos/', 'Library'),
    ).toEqual([{ url: 'https://pod.example/photos/', label: 'Library' }]);
  });

  it('builds a trail down into sub-containers', () => {
    expect(
      breadcrumbFor('https://pod.example/photos/2026/iceland/', 'https://pod.example/photos/'),
    ).toEqual([
      { url: 'https://pod.example/photos/', label: 'Photos' },
      { url: 'https://pod.example/photos/2026/', label: '2026' },
      { url: 'https://pod.example/photos/2026/iceland/', label: 'iceland' },
    ]);
  });

  it('decodes percent-encoded path segments', () => {
    expect(
      breadcrumbFor('https://pod.example/photos/New%20York/', 'https://pod.example/photos/'),
    ).toEqual([
      { url: 'https://pod.example/photos/', label: 'Photos' },
      { url: 'https://pod.example/photos/New%20York/', label: 'New York' },
    ]);
  });

  it('leaves a malformed percent-encoded segment as-is rather than throwing', () => {
    // `%E0%A4%A` is an invalid UTF-8 sequence → decodeURIComponent throws → the
    // segment is rendered raw (the defensive catch in decodeSegment).
    expect(
      breadcrumbFor('https://pod.example/photos/%E0%A4%A/', 'https://pod.example/photos/'),
    ).toEqual([
      { url: 'https://pod.example/photos/', label: 'Photos' },
      { url: 'https://pod.example/photos/%E0%A4%A/', label: '%E0%A4%A' },
    ]);
  });

  it('normalises a slashless root before deriving the trail', () => {
    expect(breadcrumbFor('https://pod.example/photos/a/', 'https://pod.example/photos')).toEqual([
      { url: 'https://pod.example/photos/', label: 'Photos' },
      { url: 'https://pod.example/photos/a/', label: 'a' },
    ]);
  });

  it('returns a single defensive crumb when the current URL is outside the root', () => {
    expect(breadcrumbFor('https://pod.example/other/', 'https://pod.example/photos/')).toEqual([
      { url: 'https://pod.example/other/', label: 'other' },
    ]);
  });

  it('labels an outside pod-root URL with its host (last segment of the trimmed URL)', () => {
    expect(breadcrumbFor('https://pod.example/', 'https://pod.example/photos/')).toEqual([
      { url: 'https://pod.example/', label: 'pod.example' },
    ]);
  });

  it('falls back to the raw URL when an outside URL trims to an empty last segment', () => {
    // A doubled trailing slash trims to ".../" whose last segment is empty, so
    // the `|| url` fallback in labelForSegment is exercised.
    expect(breadcrumbFor('https://pod.example/a//', 'https://pod.example/photos/')).toEqual([
      { url: 'https://pod.example/a//', label: 'https://pod.example/a//' },
    ]);
  });
});
