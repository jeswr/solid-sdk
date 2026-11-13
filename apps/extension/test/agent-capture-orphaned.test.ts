// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
import { captureHarness, deferred, phase, reviewing } from './agent-capture-fixture';

afterEach(() => vi.useRealTimers());

async function prompt() {
  const h = captureHarness();
  const a = await reviewing(h);
  const result = deferred<boolean>();
  h.browser.permissions.request.mockImplementationOnce(() => result.promise);
  const allowed = a.allow();
  await phase(a, 'prompt');
  h.native.mockClear();
  return { h, a, result, allowed };
}

it.each([
  1, 30, 59, 61,
])('revokes a grant %s seconds after popup disconnect without its settlement report', async (seconds) => {
  vi.useFakeTimers();
  const { h, a, result, allowed } = await prompt();
  const disconnectedAt = Date.now();
  a.client.disconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(h.state.cookies).toBe(false);
  expect(h.browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });

  await vi.advanceTimersByTimeAsync(seconds * 1000);
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  result.resolve(true);
  await allowed; // Closed ports cannot deliver this report.
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state).toEqual(h.before);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(seconds < 60 ? 2 : 3);
  if (seconds < 60) await vi.advanceTimersByTimeAsync(disconnectedAt + 60000 - Date.now());
  expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
  expect(h.browser.permissions.request.mock.calls).toEqual([[{ permissions: ['cookies'] }]]);
  expect(h.browser.permissions.remove.mock.calls.every(([p]) => !p.origins)).toBe(true);
});

it('fences a second popup for sixty seconds, then permits sharing without the lost report', async () => {
  vi.useFakeTimers();
  const { h, a } = await prompt();
  a.client.disconnect();
  const disconnectedAt = Date.now();
  const b = h.popup();
  b.load();
  b.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.phase).toBe('busy');
  expect(b.view.message).toBe('Finishing the previous sharing.');
  await vi.advanceTimersByTimeAsync(59999);
  b.start();
  expect(b.view.phase).toBe('busy');
  expect(h.native).not.toHaveBeenCalled();
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(disconnectedAt + 60000 - Date.now());
  await phase(b, 'ready');
  b.start();
  await phase(b, 'permission');
  await b.allow();
  await phase(b, 'confirming');
  b.confirm();
  await phase(b, 'shared');
  expect(h.state).toEqual(h.before);
});

it('abandons an unsettled prompt on lease timeout and ignores reports after the fence ends', async () => {
  vi.useFakeTimers();
  const { h, result, allowed } = await prompt();
  const b = h.popup();
  await vi.advanceTimersByTimeAsync(120000);
  const timedOutAt = Date.now();
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(b.view.message).toBe('Finishing the previous sharing.');
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(false);
  await vi.advanceTimersByTimeAsync(timedOutAt + 60000 - Date.now());
  b.load();
  await phase(b, 'ready');
  b.start();
  await phase(b, 'permission');
  await b.allow();
  await phase(b, 'confirming');
  const removals = h.browser.permissions.remove.mock.calls.length;
  const messages = h.native.mock.calls.length;
  result.resolve(true);
  await allowed;
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.phase).toBe('confirming');
  expect(h.state.cookies).toBe(true);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals);
  expect(h.native).toHaveBeenCalledTimes(messages);
  b.confirm();
  await phase(b, 'shared');
});

it('revokes onAdded immediately while an orphan removal is still holding the mutex', async () => {
  vi.useFakeTimers();
  const { h, a } = await prompt();
  const removal = deferred<boolean>();
  h.browser.permissions.remove.mockImplementationOnce(() => removal.promise);
  a.client.disconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2);
  expect(h.state.cookies).toBe(false);
  removal.resolve(true);
  await vi.advanceTimersByTimeAsync(60000);
  const b = h.popup();
  b.load();
  await phase(b, 'ready');
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native.mock.calls.map(([r]) => r.type)).toEqual(['list']);
});

it('removes the grant in the ten-minute reproduction without replacing the worker', async () => {
  vi.useFakeTimers();
  const { h, a } = await prompt();
  a.client.disconnect();
  await vi.advanceTimersByTimeAsync(30000);
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(false);
  await vi.advanceTimersByTimeAsync(570000);
  expect(h.state).toEqual(h.before);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
  const b = h.popup();
  b.load();
  await phase(b, 'ready');
});

it.each([
  'cancel',
  'authorization invalidation',
])('still times out a lost settlement while %s cleanup is waiting', async (exit) => {
  vi.useFakeTimers();
  const { h, a } = await prompt();
  if (exit === 'cancel') a.cancel();
  else h.browser.windows.onFocusChanged.emit(8);
  await vi.advanceTimersByTimeAsync(0);
  const b = h.popup();
  b.load();
  expect(b.view.message).toBe('Finishing the previous sharing.');
  await vi.advanceTimersByTimeAsync(120000);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(false);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  await phase(b, 'ready');
});

it('joins orphan revocation still in flight after the settle window before a newer lease can acquire', async () => {
  vi.useFakeTimers();
  const { h, a } = await prompt();
  a.client.disconnect();
  await vi.advanceTimersByTimeAsync(59000);
  const removal = deferred<boolean>();
  const remove = h.browser.permissions.remove.getMockImplementation()!;
  h.browser.permissions.remove.mockImplementationOnce(async (input) => {
    await removal.promise;
    return remove(input);
  });
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  const b = h.popup();
  b.load();
  await vi.advanceTimersByTimeAsync(2000);
  b.start();
  expect(b.view.message).toBe('Finishing the previous sharing.');
  expect(h.native).not.toHaveBeenCalled();
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  removal.resolve(true);
  await phase(b, 'ready');
  b.start();
  await phase(b, 'permission');
  await b.allow();
  await phase(b, 'confirming');
  const removals = h.browser.permissions.remove.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(true);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals);
  b.confirm();
  await phase(b, 'shared');
  expect(h.state).toEqual(h.before);
});

it.each([
  'disconnect',
  'timeout',
])('refuses an old armed click without creating another abandonment fence: %s', async (exit) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = await reviewing(h);
  a.cancel();
  await vi.advanceTimersByTimeAsync(0);
  const b = await reviewing(h);
  await b.allow();
  await phase(b, 'confirming');
  await a.allow();
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
  h.native.mockClear();
  h.browser.cookies.getAll.mockClear();
  if (exit === 'disconnect') a.client.disconnect();
  else await vi.advanceTimersByTimeAsync(120000);
  await vi.advanceTimersByTimeAsync(30000);
  if (exit === 'disconnect') {
    expect(b.view.phase).toBe('confirming');
    b.cancel();
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(false);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native.mock.calls.every(([request]) => request.type === 'list')).toBe(true);
  const c = h.popup();
  c.load();
  await phase(c, 'ready');
});
