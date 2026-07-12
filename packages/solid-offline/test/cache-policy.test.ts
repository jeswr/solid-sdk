/**
 * §2 "Cache key" + "Never cache" classifier — pure-function coverage.
 */
import { describe, expect, it } from 'vitest';
import {
  aclStatusFor,
  CANONICAL_RDF_ACCEPT,
  canonicalAccept,
  classifyResponse,
  computeCacheKey,
  computeVaryKey,
  isCacheableMethod,
  isNeverCacheEndpoint,
  keyRequest,
  NEGATIVE_CACHE_TTL_MS,
  type RequestLike,
  type ResponseLike,
} from '../src/cache-policy.js';

function req(url: string, method = 'GET', headers: Record<string, string> = {}): RequestLike {
  return { url, method, headers: new Headers(headers) };
}

function res(status: number, headers: Record<string, string> = {}, type = 'basic'): ResponseLike {
  return { status, headers: new Headers(headers), type };
}

describe('isCacheableMethod', () => {
  it('accepts GET/HEAD (any case), rejects everything else', () => {
    expect(isCacheableMethod('GET')).toBe(true);
    expect(isCacheableMethod('get')).toBe(true);
    expect(isCacheableMethod('HEAD')).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(isCacheableMethod(m)).toBe(false);
    }
  });
});

describe('isNeverCacheEndpoint', () => {
  it.each([
    'https://pod.example/.well-known/solid',
    'https://idp.example/oidc/token',
    'https://idp.example/authorize?x=1',
    'https://pod.example/.account/credentials',
    'https://pod.example/foo/subscription',
    'https://pod.example/.notifications/websocket',
    'wss://pod.example/socket',
  ])('flags auth/identity/realtime endpoint %s', (url) => {
    expect(isNeverCacheEndpoint(url)).toBe(true);
  });

  it.each([
    'https://pod.example/alice/profile/card',
    'https://pod.example/alice/notes/today',
  ])('does NOT flag ordinary resources %s', (url) => {
    expect(isNeverCacheEndpoint(url)).toBe(false);
  });

  it('is conservative (never-cache) for unparseable URLs', () => {
    expect(isNeverCacheEndpoint('::::not a url')).toBe(true);
  });
});

describe('canonicalAccept — RDF normalization', () => {
  it('maps all RDF media types + */* + empty to text/turtle', () => {
    for (const a of [
      null,
      '*/*',
      'text/turtle',
      'application/ld+json',
      'application/n-triples,*/*;q=0.1',
      'application/trig',
    ]) {
      expect(canonicalAccept(a)).toBe(CANONICAL_RDF_ACCEPT);
    }
  });

  it('passes non-RDF Accept through (first type only)', () => {
    expect(canonicalAccept('image/png')).toBe('image/png');
    expect(canonicalAccept('text/html, application/xhtml+xml')).toBe('text/html');
  });
});

describe('computeVaryKey / computeCacheKey', () => {
  it('normalizes Accept so RDF variants collapse to one entry', () => {
    const r1 = req('https://pod/a', 'GET', { accept: 'text/turtle' });
    const r2 = req('https://pod/a', 'GET', { accept: 'application/ld+json' });
    const resp = res(200, { vary: 'Accept, Origin', etag: '"1"' });
    expect(computeVaryKey(r1, resp)).toBe(computeVaryKey(r2, resp));
    expect(computeCacheKey(r1, resp)).toBe(computeCacheKey(r2, resp));
    expect(computeVaryKey(r1, resp)).toBe(`accept=${CANONICAL_RDF_ACCEPT}`);
  });

  it('ignores Origin for keying (same-origin SW)', () => {
    const a = req('https://pod/a', 'GET', { accept: 'text/turtle', origin: 'https://app1' });
    const b = req('https://pod/a', 'GET', { accept: 'text/turtle', origin: 'https://app2' });
    const resp = res(200, { vary: 'Accept, Origin' });
    expect(computeVaryKey(a, resp)).toBe(computeVaryKey(b, resp));
  });

  it('keys non-RDF Accept variants distinctly', () => {
    const png = req('https://pod/img', 'GET', { accept: 'image/png' });
    const turtle = req('https://pod/img', 'GET', { accept: 'text/turtle' });
    const resp = res(200, { vary: 'Accept' });
    expect(computeVaryKey(png, resp)).not.toBe(computeVaryKey(turtle, resp));
  });

  it('falls back to Accept-only key when response has no Vary', () => {
    const r = req('https://pod/a', 'GET', { accept: 'text/turtle' });
    expect(computeVaryKey(r, res(200))).toBe(`accept=${CANONICAL_RDF_ACCEPT}`);
  });

  it('keys an arbitrary varied header verbatim', () => {
    const r = req('https://pod/a', 'GET', { accept: 'text/turtle', 'accept-language': 'en' });
    const resp = res(200, { vary: 'Accept-Language' });
    expect(computeVaryKey(r, resp)).toBe('accept-language=en');
  });

  it('Vary:* produces a non-shared key', () => {
    const r = req('https://pod/a', 'GET', { accept: 'text/turtle' });
    expect(computeVaryKey(r, res(200, { vary: '*' }))).toContain('vary*=');
  });
});

