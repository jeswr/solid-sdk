// AUTHORED-BY GPT-6.1-Sol (Codex)
// Exercise the real auth entry point with fixture discovery, storage and chrome.identity.
// Cancel at the browser prompt: no real accounts, tokens, or external network calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initiateLogin } from '../src/background/auth-flow';
import { PUBLISHED_CLIENT_ID_URL } from '../src/background/client-id';
import { renderClientIdDocument } from '../src/background/client-id-template';
import type { AuthParams } from '../src/background/session-store';

const webId = 'https://alice.example/profile/card#me';
const issuer = 'https://issuer.example/';
const registrationEndpoint = `${issuer}register`;
const redirectUri = 'https://bicabcdahgfbkgmlidjpmiadmjlppikk.chromiumapp.org/';
let storage: Map<string, unknown>;
let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
let launch: ReturnType<typeof vi.fn>;
let getRedirectURL: ReturnType<typeof vi.fn>;
let publishedResponse: () => Response;
let registrationResponse: () => Response;
let registrationEnabled: boolean;

beforeEach(() => {
  storage = new Map();
  publishedResponse = () =>
    Response.json(renderClientIdDocument('bicabcdahgfbkgmlidjpmiadmjlppikk'));
  registrationResponse = () => Response.json({ client_id: 'fixture-dcr-client' });
  registrationEnabled = true;
  getRedirectURL = vi.fn(() => redirectUri);
  launch = vi.fn((_options, callback) => callback(undefined));
  vi.stubGlobal('chrome', {
    runtime: {},
    identity: { getRedirectURL, launchWebAuthFlow: launch },
    storage: {
      local: {
        get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) storage.set(key, value);
        },
      },
    },
  });
  fetchSpy = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === webId) {
      return new Response(`<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}>.`);
    }
    if (url === `${issuer}.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        ...(registrationEnabled ? { registration_endpoint: registrationEndpoint } : {}),
      });
    }
    if (url === PUBLISHED_CLIENT_ID_URL) return publishedResponse();
    if (url === registrationEndpoint) return registrationResponse();
    throw new Error(`Unexpected fixture fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function registrationCalls() {
  return fetchSpy.mock.calls.filter(([url]) => String(url) === registrationEndpoint);
}

async function expectAuthorizationClient(clientId: string, pageClientId?: string) {
  await expect(initiateLogin({ webId, clientId: pageClientId })).rejects.toThrow(
    'Authorization was cancelled',
  );
  expect(launch).toHaveBeenCalledOnce();
  expect(getRedirectURL).toHaveBeenCalledWith();
  const authorization = new URL(launch.mock.calls[0][0].url);
  expect(authorization.searchParams.get('client_id')).toBe(clientId);
  expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const params = storage.get('solid:auth-params') as AuthParams;
  expect(params.clientId).toBe(clientId);
  expect(params.redirectUri).toBe(redirectUri);
}

describe('clientIdMode routing (real initiateLogin)', () => {
  it('uses DCR by default while Pages enablement is pending, without probing the document', async () => {
    await expectAuthorizationClient('fixture-dcr-client');
    expect(registrationCalls()).toHaveLength(1);
    expect(fetchSpy.mock.calls.some(([url]) => url === PUBLISHED_CLIENT_ID_URL)).toBe(false);
    expect(JSON.parse(String(registrationCalls()[0][1]?.body))).toMatchObject({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      scope: 'openid webid offline_access',
    });
  });

  it('uses the published document only in document mode, without DCR', async () => {
    storage.set('solid:client-id-mode', 'document');
    await expectAuthorizationClient(PUBLISHED_CLIENT_ID_URL);
    expect(registrationCalls()).toHaveLength(0);
  });

  it('uses DCR only when explicitly configured, even if the document is available', async () => {
    storage.set('solid:client-id-mode', 'dcr');
    await expectAuthorizationClient('fixture-dcr-client');
    expect(registrationCalls()).toHaveLength(1);
    expect(fetchSpy.mock.calls.some(([url]) => url === PUBLISHED_CLIENT_ID_URL)).toBe(false);
  });

  it.each([
    'document',
    'dcr',
  ])('preserves a page-declared Client ID Document in %s mode without registration', async (mode) => {
    storage.set('solid:client-id-mode', mode);
    await expectAuthorizationClient(
      'https://app.example/clientid.jsonld',
      'https://app.example/clientid.jsonld',
    );
    expect(registrationCalls()).toHaveLength(0);
    expect(fetchSpy.mock.calls.some(([url]) => url === PUBLISHED_CLIENT_ID_URL)).toBe(false);
  });

  it.each([
    () => new Response('not found', { status: 404 }),
    () => new Response('not json'),
    () => Response.json(null),
    () => Response.json({ client_id: 'https://attacker.example/clientid.jsonld' }),
    () => {
      throw new Error('offline');
    },
  ])('never registers on document failure or changes an existing session', async (response) => {
    storage.set('solid:client-id-mode', 'document');
    const existing = { marker: 'existing-session-fixture' };
    storage.set('solid:session', existing);
    publishedResponse = response;
    await expect(initiateLogin({ webId })).rejects.toThrow(
      'published Client ID Document is unavailable or invalid',
    );
    expect(registrationCalls()).toHaveLength(0);
    expect(launch).not.toHaveBeenCalled();
    expect(storage.has('solid:auth-params')).toBe(false);
    expect(storage.get('solid:session')).toBe(existing);
  });

  it.each([
    null,
    '',
    'DCR',
    'automatic',
    false,
    { mode: 'dcr' },
  ])('fails closed on malformed trusted settings (%j), without network or authorization', async (mode) => {
    storage.set('solid:client-id-mode', mode);
    await expect(initiateLogin({ webId })).rejects.toThrow('Invalid clientIdMode');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('ignores a page-supplied clientIdMode field', async () => {
    storage.set('solid:client-id-mode', 'document');
    publishedResponse = () => new Response('not found', { status: 404 });
    const pageOptions = { webId, clientIdMode: 'dcr' };
    await expect(initiateLogin(pageOptions)).rejects.toThrow(
      'published Client ID Document is unavailable or invalid',
    );
    expect(registrationCalls()).toHaveLength(0);
    expect(launch).not.toHaveBeenCalled();
  });

  it('fails in DCR mode when discovery has no registration endpoint', async () => {
    storage.set('solid:client-id-mode', 'dcr');
    registrationEnabled = false;
    await expect(initiateLogin({ webId })).rejects.toThrow(
      'issuer offers no dynamic registration endpoint',
    );
    expect(registrationCalls()).toHaveLength(0);
    expect(launch).not.toHaveBeenCalled();
  });

  it('surfaces DCR failure without trying another client identity', async () => {
    storage.set('solid:client-id-mode', 'dcr');
    registrationResponse = () => new Response('rejected', { status: 400 });
    await expect(initiateLogin({ webId })).rejects.toThrow(
      'Dynamic client registration failed (400)',
    );
    expect(registrationCalls()).toHaveLength(1);
    expect(fetchSpy.mock.calls.some(([url]) => url === PUBLISHED_CLIENT_ID_URL)).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
});
