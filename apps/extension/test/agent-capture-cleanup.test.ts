// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
import {
  captureHarness,
  confirming,
  deferred,
  type Harness,
  phase,
  reviewing,
} from './agent-capture-fixture';

afterEach(() => vi.useRealTimers());

function verified(h: Harness) {
  expect(h.state).toEqual(h.before);
  const checks = h.browser.permissions.contains.mock.calls.flatMap(([input], index) =>
    input.permissions ? [h.browser.permissions.contains.mock.invocationCallOrder[index]] : [],
  );
  expect(checks.at(-1)).toBeGreaterThan(
    h.browser.permissions.remove.mock.invocationCallOrder.at(-1)!,
  );
  expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
}

it.each([
  'late removal',
  'late removal fails once then B times out',
])('keeps cancelled A cleanup inside its lease: %s', async (variant) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = h.popup();
  const b = h.popup();
  a.load();
  b.load();
  await phase(a, 'ready');
  await phase(b, 'ready');
  const marker = deferred<void>();
  const set = h.browser.storage.local.set.getMockImplementation()!;
  h.browser.storage.local.set.mockImplementationOnce(async (values) => {
    await marker.promise;
    await set(values);
  });
  // The review cannot establish absence, so it must remove authority before arming.
  h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  if (variant !== 'late removal')
    h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  a.start();
  await vi.waitFor(() => expect(h.browser.storage.local.set).toHaveBeenCalledTimes(1));
  a.cancel();
  b.start();
  b.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.phase).toBe('busy');
  expect(b.view.message).toBe('Finishing the previous sharing.');
  expect(h.browser.permissions.request).not.toHaveBeenCalled();
  expect(h.browser.permissions.remove).not.toHaveBeenCalled();

  marker.resolve();
  await vi.advanceTimersByTimeAsync(0);
  if (b.view.warning) b.send({ type: 'removeCookieAccess' });
  else b.load();
  await phase(b, 'ready');
  b.start();
  await phase(b, 'permission');
  await b.allow();
  await phase(b, 'confirming');
  const removals = h.browser.permissions.remove.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.cookies).toBe(true);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals);
  expect(a.view.phase).toBe('cancelled');
  expect(b.view.warning).toBe(false);
  if (variant === 'late removal') {
    b.confirm();
    await phase(b, 'shared');
  } else {
    await vi.advanceTimersByTimeAsync(120000);
    expect(b.view.phase).toBe('cancelled');
  }
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals + 1);
  verified(h);
});

it('settles a delayed armed request arriving during cleanup before releasing its lease', async () => {
  vi.useFakeTimers();
  const h = captureHarness();
  const b = h.popup();
  b.load();
  await phase(b, 'ready');
  const a = await reviewing(h);
  const clear = deferred<void>();
  const prompt = deferred<boolean>();
  h.browser.storage.local.remove.mockImplementationOnce(() => clear.promise);
  h.browser.permissions.request.mockImplementationOnce(() => prompt.promise);
  const clears = h.browser.storage.local.remove.mock.calls.length;
  a.cancel();
  await vi.waitFor(() => expect(h.browser.storage.local.remove).toHaveBeenCalledTimes(clears + 1));
  // The armed click was already in transit when Cancel reached the worker.
  const allowed = a.allow();
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  clear.resolve();
  b.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.phase).toBe('busy');
  expect(b.view.message).toBe('Finishing the previous sharing.');
  expect(h.browser.permissions.remove).not.toHaveBeenCalled();
  prompt.resolve(true);
  await allowed;
  await phase(b, 'ready');
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  verified(h);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native.mock.calls.map(([r]) => r.type)).not.toContain('beginLogin');
});

