// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';
import { captureHarness, deferred, type Harness, phase } from './agent-capture-fixture';

const html = readFileSync(`${import.meta.dirname}/../src/popup/popup.html`, 'utf8');
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function popup(h: Harness) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.querySelector<HTMLElement>('#agent-sign-in')!;
  document.body.append(root);
  const port = h.popup();
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#agent-${id}`)!;
  const text = () => root.querySelector('#agent-sign-in-status')!.textContent;
  mountAgentSignIn(root, port.browser);
  const arm = async () => {
    await phase(port, 'ready');
    const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
    persona.value = 'alex';
    persona.dispatchEvent(new Event('change'));
    button('review').click();
    await phase(port, 'permission');
  };
  const prompt = async () => {
    await arm();
    const result = deferred<boolean>();
    h.browser.permissions.request.mockImplementationOnce(() => result.promise);
    button('review').click();
    await phase(port, 'prompt');
    return result;
  };
  const share = async () => {
    await arm();
    button('review').click();
    await phase(port, 'confirming');
    button('confirm').click();
    await phase(port, 'shared');
    expect(h.state).toEqual(h.before);
  };
  return { port, root, button, text, arm, prompt, share };
}

it('admits sharing after the round-9 expired A click, B abandonment and both windows expire', async () => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = popup(h);
  await a.arm();
  const lease = a.port.view.lease!;
  // A keeps its armed view while worker expiry/disarm messages are in transit.
  a.port.worker.postMessage.mockImplementation(() => {});
  await vi.advanceTimersByTimeAsync(120000);
  expect(a.button('review').disabled).toBe(true);
  const b = popup(h);
  const pending = await b.prompt();
  h.native.mockClear();
  const removals = h.browser.permissions.remove.mock.calls.length;
  a.button('review').dispatchEvent(new MouseEvent('click'));
  // Also deliver an intent already queued by the old popup, exercising worker ingress.
  a.port.send({ type: 'requesting', lease });
  a.port.client.disconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(b.port.view.phase).toBe('failed');
  expect(b.text()).toBe('Another sharing started. Try again.');
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals + 1);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();

  // B times out too; its prompt promise never needs to report for cleanup to finish.
  await vi.advanceTimersByTimeAsync(600000);
  expect(h.state).toEqual(h.before);
  expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  const c = popup(h);
  await c.share();
  pending.resolve(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state).toEqual(h.before);
});

it('contests another popup click while B’s prompt is unsettled', async () => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = popup(h);
  await a.arm();
  const push = a.port.worker.postMessage.getMockImplementation()!;
  a.port.worker.postMessage.mockImplementation(() => {});
  // Worker cancellation completes before its push reaches A, whose local deadline is live.
  a.port.cancel();
  await vi.advanceTimersByTimeAsync(0);
  const b = popup(h);
  const result = await b.prompt();
  a.port.worker.postMessage.mockImplementation(push);
  const requests = h.browser.permissions.request.mock.calls.length;
  const removals = h.browser.permissions.remove.mock.calls.length;
  a.button('review').click();
  expect(a.text()).toBe('Another sharing started. Try again.');
  expect(b.port.view.phase).toBe('failed');
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(requests);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals);
  a.port.client.disconnect();
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  result.resolve(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(h.browser.permissions.remove.mock.calls.length).toBeGreaterThan(removals);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native.mock.calls.every(([request]) => request.type === 'list')).toBe(true);
  expect(h.state).toEqual(h.before);
  const c = popup(h);
  await c.share();
});

