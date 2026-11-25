// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';
import { captureHarness, deferred, phase, reviewing, site } from './agent-capture-fixture';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});
function fixture(startup?: Parameters<typeof captureHarness>[1]) {
  const h = captureHarness(false, startup);
  document.body.innerHTML = readFileSync(`${import.meta.dirname}/../src/popup/popup.html`, 'utf8');
  const root = document.getElementById('agent-sign-in')!;
  const p = h.popup();
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#agent-${id}`)!;
  const text = () => root.querySelector('#agent-sign-in-status')!.textContent;
  const warning = () => root.querySelector<HTMLElement>('#agent-permission-warning')!;
  const mount = () => mountAgentSignIn(root, p.browser);
  const choose = async () => {
    await phase(p, 'ready');
    const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
    persona.value = 'alex';
    persona.dispatchEvent(new Event('change'));
  };
  const review = async () => {
    await choose();
    button('review').click();
    await phase(p, 'permission');
    expect(button('review').textContent).toBe('Allow cookies and review');
    button('review').click();
    await phase(p, 'confirming');
  };
  return { h, p, root, button, text, warning, mount, choose, review };
}
const nativeTypes = (p: ReturnType<typeof fixture>) => p.h.native.mock.calls.map(([r]) => r.type);

it.each([
  30000, 60000,
])('shows the removal warning instead of finishing at %s ms and keeps retry enabled', async (delay) => {
  vi.useFakeTimers();
  const f = fixture();
  const a = await reviewing(f.h);
  const prompt = deferred<boolean>();
  f.h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
  void a.allow();
  await phase(a, 'prompt');
  f.h.native.mockClear();
  f.h.state.cookies = true;
  f.h.browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  a.client.disconnect();
  f.mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.text()).toBe('Remove cookie access before sharing a sign-in.');
  expect(f.warning().hidden).toBe(false);
  expect(f.warning().textContent).toContain("Chrome's extension settings");
  expect(f.button('remove-cookie-access').textContent).toBe('Remove cookie access');
  expect(f.button('remove-cookie-access').disabled).toBe(false);
  expect(f.button('review').disabled).toBe(true);
  expect(f.h.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  await vi.advanceTimersByTimeAsync(delay);
  f.p.start();
  expect(f.p.view.phase).toBe('busy');
  expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  f.h.browser.permissions.remove.mockImplementation(async () => {
    f.h.state.cookies = false;
    return true;
  });
  f.button('remove-cookie-access').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.h.state.cookies).toBe(false);
  expect(f.warning().hidden).toBe(true);
  if (delay < 60000) {
    f.p.start();
    expect(f.p.view.message).toBe('Finishing the previous sharing.');
    await vi.advanceTimersByTimeAsync(60000 - delay);
  }
  await f.choose();
  expect(f.button('review').disabled).toBe(false);
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  f.p.client.disconnect();
});

