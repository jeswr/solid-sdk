// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
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

describe('global idle cookie cleanup', () => {
  it('arms without an ownership marker or session storage', async () => {
    const h = captureHarness();
    h.browser.storage.session.set.mockRejectedValue(new Error('fixture-secret'));
    h.browser.storage.local.set.mockRejectedValue(new Error('fixture-secret'));
    const a = await reviewing(h);
    expect(a.view.armedLease).toBe(a.view.lease);
    expect(h.browser.storage.session.set).not.toHaveBeenCalled();
    expect(h.browser.storage.local.set).not.toHaveBeenCalled();
    a.cancel();
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  });
  it('automatically removes an unmarked grant at worker start before popup intents', async () => {
    const h = captureHarness();
    h.state.cookies = true;
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
    expect(a.view.warning).toBe(false);
    restored(h);
  });
  it.each([
    'onStartup',
    'onInstalled',
  ] as const)('automatically removes idle cookie access on runtime.%s without a popup', async (event) => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    h.state.cookies = true;
    h.browser.runtime[event].emit(undefined);
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    await vi.waitFor(() => expect(a.view.warning).toBe(false));
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
    restored(h);
  });
  it.each([
    'cookies',
    'unrelated permission',
  ])('automatically removes idle cookie access onAdded for %s without a popup', async (change) => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    a.client.disconnect();
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit(
      change === 'cookies'
        ? { permissions: ['cookies'] }
        : { origins: ['https://other.test:443/*'] },
    );
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    await vi.waitFor(() => restored(h));
  });
  it.each([
    'worker restart',
    'browser restart',
  ])('removes a granted capture at start after %s with no ownership marker', async (kind) => {
    vi.useFakeTimers();
    const h = captureHarness();
    await confirming(h);
    expect(h.state.cookies).toBe(true);
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
    if (kind === 'browser restart') {
      for (const key of Object.keys(h.browser.storage.session.data))
        delete h.browser.storage.session.data[key];
    }
    h.native.mockClear();
    h.browser.cookies.getAll.mockClear();
    h.restart();
    h.browser.runtime.onStartup.emit(undefined);
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2);
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
    expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
    expect(types(h)).toEqual(['list']);
    restored(h);
  });
  it.each([
    'remove rejects',
    'still present',
    'verification rejects',
  ])('keeps the local display marker and warning when automatic removal fails: %s', async (failure) => {
    const h = captureHarness();
    h.state.cookies = true;
    if (failure === 'remove rejects')
      h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
    if (failure === 'still present') h.browser.permissions.remove.mockResolvedValueOnce(false);
    if (failure === 'verification rejects')
      h.browser.permissions.remove.mockImplementationOnce(async () => {
        h.state.cookies = false;
        h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
        return true;
      });
    const a = h.popup();
    a.load();
    await phase(a, 'failed');
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBe(true);
    expect(h.browser.storage.session.set).not.toHaveBeenCalled();
    expect(a.view.warning).toBe(true);
    expect(a.view.cleanupFailed).toBe(true);
    expect(h.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
    expect(h.native).not.toHaveBeenCalled();
    expect(a.view.message).not.toContain('fixture-secret');
    a.send({ type: 'removeCookieAccess' });
    await phase(a, 'ready');
    restored(h);
  });
  it.each([
    'read',
    'write',
  ])('removes authority even when the display marker cannot be accessed: %s', async (operation) => {
    const h = captureHarness();
    h.state.cookies = true;
    if (operation === 'write')
      h.browser.storage.local.set.mockRejectedValueOnce(new Error('fixture-secret'));
    else h.browser.storage.local.get.mockRejectedValueOnce(new Error('fixture-secret'));
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    restored(h);
  });
  it('clears an old local display marker after verifying absence without removal', async () => {
    const h = captureHarness();
    h.browser.storage.local.data[CAPTURE_CLEANUP_KEY] = { leaseId: 99, requestedAt: 1 };
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    expect(h.browser.permissions.remove).not.toHaveBeenCalled();
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
    expect(h.browser.storage.local.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.browser.permissions.contains.mock.invocationCallOrder[0],
    );
  });
  it('serializes cleanup and new leases, showing cleanup until verified absence', async () => {
    const h = captureHarness();
    h.state.cookies = true;
    const removed = deferred<boolean>();
    const absent = deferred<boolean>();
    h.browser.permissions.remove.mockImplementationOnce(async () => {
      await removed.promise;
      h.state.cookies = false;
      h.browser.permissions.contains.mockImplementationOnce(() => absent.promise);
      return true;
    });
    const a = h.popup();
    a.load();
    a.start();
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1));
    expect(a.view.warning).toBe(true);
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBe(true);
    expect(h.native).not.toHaveBeenCalled();
    removed.resolve(true);
    await vi.waitFor(() => expect(h.browser.permissions.contains).toHaveBeenCalledTimes(2));
    expect(a.view.warning).toBe(true);
    expect(h.native).not.toHaveBeenCalled();
    absent.resolve(false);
    await phase(a, 'ready');
    a.start();
    await phase(a, 'permission');
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
    a.cancel();
  });
  it.each([
    'acquiring',
    'confirming',
    'sending',
  ])('preserves a live %s window on startup and installation events', async (stage) => {
    const h = captureHarness();
    const a = await reviewing(h);
    const prompt = deferred<boolean>();
    const reply = deferred<Awaited<ReturnType<typeof h.native>>>();
    if (stage === 'acquiring')
      h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
    const allowed = a.allow();
    await phase(a, stage === 'acquiring' ? 'prompt' : 'confirming');
    if (stage === 'sending') {
      h.native.mockImplementationOnce(() => reply.promise);
      a.confirm();
      await vi.waitFor(() => expect(types(h)).toContain('capture'));
    }
    h.browser.runtime.onStartup.emit(undefined);
    h.browser.runtime.onInstalled.emit(undefined);
    expect(h.browser.permissions.remove).not.toHaveBeenCalled();
    if (stage === 'acquiring') {
      h.state.cookies = true;
      h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
      prompt.resolve(true);
    }
    reply.resolve({ type: 'capture' });
    await allowed;
    if (stage === 'sending') await phase(a, 'shared');
    else {
      await phase(a, 'confirming');
      a.cancel();
      await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    }
    await vi.waitFor(() => restored(h));
  });
});

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
    await vi.waitFor(() => restored(h));
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
    vi.useFakeTimers();
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
    b.start();
    await phase(b, 'busy');
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    prompt.resolve(true);
    await allowed;
    if (exit === 'disconnect') {
      // A closed popup cannot report settlement. The worker revokes immediately
      // but retains the fence through the bounded orphan settle window.
      await vi.advanceTimersByTimeAsync(0);
      b.start();
      expect(b.view.message).toBe('Finishing the previous sharing.');
      expect(h.state.cookies).toBe(false);
      expect(h.browser.permissions.remove).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60000);
    }
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
  it('waits for A permission settlement before B acquires and ignores duplicate late results', async () => {
    vi.useFakeTimers();
    const h = captureHarness();
    const b = h.popup();
    b.load();
    await phase(b, 'ready');
    const a = await reviewing(h);
    const prompt = deferred<boolean>();
    h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
    const allowed = a.allow();
    await phase(a, 'prompt');
    a.cancel();
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.view.message).toBe('Finishing the previous sharing.');
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2);
    const oldLease = a.view.lease!;
    prompt.resolve(true);
    await allowed;
    await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2));
    await confirming(h, b);
    a.send({ type: 'permission', lease: oldLease, granted: true });
    await vi.advanceTimersByTimeAsync(0);
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
  ])('automatically removes a pre-existing grant before site validation: %s', async (kind) => {
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
    await phase(a, kind === 'withheld' || kind === 'invalid' ? 'failed' : 'ready');
    expect(a.view.warning).toBe(false);
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
    expect(h.browser.permissions.request).not.toHaveBeenCalled();
    if (kind === 'withheld' || kind === 'invalid') expect(h.native).not.toHaveBeenCalled();
    expect(h.state.cookies).toBe(false);
    expect(a.view.message).not.toContain('fixture-secret');
  });
  it('automatically removes a grant appearing between load and review', async () => {
    const h = captureHarness();
    const a = h.popup();
    a.load();
    await phase(a, 'ready');
    h.native.mockClear();
    h.state.cookies = true;
    a.start();
    await phase(a, 'permission');
    expect(a.view.warning).toBe(false);
    expect(h.native).not.toHaveBeenCalled();
    expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
    restored(h);
    a.cancel();
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
    if (exit !== 'cookies absent')
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
    await phase(b, 'busy');
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
    await vi.advanceTimersByTimeAsync(10000);
    expect(a.view.phase).toBe('failed');
    tab.resolve([{ id: 7, url: site, incognito: false }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.view.phase).toBe('failed');
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
  ])('verifies absence and cleans any grant on port disconnect in %s', async (stage) => {
    vi.useFakeTimers();
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
    if (['confirming', 'sending', 'cleaning'].includes(stage))
      await vi.waitFor(() => expect(h.browser.permissions.remove).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.state.cookies).toBe(false));
    await vi.waitFor(() => restored(h));
    if (stage === 'idle' || stage === 'reviewing' || stage === 'permission')
      expect(h.browser.permissions.remove).not.toHaveBeenCalled();
  });
});