it.each([
  'beginLogin',
  'capture',
])('cancel during native %s retains the mutex until dispatch settles and cleanup completes', async (stage) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const b = h.popup();
  b.load();
  await phase(b, 'ready');
  const a = stage === 'beginLogin' ? await reviewing(h) : await confirming(h);
  const reply = deferred<Awaited<ReturnType<typeof h.native>>>();
  h.native.mockImplementationOnce(() => reply.promise);
  if (stage === 'beginLogin') await a.allow();
  else a.confirm();
  await vi.waitFor(() => expect(h.native.mock.calls.at(-1)![0].type).toBe(stage));
  a.cancel();
  b.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.message).toBe('Finishing the previous sharing.');
  expect(h.browser.permissions.remove).not.toHaveBeenCalled();
  reply.resolve(
    stage === 'beginLogin'
      ? { type: 'beginLogin', token: '00000000-0000-4000-8000-000000000001' }
      : { type: 'capture' },
  );
  await phase(b, 'ready');
  expect(a.view.phase).toBe('cancelled');
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  verified(h);
});

it.each([
  ['review', 'marker write'],
  ['review', 'permission removal'],
  ['review', 'absence verification'],
  ['review', 'marker clear'],
  ['completion', 'marker write'],
  ['completion', 'permission removal'],
  ['completion', 'absence verification'],
  ['completion', 'marker clear'],
])('cancel during %s %s retains the lease and mutex until cleanup settles', async (stage, step) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const b = h.popup();
  b.load();
  await phase(b, 'ready');
  const a = stage === 'review' ? h.popup() : await confirming(h);
  if (stage === 'review') {
    a.load();
    await phase(a, 'ready');
    h.state.cookies = true;
  }
  const paused = deferred<void>();
  const entered = vi.fn();
  if (step === 'marker write') {
    const set = h.browser.storage.local.set.getMockImplementation()!;
    h.browser.storage.local.set.mockImplementationOnce(async (values) => {
      entered();
      await paused.promise;
      await set(values);
    });
  } else if (step === 'marker clear') {
    const clear = h.browser.storage.local.remove.getMockImplementation()!;
    h.browser.storage.local.remove.mockImplementationOnce(async (key) => {
      entered();
      await paused.promise;
      await clear(key);
    });
  } else {
    const remove = h.browser.permissions.remove.getMockImplementation()!;
    h.browser.permissions.remove.mockImplementationOnce(async (input) => {
      if (step === 'permission removal') {
        entered();
        await paused.promise;
      }
      const removed = await remove(input);
      if (step === 'absence verification')
        h.browser.permissions.contains.mockImplementationOnce(async () => {
          entered();
          await paused.promise;
          return false;
        });
      return removed;
    });
  }
  if (stage === 'review') a.start();
  else a.confirm();
  await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
  a.cancel();
  b.start();
  b.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(a.view.phase).toBe('cancelled');
  expect(b.view.phase).toBe('busy');
  expect(b.view.message).toBe('Finishing the previous sharing.');
  const c = h.popup();
  c.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(c.view.phase).toBe('busy');
  expect(c.view.message).toBe('Finishing the previous sharing.');
  const removals = h.browser.permissions.remove.mock.calls.length;
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(stage === 'review' ? 0 : 1);
  paused.resolve();
  await phase(b, 'ready');
  verified(h);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(
    step === 'marker write' ? removals + 1 : removals,
  );
  expect(a.view.phase).toBe('cancelled');
  await confirming(h, b);
  expect(h.state.cookies).toBe(true);
  b.confirm();
  await phase(b, 'shared');
  verified(h);
});

it.each([
  'grant',
  'denial',
  'rejection',
])('cancel during permission request settlement retains the lease until %s and verified cleanup', async (outcome) => {
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
  // onAdded can precede settlement of Chrome's request promise.
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  b.start();
  b.load();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.view.phase).toBe('busy');
  expect(b.view.message).toBe('Finishing the previous sharing.');
  expect(h.browser.permissions.remove).not.toHaveBeenCalled();
  expect(h.browser.storage.local.set).not.toHaveBeenCalled();
  if (outcome === 'rejection') prompt.reject(new Error('fixture-secret'));
  else prompt.resolve(outcome === 'grant');
  await allowed;
  await phase(b, 'ready');
  verified(h);
  expect(h.native.mock.calls.map(([r]) => r.type)).not.toContain('beginLogin');
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  await confirming(h, b);
  b.confirm();
  await phase(b, 'shared');
  verified(h);
});
