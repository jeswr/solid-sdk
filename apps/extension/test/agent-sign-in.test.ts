// AUTHORED-BY Codex GPT-6

import { captureSchema, cookieDomainAllowed, registrableDomain } from '@jeswr/agent-vault/browser';
import { describe, expect, it } from 'vitest';
import { captureCookies } from '../src/background/agent-capture-cookies';

const site = 'https://bank.example.co.uk';
const now = 1700000000000;
const cookie = (changes: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie => ({
  name: 'sid',
  value: 'fixture-cookie',
  domain: 'bank.example.co.uk',
  path: '/',
  secure: true,
  httpOnly: true,
  hostOnly: true,
  sameSite: 'lax',
  session: true,
  storeId: '0',
  ...changes,
});
describe('agent cookie boundary', () => {
  it('handles PSL exceptions and private tenant boundaries', () => {
    expect(registrableDomain('bank.www.ck')).toBe('www.ck');
    expect(cookieDomainAllowed('bank.www.ck', 'www.ck', false, ['www.ck'])).toBe(true);
    expect(registrableDomain('bank.tenant.github.io')).toBe('tenant.github.io');
    expect(
      cookieDomainAllowed('bank.tenant.github.io', 'other.github.io', false, ['other.github.io']),
    ).toBe(false);
  });
  it('never selects sibling host-only cookies or other registrable sites', () => {
    const result = captureCookies(
      site,
      [
        cookie(),
        cookie({ domain: 'evil.example.co.uk' }),
        cookie({ domain: '.other.co.uk', hostOnly: false }),
      ],
      ['example.co.uk'],
      now,
    );
    expect(result).toHaveLength(1);
  });
  it.each([
    'co.uk',
    'uk',
    'com',
    'github.io',
    'appspot.com',
    'foo.ck',
  ])('refuses public suffix %s even when allowlisted', (domain) => {
    expect(cookieDomainAllowed(`bank.${domain}`, domain, false, [domain])).toBe(false);
    expect(cookieDomainAllowed(domain, domain, false, [domain])).toBe(false);
  });
  it('permits parent domain cookies only through explicit host configuration', () => {
    const parent = cookie({ domain: '.example.co.uk', hostOnly: false });
    expect(captureCookies(site, [parent], [], now)).toEqual([]);
    expect(captureCookies(site, [parent], ['example.co.uk'], now)[0]).toMatchObject({
      domain: 'example.co.uk',
      hostOnly: false,
    });
    expect(
      captureCookies(site, [cookie({ domain: 'example.co.uk' })], ['example.co.uk'], now),
    ).toEqual([]);
  });
  it('preserves secure, httpOnly, sameSite, expiry and path in the exact capture schema', () => {
    const cookies = captureCookies(
      site,
      [cookie({ path: '/account', session: false, expirationDate: now / 1000 + 60 })],
      [],
      now,
    );
    expect(cookies[0]).toEqual({
      name: 'sid',
      value: 'fixture-cookie',
      domain: 'bank.example.co.uk',
      path: '/account',
      secure: true,
      httpOnly: true,
      hostOnly: true,
      sameSite: 'Lax',
      expires: now / 1000 + 60,
    });
    expect(
      captureSchema.safeParse({ site, account: 'alex', cookies, capturedAt: now }).success,
    ).toBe(true);
  });
  it('excludes partitioned, expired and cleartext-ineligible cookies', () => {
    expect(
      captureCookies(
        site,
        [
          cookie({ partitionKey: { topLevelSite: site } }),
          cookie({ session: false, expirationDate: 1 }),
        ],
        [],
        now,
      ),
    ).toEqual([]);
    expect(captureCookies('http://localhost', [cookie({ domain: 'localhost' })], [], now)).toEqual(
      [],
    );
  });
});