it('contests a stale armed click while another lease is confirming', async () => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = await reviewing(h);
  const oldLease = a.view.lease!;
  a.cancel();
  await phase(a, 'cancelled');
  const b = await confirming(h);
  h.native.mockClear();
  // The worker revoked A, but its view's terminal update was still in transit.
  a.send({ type: 'requesting', lease: oldLease });
  a.send({ type: 'permission', lease: oldLease, granted: true });
  expect(a.view.message).toBe('Another sharing started. Try again.');
  expect(b.view.phase).toBe('failed');
  b.confirm();
  await vi.advanceTimersByTimeAsync(60000);
  expect(types(h).filter((type) => type !== 'list')).toEqual([]);
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
  await vi.waitFor(() => restored(h));
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
    await vi.waitFor(() => expect(h.browser.cookies.getAll).toHaveBeenCalled(), { timeout: 2500 });
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

it.each([
  'navigate to a withheld site',
  'switch to a withheld tab',
  'same-site URL change',
  'window focus change',
  'permission removal',
  'permission addition',
  'cookie permission addition',
])('latches %s while confirmation final host validation is paused and never dispatches capture', async (change) => {
  const h = captureHarness();
  const a = await confirming(h);
  const host = deferred<boolean>();
  h.browser.permissions.contains
    .mockResolvedValueOnce(true) // Cookie authority.
    .mockResolvedValueOnce(true) // Initial host validation.
    .mockImplementationOnce(() => host.promise); // Final host validation of the original tab.
  const checks = h.browser.permissions.contains.mock.calls.length;
  a.confirm();
  await vi.waitFor(() => expect(h.browser.permissions.contains).toHaveBeenCalledTimes(checks + 3));
  expect(a.view.phase).toBe('sending');
  if (change === 'navigate to a withheld site') {
    h.browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://withheld.test', incognito: false },
    ]);
    h.browser.tabs.onUpdated.emit(7, { url: 'https://withheld.test' });
  }
  if (change === 'switch to a withheld tab') {
    h.browser.tabs.query.mockResolvedValue([
      { id: 8, url: 'https://withheld.test', incognito: false },
    ]);
    h.browser.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
  }
  if (change === 'same-site URL change') h.browser.tabs.onUpdated.emit(7, { url: `${site}/new` });
  if (change === 'window focus change') h.browser.windows.onFocusChanged.emit(2);
  if (change === 'permission removal')
    h.browser.permissions.onRemoved.emit({ origins: [`${site}:443/*`] });
  if (change === 'permission addition')
    h.browser.permissions.onAdded.emit({ origins: ['https://other.test:443/*'] });
  if (change === 'cookie permission addition')
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  // The old Chrome check can truthfully return true for its earlier origin.
  host.resolve(true);
  await phase(a, 'failed');
  await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  expect(types(h)).not.toContain('capture');
  restored(h);
});

