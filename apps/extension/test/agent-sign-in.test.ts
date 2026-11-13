// AUTHORED-BY Codex GPT-6

import { captureSchema, cookieDomainAllowed, registrableDomain } from '@jeswr/agent-vault/browser';
import { describe, expect, it, vi } from 'vitest';
import manifest from '../src/manifest.json';
import { AgentSignIn, captureCookies } from '../src/popup/agent-sign-in';

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
function setup() {
  const state = { origins: [`${site}:443/*`, 'https://other.test:443/*'], cookies: false };
  const before = structuredClone(state);
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: vi.fn() },
  };
  const browser = {
    tabs: { query: vi.fn(async () => [{ id: 7, url: `${site}/account`, incognito: false }]) },
    permissions: {
      contains: vi.fn(async (input: chrome.permissions.Permissions) =>
        input.origins
          ? input.origins.every((origin) => state.origins.includes(origin))
          : state.cookies,
      ),
      request: vi.fn(async (input: chrome.permissions.Permissions) => {
        state.origins.push(...(input.origins ?? []));
        if (input.permissions?.includes('cookies')) state.cookies = true;
        return true;
      }),
      remove: vi.fn(async (input: chrome.permissions.Permissions) => {
        if (input.origins) state.origins = state.origins.filter((o) => !input.origins!.includes(o));
        if (input.permissions?.includes('cookies')) state.cookies = false;
        return true;
      }),
    },
    runtime: { connect: vi.fn(() => port) },
    cookies: { getAll: vi.fn(async () => [cookie()]) },
  };
  const transport = vi.fn(async (request: { type: string }) => {
    if (request.type === 'list')
      return {
        type: 'list',
        profiles: [{ id: 'personal', label: 'Personal' }],
        personas: [{ id: 'alex', profile: 'personal', label: 'Alex Example' }],
        cookieDomains: [],
      };
    if (request.type === 'beginLogin')
      return { type: 'beginLogin', token: '00000000-0000-4000-8000-000000000001' };
    return { type: 'capture' };
  });
  return {
    browser,
    transport,
    controller: new AgentSignIn(browser, transport, () => now),
    state,
    before,
  };
}
describe('user-initiated sharing', () => {
  const permissions = { permissions: ['cookies'] };
  function restored(fixture: ReturnType<typeof setup>) {
    expect(fixture.state).toEqual(fixture.before);
    for (const [input] of fixture.browser.permissions.request.mock.calls)
      expect(input).toEqual(permissions);
    for (const [input] of fixture.browser.permissions.remove.mock.calls)
      expect(input).toEqual(permissions);
    const { contains, remove } = fixture.browser.permissions;
    const verified = contains.mock.calls.flatMap(([input], index) =>
      input.permissions?.includes('cookies') ? [contains.mock.invocationCallOrder[index]] : [],
    );
    expect(verified.at(-1)).toBeGreaterThan(remove.mock.invocationCallOrder.at(-1)!);
  }
  it('declares cookies optional while retaining the required host permissions', () => {
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.optional_permissions).toEqual(['cookies']);
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
  it.each([
    'On click',
    'On specific sites',
  ])('refuses a withheld origin (%s) before any native message', async () => {
    const { browser, transport, controller, state } = setup();
    state.origins.shift();
    const before = structuredClone(state);
    await expect(controller.load()).rejects.toThrow(
      "Chrome's extension menu first, then try again",
    );
    expect(browser.permissions.contains.mock.calls).toEqual([
      [permissions],
      [{ origins: [`${site}:443/*`] }],
    ]);
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(browser.permissions.remove).not.toHaveBeenCalled();
    expect(browser.runtime.connect).not.toHaveBeenCalled();
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('rechecks withheld host access on the review click before requesting cookies or contacting the host', async () => {
    const { browser, transport, controller, state } = setup();
    await controller.load();
    state.origins.shift();
    const before = structuredClone(state);
    transport.mockClear();
    await expect(controller.review('personal', 'alex')).rejects.toThrow(
      "Chrome's extension menu first, then try again",
    );
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(browser.runtime.connect).not.toHaveBeenCalled();
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('checks existing host access first, requests only cookies on review, and waits for explicit confirmation', async () => {
    const fixture = setup();
    const { browser, transport, controller } = fixture;
    await controller.load();
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
    const pending = controller.review('personal', 'alex');
    expect(browser.permissions.contains).toHaveBeenLastCalledWith({ origins: [`${site}:443/*`] });
    expect(browser.permissions.request).not.toHaveBeenCalled();
    const preview = await pending;
    expect(browser.permissions.request).toHaveBeenCalledWith(permissions);
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
    expect(preview).toMatchObject({ site, count: 1, persona: 'Alex Example', profile: 'Personal' });
    expect(transport.mock.calls.map(([r]) => r.type)).toEqual(['list', 'beginLogin']);
    await controller.share();
    expect(browser.runtime.connect.mock.results[0].value.disconnect).toHaveBeenCalled();
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'capture',
        message: {
          site,
          account: 'alex',
          cookies: [expect.objectContaining({ secure: true, httpOnly: true })],
          capturedAt: now,
        },
      }),
    );
    await expect(controller.share()).rejects.toThrow();
    restored(fixture);
  });
  it('refuses confirmation if Chrome withholds the origin after review without sending a capture', async () => {
    const { browser, transport, controller, state } = setup();
    await controller.load();
    await controller.review('personal', 'alex');
    state.origins.shift();
    const before = structuredClone(state);
    transport.mockClear();
    browser.permissions.request.mockClear();
    await expect(controller.share()).rejects.toThrow(
      "Chrome's extension menu first, then try again",
    );
    expect(transport).not.toHaveBeenCalled();
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('does not read or send cookies after permission denial', async () => {
    const fixture = setup();
    const { browser, transport, controller } = fixture;
    await controller.load();
    browser.permissions.request.mockResolvedValue(false);
    await expect(controller.review('personal', 'alex')).rejects.toThrow();
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
  });
  it('refuses navigation, cancellation, profile changes, empty cookies and expired previews', async () => {
    const { browser, transport, controller } = setup();
    await controller.load();
    await controller.review('personal', 'alex');
    browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://evil.example.co.uk', incognito: false },
    ]);
    await expect(controller.share()).rejects.toThrow();
    expect(transport.mock.calls.some(([r]) => r.type === 'capture')).toBe(false);
    controller.cancel();
    await expect(controller.share()).rejects.toThrow();
    await expect(controller.review('work', 'alex')).rejects.toThrow();
  });
  it('refuses empty captures and expired reviews before sending', async () => {
    const { browser, transport } = setup();
    let time = now;
    const controller = new AgentSignIn(browser, transport, () => time);
    await controller.load();
    browser.cookies.getAll.mockResolvedValueOnce([]);
    await expect(controller.review('personal', 'alex')).rejects.toThrow();
    await controller.review('personal', 'alex');
    time += 300000;
    await expect(controller.share()).rejects.toThrow();
    expect(transport.mock.calls.some(([r]) => r.type === 'capture')).toBe(false);
  });
  it.each([
    'cancel',
    'disconnect',
  ])('restores the original permission state after %s during a permission prompt', async (exit) => {
    const fixture = setup();
    const { browser, transport, controller, state } = fixture;
    await controller.load();
    let allow!: (value: boolean) => void;
    browser.permissions.request.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          allow = (value) => {
            state.cookies = value;
            resolve(value);
          };
        }),
    );
    const review = controller.review('personal', 'alex');
    await vi.waitFor(() => expect(browser.permissions.request).toHaveBeenCalled());
    if (exit === 'cancel') controller.cancel();
    else browser.runtime.connect.mock.results[0].value.onDisconnect.addListener.mock.calls[0][0]();
    allow(true);
    await expect(review).rejects.toThrow();
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
    expect(browser.runtime.connect.mock.results[0].value.disconnect).toHaveBeenCalled();
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    browser.tabs.query.mockRejectedValueOnce(new Error('fixture-cookie-secret'));
    await expect(controller.load()).rejects.toThrow('Sign-in sharing unavailable.');
  });
  it('verifies cookies are absent even when removal reports no change', async () => {
    const fixture = setup();
    const { browser, controller, state } = fixture;
    await controller.load();
    browser.permissions.remove.mockImplementationOnce(async () => {
      state.cookies = false;
      return false;
    });
    await controller.review('personal', 'alex');
    restored(fixture);
    expect(controller.permissionWarning).toBe(false);
  });
  it('warns on removal rejection even if Chrome reports cookies absent', async () => {
    const { browser, controller, state } = setup();
    await controller.load();
    browser.permissions.remove.mockImplementationOnce(async () => {
      state.cookies = false;
      throw new Error('fixture-secret');
    });
    await controller.review('personal', 'alex');
    expect(controller.permissionWarning).toBe(true);
    expect(browser.permissions.contains).toHaveBeenLastCalledWith(permissions);
  });
  it.each([
    'request',
    'beginLogin',
    'cookies',
    'navigation',
    'empty',
  ])('restores the original permission state when review fails at %s', async (stage) => {
    const fixture = setup();
    const { browser, transport, controller } = fixture;
    await controller.load();
    if (stage === 'request') browser.permissions.request.mockRejectedValueOnce(new Error('secret'));
    if (stage === 'beginLogin') transport.mockRejectedValueOnce(new Error('secret'));
    if (stage === 'cookies') browser.cookies.getAll.mockRejectedValueOnce(new Error('secret'));
    if (stage === 'empty') browser.cookies.getAll.mockResolvedValueOnce([]);
    if (stage === 'navigation')
      browser.tabs.query.mockResolvedValueOnce([{ id: 8, url: site, incognito: false }]);
    await expect(controller.review('personal', 'alex')).rejects.toThrow(
      'Sign-in sharing unavailable.',
    );
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
    expect(browser.runtime.connect.mock.results[0].value.disconnect).toHaveBeenCalled();
  });
  it.each([
    'success',
    'failure',
    'cancel',
  ])('restores the original permission state before and after confirmation %s', async (exit) => {
    const fixture = setup();
    const { browser, transport, controller } = fixture;
    await controller.load();
    await controller.review('personal', 'alex');
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
    if (exit === 'cancel') controller.cancel();
    if (exit === 'failure') transport.mockRejectedValueOnce(new Error('secret'));
    if (exit === 'success') await controller.share();
    else await expect(controller.share()).rejects.toThrow();
    restored(fixture);
  });
  it.each([
    'rejects',
    'still present',
    'verification rejects',
  ])('reports a cleanup warning when removal %s without replacing the review result', async (failure) => {
    const { browser, transport, controller, state, before } = setup();
    await controller.load();
    if (failure === 'rejects')
      browser.permissions.remove.mockRejectedValueOnce(new Error('secret'));
    if (failure === 'still present') browser.permissions.remove.mockResolvedValueOnce(true);
    if (failure === 'verification rejects') {
      browser.permissions.contains
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('secret'));
    }
    await expect(controller.review('personal', 'alex')).resolves.toMatchObject({ count: 1 });
    expect(controller.permissionWarning).toBe(true);
    expect(browser.permissions.contains).toHaveBeenLastCalledWith(permissions);
    expect(state.origins).toEqual(before.origins);
    expect(browser.runtime.connect.mock.results[0].value.disconnect).toHaveBeenCalled();
    if (failure === 'verification rejects')
      await expect(controller.share()).resolves.toBeUndefined();
    else {
      await expect(controller.share()).rejects.toThrow('Sharing refused');
      expect(transport.mock.calls.some(([r]) => r.type === 'capture')).toBe(false);
    }
    expect(controller.permissionWarning).toBe(false);
    expect(state).toEqual(before);
  });
  it.each([
    'beginLogin',
    'cookies',
  ])('releases permissions when cancelled during %s', async (stage) => {
    const fixture = setup();
    const { browser, transport, controller } = fixture;
    await controller.load();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (stage === 'beginLogin')
      transport.mockImplementationOnce(async () => {
        await held;
        return { type: 'beginLogin', token: '00000000-0000-4000-8000-000000000001' };
      });
    else
      browser.cookies.getAll.mockImplementationOnce(async () => {
        await held;
        return [cookie()];
      });
    const review = controller.review('personal', 'alex');
    await vi.waitFor(() => {
      if (stage === 'beginLogin')
        expect(transport).toHaveBeenCalledWith({
          type: 'beginLogin',
          site,
          persona: 'alex',
          profile: 'personal',
        });
      else expect(browser.cookies.getAll).toHaveBeenCalled();
    });
    controller.cancel();
    finish();
    await expect(review).rejects.toThrow('Sign-in sharing unavailable.');
    expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    restored(fixture);
    await expect(controller.share()).rejects.toThrow();
  });
});
