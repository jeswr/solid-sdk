// AUTHORED-BY GPT-6.1-Sol (Codex)
import { expect, it, vi } from 'vitest';
import { syncOriginFetchInjection } from '../src/background/global-fetch-register';

it('removes the legacy all-origins registration and uses exact scheme/host/port matches', async () => {
  const scripting = {
    getRegisteredContentScripts: vi.fn(async () => [
      { id: 'solid-main-world-inject' },
      { id: 'unrelated' },
    ]),
    unregisterContentScripts: vi.fn(async () => {}),
    registerContentScripts: vi.fn(async () => {}),
  };
  expect(
    await syncOriginFetchInjection(['https://app.example', 'http://localhost:8081'], scripting),
  ).toBe(true);
  expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
    ids: ['solid-main-world-inject'],
  });
  expect(scripting.registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({
      matches: ['https://app.example:443/*'],
      js: ['inject/fetch-patch.js'],
      world: 'MAIN',
      persistAcrossSessions: true,
    }),
    expect.objectContaining({ matches: ['http://localhost:8081/*'] }),
  ]);
});

it('unregisters revoked/expired origins and leaves correct registrations intact on wake', async () => {
  const id = `solid-origin-${encodeURIComponent('https://app.example')}`;
  const stale = `solid-origin-${encodeURIComponent('https://revoked.example')}`;
  const scripting = {
    getRegisteredContentScripts: vi.fn(async () => [
      { id, matches: ['https://app.example:443/*'] },
      { id: stale, matches: ['https://revoked.example/*'] },
    ]),
    unregisterContentScripts: vi.fn(async () => {}),
    registerContentScripts: vi.fn(async () => {}),
  };
  expect(await syncOriginFetchInjection(['https://app.example'], scripting)).toBe(true);
  expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [stale] });
  expect(scripting.registerContentScripts).not.toHaveBeenCalled();
});

it('fails safely when scripting is missing or registration fails', async () => {
  expect(await syncOriginFetchInjection([], undefined)).toBe(false);
  const scripting = {
    getRegisteredContentScripts: vi.fn().mockRejectedValue(new Error('fixture unavailable')),
    unregisterContentScripts: vi.fn(),
    registerContentScripts: vi.fn(),
  };
  expect(await syncOriginFetchInjection([], scripting)).toBe(false);
  expect(scripting.registerContentScripts).not.toHaveBeenCalled();
});

// Model Chrome URLPattern's exact-host HTTP(S) subset, including its port wildcard
// default. Chromium's ExtensionURLPatternTest.Match17 covers explicit default ports
// matching port-less URLs and rejecting other ports:
// https://chromium.googlesource.com/chromium/src/+/main/extensions/common/url_pattern_unittest.cc
function matchesChromeOriginPattern(pattern: string, value: string): boolean {
  const parts = /^(https?):\/\/(\[[^\]]+\]|[^/:]+)(?::(\d+|\*))?\/\*$/.exec(pattern);
  if (!parts) return false;
  const url = new URL(value);
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
  return (
    `${parts[1]}:` === url.protocol &&
    parts[2] === url.hostname &&
    (parts[3] === undefined || parts[3] === '*' || parts[3] === effectivePort)
  );
}

it.each([
  {
    origin: 'https://app.example',
    own: ['https://app.example/', 'https://app.example:443/x'],
    foreign: ['https://app.example:8443/', 'http://app.example/', 'https://sub.app.example/'],
  },
  {
    origin: 'http://localhost',
    own: ['http://localhost/', 'http://localhost:80/x'],
    foreign: ['http://localhost:8080/', 'https://localhost/'],
  },
  {
    origin: 'https://app.example:8443',
    own: ['https://app.example:8443/x'],
    foreign: ['https://app.example/', 'https://app.example:443/', 'https://app.example:8444/'],
  },
  {
    origin: 'http://localhost:8081',
    own: ['http://localhost:8081/x'],
    foreign: ['http://localhost/', 'http://localhost:8082/'],
  },
  {
    origin: 'http://[::1]',
    own: ['http://[::1]/', 'http://[::1]:80/x'],
    foreign: ['http://[::1]:8080/'],
  },
])('registers only $origin under Chrome port matching semantics', async ({
  origin,
  own,
  foreign,
}) => {
  const registered: chrome.scripting.RegisteredContentScript[] = [];
  const scripting = {
    getRegisteredContentScripts: async () => [],
    unregisterContentScripts: async () => {},
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
      registered.push(...scripts);
    },
  };
  expect(await syncOriginFetchInjection([origin], scripting)).toBe(true);
  const patterns = registered.flatMap((script) => script.matches ?? []);
  expect(patterns).toHaveLength(1);
  for (const url of own)
    expect(
      patterns.some((pattern) => matchesChromeOriginPattern(pattern, url)),
      url,
    ).toBe(true);
  for (const url of foreign)
    expect(
      patterns.some((pattern) => matchesChromeOriginPattern(pattern, url)),
      url,
    ).toBe(false);
});

it('replaces a persisted default-port wildcard registration on wake', async () => {
  const id = `solid-origin-${encodeURIComponent('https://app.example')}`;
  const scripting = {
    getRegisteredContentScripts: async () => [{ id, matches: ['https://app.example/*'] }],
    unregisterContentScripts: vi.fn(async () => {}),
    registerContentScripts: vi.fn(async () => {}),
  };
  expect(await syncOriginFetchInjection(['https://app.example'], scripting)).toBe(true);
  expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [id] });
  expect(scripting.registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id, matches: ['https://app.example:443/*'] }),
  ]);
});