it.each([
  'ABC',
  'ACB',
  'BAC',
  'BCA',
  'CAB',
  'CBA',
])('drains overlapping abandoned A/B/C prompts with late completions in order %s', async (order) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const prompts = new Map<string, Awaited<ReturnType<ReturnType<typeof popup>['prompt']>>>();
  for (const id of 'ABC') {
    const owner = popup(h);
    prompts.set(id, await owner.prompt());
    owner.port.client.disconnect();
    const waiting = popup(h);
    await vi.advanceTimersByTimeAsync(59999);
    expect(waiting.text()).toBe('Finishing the previous sharing.');
    expect(waiting.button('review').disabled).toBe(true);
    expect(h.browser.permissions.request).toHaveBeenCalledTimes(prompts.size);
    await vi.advanceTimersByTimeAsync(1);
    await phase(waiting.port, 'ready');
    waiting.port.client.disconnect();
  }
  h.native.mockClear();
  for (const id of order) {
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    prompts.get(id)!.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state).toEqual(h.before);
    expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  }
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(9);
  const next = popup(h);
  await next.share();
});

it.each([
  'ABC',
  'ACB',
  'BAC',
  'BCA',
  'CAB',
  'CBA',
])('joins overlapping revocations in completion order %s before admitting another click', async (order) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = popup(h);
  await a.prompt();
  h.native.mockClear();
  a.port.client.disconnect();
  await vi.advanceTimersByTimeAsync(59000);
  const removals = new Map<string, ReturnType<typeof deferred<boolean>>>();
  const remove = h.browser.permissions.remove.getMockImplementation()!;
  for (const id of 'ABC') {
    const done = deferred<boolean>();
    removals.set(id, done);
    h.browser.permissions.remove.mockImplementationOnce(async (input) => {
      await done.promise;
      return remove(input);
    });
  }
  for (const _id of 'ABC') {
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  }
  const b = popup(h);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(4);
  for (const [index, id] of [...order].entries()) {
    removals.get(id)!.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    if (index < 2) {
      expect(b.text()).toBe('Finishing the previous sharing.');
      expect(b.button('review').disabled).toBe(true);
      expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
      expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
      expect(h.native).not.toHaveBeenCalled();
    }
  }
  await phase(b.port, 'ready');
  expect(h.state).toEqual(h.before);
  expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  await b.share();
});

it('reverifies a grant whose failed revocation finishes during the final absence check', async () => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = popup(h);
  await a.prompt();
  a.port.client.disconnect();
  await vi.advanceTimersByTimeAsync(59000);
  const absent = deferred<boolean>();
  h.browser.permissions.contains.mockImplementationOnce(() => absent.promise);
  await vi.advanceTimersByTimeAsync(1000);
  h.state.cookies = true;
  h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(3);
  expect(h.state.cookies).toBe(true);
  absent.resolve(false); // This earlier observation was invalidated by the late grant.
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state).toEqual(h.before);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(4);
  expect(h.browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
  const b = popup(h);
  await b.share();
});

it.each([
  'remove rejects',
  'absence verification rejects',
])('bounds a failed fence with the removal warning and button: %s', async (failure) => {
  vi.useFakeTimers();
  const h = captureHarness();
  const a = popup(h);
  await a.prompt();
  const contains = h.browser.permissions.contains.getMockImplementation()!;
  if (failure === 'remove rejects') {
    h.state.cookies = true;
    h.browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  } else {
    h.browser.permissions.contains.mockImplementation(async (input) => {
      if (input.permissions) throw new Error('fixture-secret');
      return contains(input);
    });
  }
  a.port.client.disconnect();
  const b = popup(h);
  await vi.advanceTimersByTimeAsync(600000);
  expect(b.text()).toBe('Remove cookie access before sharing a sign-in.');
  expect(b.root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(false);
  expect(b.button('remove-cookie-access').disabled).toBe(false);
  expect(b.button('review').disabled).toBe(true);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(2);
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(1);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  expect(b.root.textContent).not.toContain('fixture-secret');
  h.browser.permissions.contains.mockImplementation(contains);
  h.browser.permissions.remove.mockImplementation(async () => {
    h.state.cookies = false;
    return true;
  });
  b.button('remove-cookie-access').click();
  await phase(b.port, 'ready');
  await b.share();
});
