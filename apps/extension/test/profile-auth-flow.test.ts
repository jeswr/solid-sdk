// AUTHORED-BY GPT-6.1-Sol (Codex)
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initiateLogin, refreshSession } from '../src/background/auth-flow';
import { profileCredentials } from './profile-fixtures';

const WEBID = 'https://pod.example/alice/profile#me';
const ISSUER = 'https://issuer.example/';
const TOKEN = `${ISSUER}token`;
const CLIENT = 'https://app.example/clientid';
let storage: Map<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let exchangeSucceeds: boolean;

beforeEach(() => {
  storage = new Map([['solid:session', { accessToken: 'fixture-legacy-unchanged' }]]);
  exchangeSucceeds = true;
  vi.stubGlobal('chrome', {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage.get(key) }),
        set: async (entries: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(entries)) storage.set(key, value);
        },
        remove: async (key: string) => {
          storage.delete(key);
        },
      },
    },
    identity: {
      getRedirectURL: () => 'https://fixture.chromiumapp.org/callback',
      launchWebAuthFlow: ({ url }: { url: string }, callback: (url: string) => void) => {
        const state = new URL(url).searchParams.get('state')!;
        callback(
          `https://fixture.chromiumapp.org/callback?code=fixture-code&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
        );
      },
    },
  });
  fetchMock = vi.fn(async (input, init) => {
    const url = input.toString();
    if (url === WEBID)
      return new Response(`<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${ISSUER}> .`);
    if (url === `${ISSUER}.well-known/openid-configuration`)
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}authorize`,
        token_endpoint: TOKEN,
      });
    if (url === TOKEN) {
      expect(new URLSearchParams(init?.body as URLSearchParams).get('grant_type')).toBe(
        'authorization_code',
      );
      expect(
        jose.decodeProtectedHeader(new Headers(init?.headers).get('dpop')!).jwk,
      ).not.toHaveProperty('d');
      if (!exchangeSucceeds) return new Response('fixture denied', { status: 401 });
      return Response.json({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        id_token: new jose.UnsecuredJWT({ webid: WEBID }).encode(),
        expires_in: 3600,
      });
    }
    throw new Error('Unexpected fixture URL');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile-owned auth credentials', () => {
  it('returns the successful token set with its own non-extractable key for one atomic profile commit', async () => {
    const { session, keyPair } = await initiateLogin({ webId: WEBID, clientId: CLIENT });
    expect(session).toMatchObject({
      webId: WEBID,
      issuer: ISSUER,
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
    });
    expect(keyPair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', keyPair.privateKey)).rejects.toThrow();
    const tokenCall = fetchMock.mock.calls.find(([url]) => url.toString() === TOKEN)!;
    await expect(
      jose.jwtVerify(new Headers(tokenCall[1]?.headers).get('dpop')!, keyPair.publicKey),
    ).resolves.toBeDefined();
    expect(storage.get('solid:session')).toEqual({ accessToken: 'fixture-legacy-unchanged' });
    expect(storage.has('solid:auth-params')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('leaves the existing credentials untouched after a failed exchange', async () => {
    exchangeSucceeds = false;
    await expect(initiateLogin({ webId: WEBID, clientId: CLIENT })).rejects.toThrow(
      'Token exchange failed',
    );
    expect(storage.get('solid:session')).toEqual({ accessToken: 'fixture-legacy-unchanged' });
  });

  it('refuses refresh with another profile key before any token egress', async () => {
    const a = await profileCredentials();
    const b = await profileCredentials('bob');
    await expect(refreshSession(a.session, b.keyPair)).rejects.toThrow('does not match');
    await expect(refreshSession({ ...a.session, dpopJkt: undefined }, a.keyPair)).rejects.toThrow(
      'does not match',
    );
    await expect(refreshSession({ ...a.session, refreshToken: null }, a.keyPair)).rejects.toThrow(
      'No refresh token',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses only the owning key for a nonce retry and returns rotated tokens without global persistence', async () => {
    const a = await profileCredentials();
    fetchMock.mockImplementation(async (_url, init) => {
      const proof = new Headers(init?.headers).get('dpop')!;
      const { payload } = await jose.jwtVerify(proof, a.keyPair.publicKey);
      expect(new URLSearchParams(init?.body as URLSearchParams).get('refresh_token')).toBe(
        a.session.refreshToken,
      );
      if (!payload.nonce)
        return new Response('', { status: 400, headers: { 'dpop-nonce': 'fixture-nonce' } });
      expect(payload.nonce).toBe('fixture-nonce');
      return Response.json({
        access_token: 'fixture-rotated-access',
        refresh_token: 'fixture-rotated-refresh',
        expires_in: 3600,
      });
    });
    const updated = await refreshSession(a.session, a.keyPair);
    expect(updated).toMatchObject({
      webId: a.session.webId,
      dpopJkt: a.session.dpopJkt,
      accessToken: 'fixture-rotated-access',
      refreshToken: 'fixture-rotated-refresh',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage.get('solid:session')).toEqual({ accessToken: 'fixture-legacy-unchanged' });
  });
});
