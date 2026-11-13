// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../src/manifest.json';
import {
  captureHarness,
  confirming,
  cookie,
  deferred,
  type Harness,
  phase,
  reviewing,
  site,
} from './agent-capture-fixture';

afterEach(() => vi.useRealTimers());
function restored(h: Harness) {
  expect(h.state).toEqual(h.before);
  for (const [input] of h.browser.permissions.request.mock.calls)
    expect(input).toEqual({ permissions: ['cookies'] });
  for (const [input] of h.browser.permissions.remove.mock.calls)
    expect(input).toEqual({ permissions: ['cookies'] });
  if (h.browser.permissions.remove.mock.calls.length) {
    const checks = h.browser.permissions.contains.mock.calls.flatMap(([input], index) =>
      input.permissions ? [h.browser.permissions.contains.mock.invocationCallOrder[index]] : [],
    );
    expect(checks.at(-1)).toBeGreaterThan(
      h.browser.permissions.remove.mock.invocationCallOrder.at(-1)!,
    );
  }
}
const types = (h: Harness) => h.native.mock.calls.map(([r]) => r.type);

describe('worker capture lease', () => {
  it('keeps cookies optional and required host permissions unchanged', () => {
    expect(manifest.optional_permissions).toEqual(['cookies']);
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
  it('serializes two popups racing at review without a second permission request or native message', async () => {
    const h = captureHarness();
    const a = h.popup();
    const b = h.popup();
    a.load();
    b.load();
    await phase(a, 'ready');
    await phase(b, 'ready');
    h.native.mockClear();
    a.start();
    b.start();
    await phase(a, 'permission');
    await phase(b, 'busy');
    expect(b.view.message).toMatch(/another sharing is in progress/i);
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.request).not.toHaveBeenCalled();
    await a.allow();
    await phase(a, 'confirming');
    a.cancel();
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    restored(h);
  });
  it('refuses B acquiring during A confirmation while host validation is pending', async () => {
    const h = captureHarness();
    const b = h.popup();
    b.load();
    await phase(b, 'ready');
    const a = await confirming(h);
    const host = deferred<boolean>();
    h.browser.permissions.contains
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(() => host.promise);
    a.confirm();
    await phase(a, 'sending');
    await vi.waitFor(() =>
      expect(h.browser.permissions.contains).toHaveBeenLastCalledWith({
        origins: [`${site}:443/*`],
      }),
    );
    b.start();
    await phase(b, 'busy');
    expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
    host.resolve(true);
    await phase(a, 'shared');
    restored(h);
    expect(types(h).filter((t) => t === 'capture')).toHaveLength(1);
  });
  it.each([
    'cancel',
    'disconnect',
  ])('quarantines a late grant with another lease attempting to start after %s', async (exit) => {
    const h = captureHarness();
    const b = h.popup();
    b.load();
    await phase(b, 'ready');
    const a = await reviewing(h);
    const prompt = deferred<boolean>();
    h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
    const allowed = a.allow();
    await phase(a, 'prompt');
    if (exit === 'cancel') a.cancel();
    else a.client.disconnect();
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1));
    b.start();
    await phase(b, 'busy');
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    prompt.resolve(true);
    await allowed;
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    b.load();
    await phase(b, 'ready');
    b.start();
    await phase(b, 'permission');
    await b.allow();
    await phase(b, 'confirming');
    b.confirm();
    await phase(b, 'shared');
    restored(h);
    expect(types(h).filter((t) => t === 'beginLogin')).toHaveLength(1);
  });
  it('ignores A late permission result after B acquires a new lease', async () => {
    const h = captureHarness();
    const a = await reviewing(h);
    const prompt = deferred<boolean>();
    h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
    const allowed = a.allow();
    await phase(a, 'prompt');
    a.cancel();
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1));
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2));
    const b = await confirming(h);
    prompt.resolve(true);
    await allowed;
    expect(h.state.cookies).toBe(true);
    expect(b.view.phase).toBe('confirming');
    b.confirm();
    await phase(b, 'shared');
    restored(h);
  });
  it('refuses navigation to a withheld site before Review without requesting cookies or contacting native messaging', async () => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    h.native.mockClear();
    h.browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://withheld.test/account', incognito: false },
    ]);
    a.start();
    await phase(a, 'failed');
    expect(a.view.message).toContain("Chrome's extension menu");
    expect(h.browser.permissions.request).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.remove).not.toHaveBeenCalled();
    restored(h);
  });
  it('rechecks host access withdrawn during the cookie prompt before beginLogin', async () => {
    const h = captureHarness();
    const a = await reviewing(h);
    h.native.mockClear();
    h.browser.permissions.request.mockImplementationOnce(async () => {
      h.state.cookies = true;
      h.state.origins.shift();
      return true;
    });
    await a.allow();
    await phase(a, 'failed');
    expect(a.view.message).toContain("Chrome's extension menu");
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
    expect(h.state.cookies).toBe(false);
    expect(h.state.origins).toEqual(h.before.origins.slice(1));
  });
  it.each([
    'On click',
    'On specific sites',
  ])('refuses withheld sites (%s) on load before any native message', async () => {
    const h = captureHarness();
    h.state.origins.shift();
    const before = structuredClone(h.state);
    const a = h.popup();
    a.load();
    await phase(a, 'failed');
    expect(a.view.message).toContain("Chrome's extension menu");
    expect(h.browser.permissions.contains.mock.calls).toEqual([
      [{ permissions: ['cookies'] }],
      [{ origins: [`${site}:443/*`] }],
    ]);
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.request).not.toHaveBeenCalled();
    expect(h.state).toEqual(before);
  });
  it.each([
    'valid',
    'withheld',
    'invalid',
    'uncheckable',
  ])('blocks a pre-existing or uncheckable grant on every load: %s', async (kind) => {
    const h = captureHarness();
    h.state.cookies = true;
    if (kind === 'withheld') h.state.origins.shift();
    if (kind === 'invalid')
      h.browser.tabs.query.mockResolvedValue([
        { id: 7, url: 'chrome://settings', incognito: false },
      ]);
    if (kind === 'uncheckable')
      h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
    const a = h.popup();
    a.load();
    await phase(a, 'failed');
    expect(a.view.warning).toBe(true);
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.request).not.toHaveBeenCalled();
    expect(h.browser.permissions.remove).not.toHaveBeenCalled();
    expect(h.state.cookies).toBe(true);
  });
  it('requires explicit removal of a grant appearing between load and review', async () => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    h.native.mockClear();
    h.state.cookies = true;
    a.start();
    await phase(a, 'failed');
    expect(a.view.warning).toBe(true);
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.remove).not.toHaveBeenCalled();
    a.send({ type: 'removeCookieAccess' });
    await phase(a, 'ready');
    restored(h);
  });
  it.each([
    'denial',
    'request rejection',
    'beginLogin',
    'cookies',
    'empty',
    'navigation',
    'capture',
  ])('restores permission state after exit at %s', async (exit) => {
    const h = captureHarness();
    const a = await reviewing(h);
    if (exit === 'denial') h.browser.permissions.request.mockResolvedValueOnce(false);
    if (exit === 'request rejection')
      h.browser.permissions.request.mockRejectedValueOnce(new Error('fixture-secret'));
    if (exit === 'beginLogin') h.native.mockRejectedValueOnce(new Error('fixture-secret'));
    if (exit === 'cookies')
      h.browser.cookies.getAll.mockRejectedValueOnce(new Error('fixture-secret'));
    if (exit === 'empty') h.browser.cookies.getAll.mockResolvedValueOnce([]);
    if (exit === 'navigation')
      h.browser.tabs.query.mockResolvedValue([{ id: 8, url: site, incognito: false }]);
    await a.allow();
    if (exit === 'capture') {
      await phase(a, 'confirming');
      h.native.mockRejectedValueOnce(new Error('fixture-secret'));
      a.confirm();
    }
    await phase(a, 'failed');
    restored(h);
    expect(a.view.message).not.toContain('fixture-secret');
    if (exit === 'denial' || exit === 'request rejection')
      expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  });
  it.each([
    'success',
    'cancel',
    'host withdrawn',
    'navigation',
    'cookie check rejects',
    'cookies absent',
    'count changed',
  ])('revalidates confirmation and restores permissions: %s', async (exit) => {
    const h = captureHarness();
    const a = await confirming(h);
    if (exit === 'cancel') a.cancel();
    else {
      if (exit === 'host withdrawn') h.state.origins.shift();
      if (exit === 'navigation')
        h.browser.tabs.query.mockResolvedValue([
          { id: 7, url: 'https://other.test', incognito: false },
        ]);
      if (exit === 'cookie check rejects')
        h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
      if (exit === 'cookies absent') h.state.cookies = false;
      if (exit === 'count changed') h.browser.cookies.getAll.mockResolvedValueOnce([]);
      a.confirm();
    }
    await phase(a, exit === 'success' ? 'shared' : exit === 'cancel' ? 'cancelled' : 'failed');
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalled());
    if (exit !== 'host withdrawn') restored(h);
    else expect(h.state.cookies).toBe(false);
    expect(types(h).filter((t) => t === 'capture')).toHaveLength(exit === 'success' ? 1 : 0);
  });
  it.each([
    'remove rejects',
    'still present',
    'verification rejects',
    'rejects but absent',
  ])('shows cleanup warning alongside the outcome and a toolbar badge: %s', async (failure) => {
    const h = captureHarness();
    const a = await confirming(h);
    if (failure === 'remove rejects')
      h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
    if (failure === 'still present') h.browser.permissions.remove.mockResolvedValueOnce(true);
    if (failure === 'verification rejects')
      h.browser.permissions.remove.mockImplementationOnce(async () => {
        h.state.cookies = false;
        h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
        return true;
      });
    if (failure === 'rejects but absent')
      h.browser.permissions.remove.mockImplementationOnce(async () => {
        h.state.cookies = false;
        throw new Error('fixture-secret');
      });
    a.confirm();
    await phase(a, 'shared');
    expect(a.view.warning).toBe(true);
    expect(a.view.cleanupFailed).toBe(true);
    expect(h.browser.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    const b = h.popup();
    b.load();
    await phase(b, 'failed');
    expect(b.view.warning).toBe(true);
    b.send({ type: 'removeCookieAccess' });
    await phase(b, 'ready');
    expect(h.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    restored(h);
  });
  it('accepts removal reporting no change only when absence is verified', async () => {
    const h = captureHarness();
    const a = await confirming(h);
    h.browser.permissions.remove.mockImplementationOnce(async () => {
      h.state.cookies = false;
      return false;
    });
    a.confirm();
    await phase(a, 'shared');
    expect(a.view.warning).toBe(false);
    restored(h);
  });
  it('expires the lease after two minutes and refuses an expired confirmation', async () => {
    vi.useFakeTimers();
    const h = captureHarness();
    const b = await confirming(h);
    await vi.advanceTimersByTimeAsync(120000);
    expect(b.view.phase).toBe('cancelled');
    b.confirm();
    await vi.advanceTimersByTimeAsync(0);
    restored(h);
    expect(types(h)).not.toContain('capture');
  });
  it('timeout interrupts a hung async step and ignores its late completion', async () => {
    vi.useFakeTimers();
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    const tab = deferred<{ id: number; url: string; incognito: boolean }[]>();
    h.browser.tabs.query.mockImplementationOnce(() => tab.promise);
    a.start();
    await phase(a, 'reviewing');
    await vi.advanceTimersByTimeAsync(120000);
    expect(a.view.phase).toBe('cancelled');
    tab.resolve([{ id: 7, url: site, incognito: false }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.view.phase).toBe('cancelled');
    restored(h);
  });
  it.each([
    'idle',
    'reviewing',
    'permission',
    'prompt',
    'confirming',
    'sending',
    'cleaning',
  ])('cleans only its own grant on port disconnect in %s', async (stage) => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    const pending = deferred<boolean>();
    const cleanup = deferred<boolean>();
    const native = deferred<Awaited<ReturnType<typeof h.native>>>();
    if (stage === 'reviewing')
      h.browser.permissions.contains.mockImplementationOnce(() => pending.promise);
    if (stage !== 'idle') {
      a.start();
      await phase(a, stage === 'reviewing' ? 'reviewing' : 'permission');
    }
    if (stage === 'prompt') {
      h.browser.permissions.request.mockImplementationOnce(() => pending.promise);
      void a.allow();
      await phase(a, 'prompt');
    }
    if (['confirming', 'sending', 'cleaning'].includes(stage)) {
      await a.allow();
      await phase(a, 'confirming');
    }
    if (stage === 'sending') {
      h.native.mockImplementationOnce(() => native.promise);
      a.confirm();
      await phase(a, 'sending');
    }
    if (stage === 'cleaning') {
      h.browser.permissions.remove.mockImplementationOnce(() => cleanup.promise);
      a.confirm();
      await phase(a, 'cleaning');
    }
    a.client.disconnect();
    pending.resolve(false);
    if (stage === 'cleaning') {
      h.state.cookies = false;
      cleanup.resolve(true);
    }
    native.resolve({ type: 'capture' });
    if (['prompt', 'confirming', 'sending', 'cleaning'].includes(stage))
      await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    restored(h);
    if (stage === 'idle' || stage === 'reviewing' || stage === 'permission')
      expect(h.browser.permissions.remove).not.toHaveBeenCalled();
  });
});