it.each([
  'preview',
  'cookie check',
  'tab query',
  'host check',
  'cookie read',
])('invalidates confirmation at its %s await boundary even if authorization is immediately restored', async (stage) => {
  const h = captureHarness();
  const a = await confirming(h);
  const paused = deferred<boolean>();
  const tab = deferred<{ id: number; url: string; incognito: boolean }[]>();
  const cookies = deferred<chrome.cookies.Cookie[]>();
  if (stage === 'cookie check')
    h.browser.permissions.contains.mockImplementationOnce(() => paused.promise);
  if (stage === 'tab query') h.browser.tabs.query.mockImplementationOnce(() => tab.promise);
  if (stage === 'host check')
    h.browser.permissions.contains
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => paused.promise);
  if (stage === 'cookie read')
    h.browser.cookies.getAll.mockImplementationOnce(() => cookies.promise);
  if (stage !== 'preview') {
    const checks = h.browser.permissions.contains.mock.calls.length;
    const queries = h.browser.tabs.query.mock.calls.length;
    a.confirm();
    await phase(a, 'sending');
    await vi.waitFor(() => {
      if (stage === 'cookie read') expect(h.browser.cookies.getAll).toHaveBeenCalledTimes(2);
      else if (stage === 'tab query')
        expect(h.browser.tabs.query).toHaveBeenCalledTimes(queries + 1);
      else
        expect(h.browser.permissions.contains).toHaveBeenCalledTimes(
          checks + (stage === 'host check' ? 2 : 1),
        );
    });
  }
  h.browser.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
  h.browser.tabs.onActivated.emit({ tabId: 7, windowId: 1 });
  paused.resolve(true);
  tab.resolve([{ id: 7, url: `${site}/account`, incognito: false }]);
  cookies.resolve([cookie()]);
  a.confirm();
  await phase(a, 'failed');
  await vi.waitFor(() => expect(h.state.cookies).toBe(false));
  expect(types(h)).not.toContain('capture');
  restored(h);
});
