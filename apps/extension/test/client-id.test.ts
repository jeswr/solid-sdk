// AUTHORED-BY GPT-6.1-Sol (Codex)
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isPublishedClientIdReachable } from '../src/background/client-id';
import {
  CLIENT_ID_SCOPE,
  PUBLISHED_CLIENT_ID_URL,
  renderClientIdDocument,
  SOLID_OIDC_CONTEXT,
} from '../src/background/client-id-template';

const expectedId = 'bicabcdahgfbkgmlidjpmiadmjlppikk';
const documentPath = new URL('../public/clientid.jsonld', import.meta.url);
const shippedJson = JSON.parse(readFileSync(documentPath, 'utf8'));

// Compute independently of the build script, from the actual committed DER public key.
function extensionIdFromKey(key: string): string {
  const der = Buffer.from(key, 'base64');
  expect(der.toString('base64')).toBe(key);
  expect(createPublicKey({ key: der, format: 'der', type: 'spki' }).type).toBe('public');
  return [...createHash('sha256').update(der).digest().subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join('');
}

describe('generated Client Identifier Document', () => {
  it('renders the required public-client fields from one template', () => {
    expect(renderClientIdDocument(expectedId)).toEqual({
      '@context': 'https://www.w3.org/ns/solid/oidc-context.jsonld',
      client_id: 'https://jeswr.github.io/solid-browser-extension/clientid.jsonld',
      client_name: 'Solid Browser Extension',
      client_uri: 'https://github.com/jeswr/solid-browser-extension',
      logo_uri: 'https://jeswr.github.io/solid-browser-extension/icon128.png',
      redirect_uris: [`https://${expectedId}.chromiumapp.org/`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid webid offline_access',
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    });
    expect(shippedJson).toEqual(renderClientIdDocument(expectedId));
    expect(shippedJson.client_id).toBe(PUBLISHED_CLIENT_ID_URL);
    expect(shippedJson['@context']).toBe(SOLID_OIDC_CONTEXT);
    expect(shippedJson.scope).toBe(CLIENT_ID_SCOPE);
    expect(JSON.stringify(shippedJson)).not.toContain('REPLACE-ME');
  });

  it('computes the pinned ID from the manifest public key and matches the redirect URI', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    );
    expect(manifest.key, 'The dispatcher public key must be pinned in the manifest').toBeTypeOf(
      'string',
    );
    const id = extensionIdFromKey(manifest.key);
    expect(id).toBe(expectedId);
    expect(shippedJson.redirect_uris).toEqual([`https://${id}.chromiumapp.org/`]);
  });

  it.each([
    { mode: 'render', args: [] },
    { mode: 'check', args: ['--check'] },
  ])('$mode uses the committed key without EXT_PUBKEY or dependencies', ({ args }) => {
    const directory = mkdtempSync(join(tmpdir(), 'solid-client-id-'));
    const paths = [
      'package.json',
      'scripts/render-client-id.ts',
      'src/background/client-id-template.ts',
      'src/manifest.json',
      'public/clientid.jsonld',
    ];
    const env = { ...process.env };
    delete env.EXT_PUBKEY;
    try {
      for (const path of paths) {
        const destination = join(directory, path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(new URL(`../${path}`, import.meta.url), destination);
      }
      const result = spawnSync(
        process.execPath,
        [join(directory, 'scripts/render-client-id.ts'), ...args],
        { cwd: directory, encoding: 'utf8', env },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      for (const path of ['src/manifest.json', 'public/clientid.jsonld']) {
        expect(readFileSync(join(directory, path), 'utf8')).toBe(
          readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('substitutes a different valid ID rather than hardcoding the redirect', () => {
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    expect(renderClientIdDocument(id).redirect_uris).toEqual([`https://${id}.chromiumapp.org/`]);
  });

  it.each([
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'z'.repeat(32),
    '../evil',
    expectedId.toUpperCase(),
  ])('rejects an invalid extension ID (%s)', (id) =>
    expect(() => renderClientIdDocument(id)).toThrow('Invalid Chromium extension ID'));
});

describe('Client ID Document reachability (fixture fetches only)', () => {
  it.each([
    '',
    'invalid',
    'http://example.com/clientid.jsonld',
    'file:///clientid.jsonld',
  ])('rejects invalid/non-HTTPS URLs before fetching: %s', async (url) => {
    const fetchSpy = vi.fn<typeof fetch>();
    expect(await isPublishedClientIdReachable(url, fetchSpy)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response('not found', { status: 404 }),
    () => new Response('not JSON'),
    () => Response.json(null),
    () => Response.json({}),
    () => Response.json({ client_id: 42 }),
    () => Response.json({ client_id: 'https://other.example/clientid.jsonld' }),
    () => Response.json({ client_id: `${PUBLISHED_CLIENT_ID_URL}/` }),
  ])('fails closed for an unavailable or invalid document', async (response) => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(response());
    expect(await isPublishedClientIdReachable(PUBLISHED_CLIENT_ID_URL, fetchSpy)).toBe(false);
  });

  it('fails closed on network errors', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));
    expect(await isPublishedClientIdReachable(PUBLISHED_CLIENT_ID_URL, fetchSpy)).toBe(false);
  });

  it('accepts an exact self-reference, omitting cookies and refusing redirects', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(Response.json(shippedJson));
    expect(await isPublishedClientIdReachable(PUBLISHED_CLIENT_ID_URL, fetchSpy)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(PUBLISHED_CLIENT_ID_URL, {
      headers: { Accept: 'application/ld+json, application/json' },
      credentials: 'omit',
      redirect: 'error',
    });
  });
});