it('requests cookies synchronously in the authorized click gesture and renders worker metadata before sending', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
  f.button('review').click();
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  await phase(f.p, 'permission');
  f.button('review').click();
  expect(f.h.browser.permissions.request).toHaveBeenCalledWith({ permissions: ['cookies'] });
  expect(f.p.client.postMessage).toHaveBeenLastCalledWith({
    type: 'requesting',
    lease: f.p.view.lease,
  });
  await phase(f.p, 'confirming');
  expect(f.root.querySelector('#agent-preview')!.textContent).toContain(
    '1 cookie for https://shop.test with Alex Example (Personal)',
  );
  expect(nativeTypes(f)).toEqual(['list', 'beginLogin']);
  expect(f.root.textContent).not.toContain('fixture-cookie-secret');
  f.button('confirm').click();
  await phase(f.p, 'shared');
  expect(f.text()).toBe('Sign-in shared.');
  expect(nativeTypes(f)).toEqual(['list', 'beginLogin', 'capture']);
  expect(f.h.state).toEqual(f.h.before);
});
it.each([
  'withdraw access',
  'navigate to a withheld site',
])('disables the armed button and refuses any cookie request after %s', async (change) => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  expect(f.button('review').disabled).toBe(false);
  f.h.native.mockClear();
  if (change === 'withdraw access') {
    f.h.state.origins.shift();
    f.h.browser.permissions.onRemoved.emit({ origins: [`${site}:443/*`] });
  } else {
    f.h.browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://withheld.test/account', incognito: false },
    ]);
    f.h.browser.tabs.onUpdated.emit(7, { url: 'https://withheld.test/account' });
  }
  expect(f.button('review').disabled).toBe(true);
  // Even a programmatically dispatched click must consult the worker snapshot.
  f.button('review').dispatchEvent(new MouseEvent('click'));
  await phase(f.p, 'failed');
  expect(f.button('review').disabled).toBe(true);
  await vi.waitFor(() => expect(f.text()).toContain("Chrome's extension menu"));
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.h.browser.permissions.remove).not.toHaveBeenCalled();
});
it.each([
  'tab activation',
  'URL change',
  'window focus',
  'permission removal',
  'permission addition',
])('requires a fresh Review after %s invalidates the armed state', async (change) => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  const oldLease = f.p.view.lease;
  if (change === 'tab activation') f.h.browser.tabs.onActivated.emit({ tabId: 7, windowId: 1 });
  if (change === 'URL change') f.h.browser.tabs.onUpdated.emit(7, { url: `${site}/new` });
  if (change === 'window focus') f.h.browser.windows.onFocusChanged.emit(2);
  if (change === 'permission removal')
    f.h.browser.permissions.onRemoved.emit({ origins: ['https://other.test:443/*'] });
  if (change === 'permission addition')
    f.h.browser.permissions.onAdded.emit({ origins: ['https://other.test:443/*'] });
  expect(f.button('review').disabled).toBe(true);
  f.button('review').dispatchEvent(new MouseEvent('click'));
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  await f.choose();
  expect(f.button('review').textContent).toBe('Review sign-in sharing');
  f.button('review').click();
  await phase(f.p, 'permission');
  expect(f.p.view.lease).not.toBe(oldLease);
  expect(f.p.view.armedLease).toBe(f.p.view.lease);
  f.button('cancel').click();
});
it('keeps the armed lease on unrelated tab updates', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  f.h.browser.tabs.onUpdated.emit(8, { url: 'https://withheld.test' });
  f.h.browser.tabs.onUpdated.emit(7, {});
  expect(f.button('review').disabled).toBe(false);
  f.button('review').click();
  await phase(f.p, 'confirming');
  f.button('cancel').click();
});
it.each([
  'missing',
  'different lease',
])('refuses a permission view whose validated armed lease is %s', async (kind) => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  f.p.client.onMessage.emit({
    ...f.p.view,
    armedLease: kind === 'missing' ? undefined : f.p.view.lease! + 1,
  });
  expect(f.button('review').disabled).toBe(true);
  f.button('review').dispatchEvent(new MouseEvent('click'));
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  f.button('cancel').click();
});
it('refuses acquisition when an invalidation push arrives during the click before the request', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  const send = f.p.client.postMessage.getMockImplementation()!;
  f.p.client.postMessage.mockImplementationOnce((intent) => {
    send(intent);
    f.h.state.origins.shift();
    f.h.browser.permissions.onRemoved.emit({ origins: [`${site}:443/*`] });
  });
  f.h.native.mockClear();
  f.button('review').click();
  await phase(f.p, 'failed');
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined(),
  );
});
it.each([
  'withdraw access',
  'navigate to a withheld site',
])('removes a grant when %s arrives during the click, before any cookie read or native message', async (change) => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  f.h.native.mockClear();
  f.h.browser.permissions.request.mockImplementationOnce(async () => {
    if (change === 'withdraw access') {
      f.h.state.origins.shift();
      f.h.browser.permissions.onRemoved.emit({ origins: [`${site}:443/*`] });
    } else {
      f.h.browser.tabs.query.mockResolvedValue([
        { id: 7, url: 'https://withheld.test/account', incognito: false },
      ]);
      f.h.browser.tabs.onUpdated.emit(7, { url: 'https://withheld.test/account' });
    }
    f.h.state.cookies = true;
    f.h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    return true;
  });
  f.button('review').click();
  expect(f.h.browser.permissions.request).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(f.h.state.cookies).toBe(false));
  await vi.waitFor(() =>
    expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined(),
  );
  expect(f.h.browser.permissions.remove).toHaveBeenCalled();
  const checks = f.h.browser.permissions.contains.mock.calls.flatMap(([input], index) =>
    input.permissions ? [f.h.browser.permissions.contains.mock.invocationCallOrder[index]] : [],
  );
  expect(checks.at(-1)).toBeGreaterThan(
    f.h.browser.permissions.remove.mock.invocationCallOrder.at(-1)!,
  );
  expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('confirm').disabled).toBe(true);
});
it('renders the recovery warning and keeps sharing blocked after restart removal fails', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    f.mount();
    await f.review();
    f.h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
    f.h.restart();
    const next = f.h.popup();
    mountAgentSignIn(f.root, next.browser);
    await phase(next, 'failed');
    expect(f.warning().hidden).toBe(false);
    expect(f.warning().textContent).toContain("Chrome's extension settings");
    expect(f.button('review').disabled).toBe(true);
    expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeDefined();
    expect(f.root.textContent).not.toContain('fixture-secret');
  } finally {
    vi.useRealTimers();
  }
});
it('cancel during cleanup stays terminal when permission removal completes', async () => {
  const f = fixture();
  f.mount();
  await f.review();
  const cleanup = deferred<boolean>();
  f.h.browser.permissions.remove.mockImplementationOnce(() => cleanup.promise);
  f.button('confirm').click();
  await phase(f.p, 'cleaning');
  f.button('cancel').click();
  expect(f.text()).toBe('Sharing cancelled.');
  f.h.state.cookies = false;
  cleanup.resolve(true);
  await vi.waitFor(() =>
    expect(f.h.browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] }),
  );
  expect(f.text()).toBe('Sharing cancelled.');
  expect(f.button('confirm').disabled).toBe(true);
  expect(f.root.querySelector<HTMLElement>('#agent-preview')!.hidden).toBe(true);
  expect(f.h.state).toEqual(f.h.before);
});
it.each([
  'beginLogin',
  'sending',
])('cancellation ignores late %s completions and cannot resurrect confirmation', async (stage) => {
  const f = fixture();
  f.mount();
  await f.choose();
  const reply = deferred<Awaited<ReturnType<typeof f.h.native>>>();
  f.button('review').click();
  await phase(f.p, 'permission');
  if (stage === 'beginLogin') f.h.native.mockImplementationOnce(() => reply.promise);
  f.button('review').click();
  if (stage === 'sending') {
    await phase(f.p, 'confirming');
    f.h.native.mockImplementationOnce(() => reply.promise);
    f.button('confirm').click();
    await phase(f.p, 'sending');
  } else await vi.waitFor(() => expect(nativeTypes(f)).toContain('beginLogin'), { timeout: 2500 });
  f.button('cancel').click();
  expect(f.text()).toBe('Sharing cancelled.');
  reply.resolve(
    stage === 'beginLogin'
      ? { type: 'beginLogin', token: '00000000-0000-4000-8000-000000000001' }
      : { type: 'capture' },
  );
  await vi.waitFor(() => expect(f.h.state.cookies).toBe(false));
  expect(f.text()).toBe('Sharing cancelled.');
  expect(f.button('confirm').disabled).toBe(true);
});
it('renders a second popup rejection without requesting permission or contacting the native host', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  const other = f.h.popup();
  other.load();
  await phase(other, 'ready');
  other.start();
  await phase(other, 'permission');
  f.h.native.mockClear();
  f.button('review').click();
  await phase(f.p, 'busy');
  expect(f.text()).toMatch(/another sharing is in progress/i);
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  other.cancel();
});
it('shows finishing the previous sharing while cancelled cleanup retains the lease', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  const other = f.h.popup();
  other.load();
  await phase(other, 'ready');
  other.start();
  await phase(other, 'permission');
  await other.allow();
  await phase(other, 'confirming');
  const cleanup = deferred<boolean>();
  f.h.browser.permissions.remove.mockImplementationOnce(async () => {
    await cleanup.promise;
    f.h.state.cookies = false;
    return true;
  });
  other.confirm();
  await vi.waitFor(() => expect(f.h.browser.permissions.remove).toHaveBeenCalledTimes(1));
  other.cancel();
  f.button('review').click();
  expect(f.text()).toBe('Finishing the previous sharing.');
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('confirm').disabled).toBe(true);
  expect(f.h.browser.permissions.request).toHaveBeenCalledTimes(1);
  cleanup.resolve(true);
  f.p.load();
  await f.choose();
  await f.review();
  f.button('confirm').click();
  await phase(f.p, 'shared');
  expect(f.h.state).toEqual(f.h.before);
});
it('shows cleanup in progress and enables sharing only after automatic removal verifies absence', async () => {
  const f = fixture();
  f.h.state.cookies = true;
  const absent = deferred<boolean>();
  f.h.browser.permissions.remove.mockImplementationOnce(async () => {
    f.h.state.cookies = false;
    f.h.browser.permissions.contains.mockImplementationOnce(() => absent.promise);
    return true;
  });
  f.mount();
  await vi.waitFor(() => expect(f.h.browser.permissions.remove).toHaveBeenCalledTimes(1));
  expect(f.warning().hidden).toBe(false);
  expect(f.warning().textContent).toContain('Cleaning up a previous sharing');
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('remove-cookie-access').disabled).toBe(true);
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBe(true);
  expect(f.h.native).not.toHaveBeenCalled();
  absent.resolve(false);
  await phase(f.p, 'ready');
  expect(f.warning().hidden).toBe(true);
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  await f.review();
  f.button('confirm').click();
  await phase(f.p, 'shared');
  expect(f.h.state).toEqual(f.h.before);
});
it.each([
  'valid',
  'withheld',
  'invalid',
  'host check rejects',
  'cookie check rejects',
])('keeps automatic removal failure warning and button on every popup load: %s', async (kind) => {
  const f = fixture();
  f.h.state.cookies = true;
  f.h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  if (kind === 'withheld') f.h.state.origins.shift();
  if (kind === 'invalid')
    f.h.browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'chrome://settings', incognito: false },
    ]);
  if (kind === 'host check rejects') {
    const contains = f.h.browser.permissions.contains.getMockImplementation()!;
    f.h.browser.permissions.contains.mockImplementation(async (input) => {
      if (input.origins) throw new Error('fixture-secret');
      return contains(input);
    });
  }
  if (kind === 'cookie check rejects')
    f.h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  f.mount();
  await phase(f.p, 'failed');
  expect(f.warning().hidden).toBe(false);
  expect(f.warning().textContent).toContain("Chrome's extension settings");
  expect(f.button('remove-cookie-access').disabled).toBe(false);
  expect(f.button('remove-cookie-access').textContent).toBe('Remove cookie access');
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('confirm').disabled).toBe(true);
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  expect(f.h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBe(true);
  expect(f.root.textContent).not.toContain('fixture-secret');
  if (kind === 'withheld') expect(f.text()).toContain("Chrome's extension menu");
});
it.each([
  'rejects',
  'still present',
  'verification rejects',
])('keeps automatic removal failure visible until the Remove cookie access retry succeeds: %s', async (failure) => {
  const f = fixture();
  f.h.state.cookies = true;
  if (failure === 'rejects')
    f.h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  if (failure === 'still present') f.h.browser.permissions.remove.mockResolvedValueOnce(false);
  if (failure === 'verification rejects')
    f.h.browser.permissions.remove.mockImplementationOnce(async () => {
      f.h.state.cookies = false;
      f.h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
      return true;
    });
  f.mount();
  await phase(f.p, 'failed');
  expect(f.warning().hidden).toBe(false);
  expect(f.warning().textContent).toContain("Chrome's extension settings");
  expect(f.button('remove-cookie-access').disabled).toBe(false);
  expect(f.button('review').disabled).toBe(true);
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.root.textContent).not.toContain('fixture-secret');
  f.button('remove-cookie-access').click();
  await phase(f.p, 'ready');
  expect(f.warning().hidden).toBe(true);
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  expect(f.h.state).toEqual(f.h.before);
});
it.each([
  'shared',
  'failed',
  'cancelled',
] as const)('keeps cleanup warning alongside terminal %s outcome', async (outcome) => {
  const f = fixture();
  f.mount();
  await f.review();
  f.h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  if (outcome === 'failed') f.h.native.mockRejectedValueOnce(new Error('fixture-secret'));
  f.button(outcome === 'cancelled' ? 'cancel' : 'confirm').click();
  await phase(f.p, outcome);
  await vi.waitFor(() => expect(f.warning().hidden).toBe(false));
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('confirm').disabled).toBe(true);
  expect(f.root.textContent).not.toContain('fixture-secret');
});
it('ignores delayed worker progress after terminal worker state', async () => {
  const f = fixture();
  f.mount();
  await f.review();
  f.button('confirm').click();
  await phase(f.p, 'shared');
  f.p.client.onMessage.emit({ ...f.p.view, phase: 'confirming', message: 'old completion' });
  expect(f.text()).toBe('Sign-in shared.');
  expect(f.button('confirm').disabled).toBe(true);
});
it('disconnect reports failure and cannot request from a stale permission view', async () => {
  const f = fixture();
  f.mount();
  await f.choose();
  f.button('review').click();
  await phase(f.p, 'permission');
  f.p.client.disconnect();
  expect(f.text()).toContain('Sharing disconnected');
  f.button('review').click();
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
});

