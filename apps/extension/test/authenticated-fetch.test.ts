// AUTHORED-BY Claude Opus 4.8

import * as jose from 'jose';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { authenticatedFetch, type FetchSession } from '../src/background/core/authenticated-fetch';
import { generateDpopKeyPair } from '../src/background/core/dpop';
import { opaqueRedirect, redirectProbe } from './redirect-fixtures';

async function makeSession(overrides: Partial<FetchSession> = {}): Promise<FetchSession> {
  return {
    accessToken: 'access-token-123',
    dpopKeyPair: await generateDpopKeyPair(),
    allowedOrigins: new Set(['https://alice.pod.example']),
    tokenEndpoint: 'https://idp.example/token',
    ...overrides,
  };
}

function ok(headers: Record<string, string> = {}): Response {
  return new Response('body', { status: 200, headers });
}

/** A fetch mock typed so `.mock.calls[i][1]` is the RequestInit (the credential carrier). */
type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): FetchMock {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(input.toString(), init));
}

describe('authenticatedFetch — credential boundary', () => {
  it('checks discovery after a nonce retry without reading or re-sending foreign bytes', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async (_url, init) => {
      if (fetchImpl.mock.calls.length === 1)
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"', 'DPoP-Nonce': 'fresh' },
        });
      return init?.redirect === 'manual'
        ? opaqueRedirect()
        : redirectProbe('https://evil.example/');
    });
    await expect(
      authenticatedFetch(session, {
        url: 'https://alice.pod.example/redirect',
        method: 'GET',
        headers: {},
        fetchImpl,
      }),
    ).rejects.toThrow('Redirect target denied');
    expect(fetchImpl.mock.calls).toHaveLength(3);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.redirect)).toEqual([
      'manual',
      'manual',
      'follow',
    ]);
    expect(
      fetchImpl.mock.calls.every(([url]) => url === 'https://alice.pod.example/redirect'),
    ).toBe(true);
  });

  it('attaches a DPoP-bound token for an allowed origin', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    const { authenticated } = await authenticatedFetch(session, {
      url: 'https://alice.pod.example/private/notes.ttl',
      method: 'GET',
      headers: {},
      fetchImpl,
    });

    expect(authenticated).toBe(true);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('DPoP access-token-123');
    expect(typeof headers.DPoP).toBe('string');
    // the proof carries the access-token hash + correct htu
    const proof = jose.decodeJwt(headers.DPoP);
    expect(proof.htu).toBe('https://alice.pod.example/private/notes.ttl');
    expect(proof.htm).toBe('GET');
    expect(proof.ath).toBeTypeOf('string');
  });

  it('the DPoP htu drops the query + fragment for a queried resource URL (RFC 9449 §4.2)', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    await authenticatedFetch(session, {
      url: 'https://alice.pod.example/q.ttl?a=1&b=2#frag',
      method: 'GET',
      headers: {},
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(jose.decodeJwt(headers.DPoP).htu).toBe('https://alice.pod.example/q.ttl');
  });

  it('does NOT attach the token to a foreign origin (token-leak attack)', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    const { authenticated } = await authenticatedFetch(session, {
      url: 'https://evil.example/collect',
      method: 'POST',
      headers: {},
      body: 'x',
      fetchImpl,
    });

    expect(authenticated).toBe(false);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.DPoP).toBeUndefined();
  });

  it('does NOT attach the token to the issuer token endpoint even if its origin is allowed', async () => {
    const session = await makeSession({
      allowedOrigins: new Set(['https://idp.example']),
      tokenEndpoint: 'https://idp.example/token',
    });
    const fetchImpl = mockFetch(async () => ok());
    const { authenticated } = await authenticatedFetch(session, {
      url: 'https://idp.example/token',
      method: 'POST',
      headers: {},
      fetchImpl,
    });
    expect(authenticated).toBe(false);
  });

  it('strips a page-supplied Authorization / DPoP header (no header injection)', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    await authenticatedFetch(session, {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: { Authorization: 'Bearer attacker', DPoP: 'forged', 'X-Keep': 'yes' },
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('DPoP access-token-123'); // ours, not the page's
    expect(headers['X-Keep']).toBe('yes'); // unrelated header preserved
  });

  // The attach-path assertion above is partially masked: that path UNCONDITIONALLY sets its
  // own Authorization/DPoP after the spread, so neutering `sanitizeHeaders` would not fail it.
  // The strip is the ONLY guard on the NON-attach (foreign origin / token endpoint) path —
  // there `safeHeaders` is passed straight to fetch with no overwrite — and it must also be
  // case-insensitive (page headers can be lower-cased). These assertions prove both, so a
  // neutered `sanitizeHeaders` genuinely fails (verified by temporarily neutering it).
  it('strips page-supplied auth headers on the NON-attach (foreign-origin) path — the only guard there', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    const { authenticated } = await authenticatedFetch(session, {
      url: 'https://evil.example/collect',
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', DPoP: 'forged', 'X-Keep': 'yes' },
      body: 'x',
      fetchImpl,
    });

    expect(authenticated).toBe(false); // foreign origin: sent as a plain fetch, no token
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    // No overwrite happens on this path, so if sanitizeHeaders were a no-op these would leak.
    expect(headers.Authorization).toBeUndefined();
    expect(headers.DPoP).toBeUndefined();
    expect(headers['X-Keep']).toBe('yes'); // unrelated header still forwarded to the foreign origin
  });

  it('strips page-supplied auth headers on the NON-attach (token-endpoint) path', async () => {
    const session = await makeSession({
      allowedOrigins: new Set(['https://idp.example']),
      tokenEndpoint: 'https://idp.example/token',
    });
    const fetchImpl = mockFetch(async () => ok());
    const { authenticated } = await authenticatedFetch(session, {
      url: 'https://idp.example/token',
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', DPoP: 'forged' },
      fetchImpl,
    });

    expect(authenticated).toBe(false); // token endpoint: never gets the resource token
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.DPoP).toBeUndefined();
  });

  it('strips LOWER-CASE page-supplied auth headers (case-insensitive) on the non-attach path', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    await authenticatedFetch(session, {
      url: 'https://evil.example/collect',
      method: 'POST',
      headers: { authorization: 'Bearer attacker', dpop: 'forged', 'x-keep': 'yes' },
      body: 'x',
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    // case-insensitive strip: lower-cased auth headers must not survive on the foreign path
    expect(headers.authorization).toBeUndefined();
    expect(headers.dpop).toBeUndefined();
    expect(headers['x-keep']).toBe('yes');
  });

  it('strips a LOWER-CASE page-supplied auth header on the attach path too (no duplicate header)', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async () => ok());
    await authenticatedFetch(session, {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: { authorization: 'Bearer attacker', dpop: 'forged' },
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    // the page's lower-cased copies are stripped, so only our canonical-cased ones remain
    expect(headers.authorization).toBeUndefined();
    expect(headers.dpop).toBeUndefined();
    expect(headers.Authorization).toBe('DPoP access-token-123');
    expect(typeof headers.DPoP).toBe('string');
  });

  it('retries ONCE on an RFC 9449 §8 nonce challenge with the server nonce', async () => {
    const session = await makeSession();
    let call = 0;
    const fetchImpl = mockFetch(async () => {
      call += 1;
      if (call === 1) {
        return new Response('nonce required', {
          status: 401,
          headers: {
            'www-authenticate': 'DPoP error="use_dpop_nonce"',
            'dpop-nonce': 'server-nonce-xyz',
          },
        });
      }
      return ok({ 'dpop-nonce': 'server-nonce-2' });
    });

    const { response, nonce } = await authenticatedFetch(session, {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: {},
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(nonce).toBe('server-nonce-2');
    // the retry proof carried the server nonce
    const retryHeaders = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    const proof = jose.decodeJwt(retryHeaders.DPoP);
    expect(proof.nonce).toBe('server-nonce-xyz');
  });

  it('does NOT retry on a non-nonce 401 (e.g. invalid_token)', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(
      async () =>
        new Response('nope', {
          status: 401,
          headers: { 'www-authenticate': 'DPoP error="invalid_token"' },
        }),
    );
    const { response } = await authenticatedFetch(session, {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: {},
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });
});

describe('authenticatedFetch — per-hop authorization and DPoP', () => {
  it.each([
    'get',
    'head',
  ])('discovers a trailing-slash redirect and re-sends %s with a fresh proof', async (method) => {
    const session = await makeSession();
    const authorize = vi.fn(async () => {});
    const signal = new AbortController().signal;
    const fetchImpl = mockFetch(async (url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe('https://alice.pod.example/foo/')
        : url.endsWith('/foo')
          ? opaqueRedirect()
          : ok(),
    );
    const result = await authenticatedFetch(session, {
      url: 'https://alice.pod.example/foo',
      method,
      headers: { Cookie: 'page-cookie', Authorization: 'page-token', DPoP: 'page-proof' },
      signal,
      authorize,
      fetchImpl,
    });
    expect(result.url).toBe('https://alice.pod.example/foo/');
    expect(result.method).toBe(method.toUpperCase());
    expect(await result.response.text()).toBe('body');
    expect(authorize.mock.calls).toHaveLength(2);
    expect(fetchImpl.mock.calls[1]).toEqual([
      'https://alice.pod.example/foo',
      { method: 'HEAD', credentials: 'omit', redirect: 'follow', headers: {}, signal },
    ]);
    const proofs = fetchImpl.mock.calls
      .filter(([, init]) => init?.redirect === 'manual')
      .map(([url, init]) => {
        expect(init?.redirect).toBe('manual');
        const proof = jose.decodeJwt((init!.headers as Record<string, string>).DPoP);
        expect(proof.htu).toBe(url);
        expect(proof.htm).toBe(method.toUpperCase());
        expect(init?.signal).toBe(signal);
        return proof;
      });
    expect(proofs[0].jti).not.toBe(proofs[1].jti);
  });

  it.each([
    'https://evil.example/',
    'https://idp.example/token?x=1#frag',
  ])('never requests a redirect target outside credential policy: %s', async (target) => {
    const session = await makeSession({
      allowedOrigins: new Set(['https://alice.pod.example', 'https://idp.example']),
    });
    const fetchImpl = mockFetch(async (_url, init) =>
      init?.redirect === 'follow' ? redirectProbe(target) : opaqueRedirect(),
    );
    await expect(
      authenticatedFetch(session, {
        url: 'https://alice.pod.example/x',
        method: 'GET',
        headers: {},
        fetchImpl,
      }),
    ).rejects.toThrow('Redirect target denied');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not downgrade an authenticated request to cleartext', async () => {
    const session = await makeSession();
    const fetchImpl = mockFetch(async (_url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe('http://alice.pod.example/private/')
        : opaqueRedirect(),
    );
    await expect(
      authenticatedFetch(session, {
        url: 'https://alice.pod.example/x',
        method: 'GET',
        headers: {},
        fetchImpl,
      }),
    ).rejects.toThrow('Forbidden URL');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rechecks the caller gate on a nonce retry and sends nothing after denial', async () => {
    const session = await makeSession();
    const authorize = vi.fn(async () => {}).mockRejectedValueOnce(new Error('revoked'));
    const fetchImpl = mockFetch(async () => ok());
    await expect(
      authenticatedFetch(session, {
        url: 'https://alice.pod.example/x',
        method: 'GET',
        headers: {},
        authorize,
        fetchImpl,
      }),
    ).rejects.toThrow('revoked');
    expect(fetchImpl).not.toHaveBeenCalled();
    authorize.mockResolvedValueOnce().mockRejectedValueOnce(new Error('revoked'));
    fetchImpl.mockImplementation(
      async () =>
        new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate': 'DPoP error="use_dpop_nonce"',
            'DPoP-Nonce': 'challenge',
          },
        }),
    );
    await expect(
      authenticatedFetch(session, {
        url: 'https://alice.pod.example/x',
        method: 'GET',
        headers: {},
        authorize,
        fetchImpl,
      }),
    ).rejects.toThrow('revoked');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    false,
    true,
  ])('retries each hop once and scopes nonces per origin (same=%s)', async (sameOrigin) => {
    const session = await makeSession({
      allowedOrigins: new Set(['https://alice.pod.example', 'https://other.pod.example']),
    });
    const target = sameOrigin
      ? 'https://alice.pod.example/final'
      : 'https://other.pod.example/final';
    let attempts = 0;
    const fetchImpl = mockFetch(async (_url, init) => {
      if (init?.redirect === 'follow') {
        const probe = redirectProbe(target);
        probe.headers.set('DPoP-Nonce', 'anonymous-probe-nonce');
        return probe;
      }
      const proof = jose.decodeJwt((init!.headers as Record<string, string>).DPoP);
      switch (++attempts) {
        case 1:
          expect(proof.nonce).toBe('cached');
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'DPoP error="use_dpop_nonce"',
              'DPoP-Nonce': 'first',
            },
          });
        case 2:
          expect(proof.nonce).toBe('first');
          return opaqueRedirect();
        case 3:
          expect(proof.nonce).toBe(sameOrigin ? 'first' : undefined);
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'DPoP error="use_dpop_nonce"',
              'DPoP-Nonce': 'second',
            },
          });
        default:
          expect(proof.nonce).toBe('second');
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'DPoP error="use_dpop_nonce"',
            },
          });
      }
    });
    const result = await authenticatedFetch(session, {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: {},
      nonce: 'cached',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(result.response.status).toBe(401);
    expect(result.nonce).toBe('second');
    const sends = fetchImpl.mock.calls.filter(([, init]) => init?.redirect === 'manual');
    const proofs = sends.map(([url, init]) => {
      const proof = jose.decodeJwt((init!.headers as Record<string, string>).DPoP);
      expect(proof).toMatchObject({ htu: url, htm: 'GET' });
      return proof.jti;
    });
    expect(new Set(proofs).size).toBe(4);
  });

  it('does not retry a nonce challenge without a nonce header', async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' },
        }),
    );
    await authenticatedFetch(await makeSession(), {
      url: 'https://alice.pod.example/x',
      method: 'GET',
      headers: {},
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the global fetch default and strips all auth/transport headers on public requests', async () => {
    const fetchImpl = mockFetch(async () => ok());
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const result = await authenticatedFetch(await makeSession(), {
        url: 'https://public.example/x',
        method: 'GET',
        headers: {
          Authorization: 'injected',
          DPoP: 'injected',
          Host: 'injected',
          'Content-Length': '4',
          Connection: 'keep-alive',
          Accept: 'text/turtle',
        },
      });
      expect(result.authenticated).toBe(false);
      expect(fetchImpl.mock.calls[0][1]!.headers).toEqual({ Accept: 'text/turtle' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