describe('classifyResponse — Never-cache rules (§2)', () => {
  it('caches a 200 GET with normal headers', () => {
    const d = classifyResponse(req('https://pod/a'), res(200, { etag: '"1"' }));
    expect(d).toMatchObject({ cacheable: true, reason: 'cacheable', negative: false });
  });

  it('refuses non-GET/HEAD', () => {
    const d = classifyResponse(req('https://pod/a', 'POST'), res(200));
    expect(d).toMatchObject({ cacheable: false, reason: 'method-not-get-head' });
  });

  it('refuses Cache-Control: no-store', () => {
    const d = classifyResponse(req('https://pod/a'), res(200, { 'cache-control': 'no-store' }));
    expect(d).toMatchObject({ cacheable: false, reason: 'no-store' });
  });

  it('refuses Cache-Control: private', () => {
    const d = classifyResponse(
      req('https://pod/a'),
      res(200, { 'cache-control': 'private, max-age=0' }),
    );
    expect(d).toMatchObject({ cacheable: false, reason: 'private' });
  });

  it('refuses auth/identity endpoints regardless of status', () => {
    const d = classifyResponse(req('https://idp/oidc/token'), res(200, { etag: '"x"' }));
    expect(d).toMatchObject({ cacheable: false, reason: 'never-cache-endpoint' });
  });

  it('refuses opaque cross-origin responses (unreadable ETag)', () => {
    const d = classifyResponse(req('https://other/a'), res(0, {}, 'opaque'));
    expect(d).toMatchObject({ cacheable: false, reason: 'opaque-cross-origin' });
  });

  it('refuses Vary: * (not shareable; matches Cache API rejection)', () => {
    const d = classifyResponse(req('https://pod/a'), res(200, { vary: '*', etag: '"1"' }));
    expect(d).toMatchObject({ cacheable: false, reason: 'vary-star' });
    // Even a 403/404 with Vary:* is not cacheable.
    expect(classifyResponse(req('https://pod/a'), res(404, { vary: '*' }))).toMatchObject({
      cacheable: false,
      reason: 'vary-star',
    });
    // A COALESCED header like `Vary: *, Accept` must also be rejected (any `*` token).
    expect(
      classifyResponse(req('https://pod/a'), res(200, { vary: '*, Accept', etag: '"1"' })),
    ).toMatchObject({ cacheable: false, reason: 'vary-star' });
    expect(
      classifyResponse(req('https://pod/a'), res(200, { vary: 'Accept, *', etag: '"1"' })),
    ).toMatchObject({ cacheable: false, reason: 'vary-star' });
  });

  it('refuses generic 4xx/5xx but NEGATIVE-caches 403 and 404', () => {
    expect(classifyResponse(req('https://pod/a'), res(401))).toMatchObject({
      cacheable: false,
      reason: 'error-status',
    });
    expect(classifyResponse(req('https://pod/a'), res(500))).toMatchObject({
      cacheable: false,
      reason: 'error-status',
    });
    for (const s of [403, 404]) {
      expect(classifyResponse(req('https://pod/a'), res(s))).toMatchObject({
        cacheable: true,
        reason: 'cacheable-negative',
        negative: true,
      });
    }
  });
});

describe('aclStatusFor + negative TTL constant', () => {
  it('maps statuses to ACL markers', () => {
    expect(aclStatusFor(200)).toBe('ok');
    expect(aclStatusFor(403)).toBe('forbidden');
    expect(aclStatusFor(404)).toBe('not-found');
  });
  it('negative TTL is a short positive duration', () => {
    expect(NEGATIVE_CACHE_TTL_MS).toBeGreaterThan(0);
    expect(NEGATIVE_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('keyRequest — collision-free canonical Cache key', () => {
  it('maps distinct (url, varyKey) pairs to distinct keys', () => {
    const a = keyRequest('https://pod/doc', 'accept=text/turtle').url;
    const b = keyRequest('https://pod/doc', 'accept=application/ld+json').url;
    const c = keyRequest('https://pod/other', 'accept=text/turtle').url;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('does NOT collide when the resource URL already carries the reserved param', () => {
    // The roborev HIGH finding: folding the varyKey into a query param on the
    // live URL collided when the resource itself had that param. The sentinel-
    // origin composite key must keep them distinct.
    const plain = keyRequest('https://pod/doc', 'accept=text/turtle').url;
    const sneaky = keyRequest(
      'https://pod/doc?__solid_offline_key=accept=text/turtle',
      'accept=text/turtle',
    ).url;
    expect(plain).not.toBe(sneaky);
  });

  it('is deterministic for the same inputs', () => {
    expect(keyRequest('https://pod/x', 'accept=text/turtle').url).toBe(
      keyRequest('https://pod/x', 'accept=text/turtle').url,
    );
  });
});