it.each([
  'live worker',
  'replacement worker',
])('refuses an expired armed click and removes unexpected grants with a %s', async (kind) => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    f.mount();
    await f.choose();
    f.button('review').click();
    await phase(f.p, 'permission');
    const lease = f.p.view.lease;
    const push = f.p.worker.postMessage.getMockImplementation()!;
    // Hold the disarm notification in transit; the popup still has its old armed view.
    f.p.worker.postMessage.mockImplementation((view) => {
      if (view.lease !== lease || view.phase === 'permission') push(view);
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.button('review').disabled).toBe(true);
    expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
    f.h.native.mockClear();
    const interrupted = deferred<boolean>();
    if (kind === 'replacement worker')
      f.h.browser.permissions.contains.mockImplementationOnce(() => interrupted.promise);
    f.button('review').dispatchEvent(new MouseEvent('click'));
    expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
    f.h.state.cookies = true;
    f.h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    if (kind === 'replacement worker') {
      // Stop the old worker before its absence verification returns. Its promises
      // remain unresolved, modelling discarded worker tasks rather than onDisconnect.
      await vi.advanceTimersByTimeAsync(0);
      expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBe(true);
      f.h.restart();
      const next = f.h.popup();
      mountAgentSignIn(f.root, next.browser);
      await phase(next, 'ready');
    }
    await vi.waitFor(() => expect(f.h.state.cookies).toBe(false));
    expect(f.h.browser.permissions.remove).toHaveBeenCalledTimes(1);
    expect(f.h.browser.permissions.contains).toHaveBeenLastCalledWith(
      kind === 'replacement worker' ? { origins: [`${site}:443/*`] } : { permissions: ['cookies'] },
    );
    expect(f.h.browser.cookies.getAll).not.toHaveBeenCalled();
    expect(nativeTypes(f)).not.toContain('beginLogin');
    expect(nativeTypes(f)).not.toContain('capture');
    expect(f.h.state).toEqual(f.h.before);
  } finally {
    vi.useRealTimers();
  }
});

it('restores the local cleanup notice while the replacement worker is still checking permission', async () => {
  const checked = deferred<boolean>();
  const f = fixture({ cookies: true, cleanup: true, contains: checked.promise });
  f.mount();
  await vi.waitFor(() => expect(f.warning().hidden).toBe(false));
  expect(f.warning().textContent).toContain('Cleaning up a previous sharing');
  expect(f.button('review').disabled).toBe(true);
  expect(f.h.browser.permissions.remove).not.toHaveBeenCalled();
  checked.resolve(true);
  await phase(f.p, 'ready');
  expect(f.h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(f.warning().hidden).toBe(true);
  expect(f.h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
});