it('quarantines a stale armed click after its lease ended while another lease is confirming', async () => {
  const h = captureHarness();
  const a = await reviewing(h);
  const oldLease = a.view.lease!;
  a.cancel();
  await phase(a, 'cancelled');
  const b = await confirming(h);
  h.native.mockClear();
  // The worker revoked A, but its view's terminal update was still in transit.
  a.send({ type: 'requesting', lease: oldLease });
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  a.send({ type: 'permission', lease: oldLease, granted: true });
  await phase(b, 'cancelled');
  await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  b.confirm();
  expect(h.native).not.toHaveBeenCalled();
  const c = await confirming(h);
  c.confirm();
  await phase(c, 'shared');
  restored(h);
});
it('consumes a permission result once and cannot repeat beginLogin', async () => {
  const h = captureHarness();
  const a = await reviewing(h);
  a.send({ type: 'requesting', lease: a.view.lease! });
  h.state.cookies = true;
  a.send({ type: 'permission', lease: a.view.lease!, granted: true });
  a.send({ type: 'permission', lease: a.view.lease!, granted: true });
  await phase(a, 'confirming');
  expect(types(h).filter((t) => t === 'beginLogin')).toHaveLength(1);
  a.cancel();
  await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  restored(h);
});
it.each([
  'review cookie read',
  'confirmation cookie read',
  'confirmation host check',
])('cancels a delayed %s and ignores its completion', async (stage) => {
  const h = captureHarness();
  const a = await reviewing(h);
  const cookies = deferred<chrome.cookies.Cookie[]>();
  const host = deferred<boolean>();
  if (stage === 'review cookie read')
    h.browser.cookies.getAll.mockImplementationOnce(() => cookies.promise);
  const allowed = a.allow();
  if (stage === 'review cookie read')
    await vi.waitFor(() => expect(h.browser.cookies.getAll).toHaveBeenCalled());
  else {
    await allowed;
    await phase(a, 'confirming');
    if (stage === 'confirmation cookie read')
      h.browser.cookies.getAll.mockImplementationOnce(() => cookies.promise);
    else
      h.browser.permissions.contains
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(() => host.promise);
    a.confirm();
    await phase(a, 'sending');
    await vi.waitFor(() => {
      if (stage === 'confirmation cookie read')
        expect(h.browser.cookies.getAll).toHaveBeenCalledTimes(2);
      else
        expect(h.browser.permissions.contains).toHaveBeenLastCalledWith({
          origins: [`${site}:443/*`],
        });
    });
  }
  a.cancel();
  await phase(a, 'cancelled');
  await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  cookies.resolve([cookie()]);
  host.resolve(true);
  await allowed;
  expect(a.view.phase).toBe('cancelled');
  expect(types(h)).not.toContain('capture');
  restored(h);
});
