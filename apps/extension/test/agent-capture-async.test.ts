// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAPTURE_CLEANUP_KEY } from '../src/background/agent-capture-cleanup';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';
import { captureHarness, deferred, type Harness, phase } from './agent-capture-fixture';

const html = readFileSync(`${import.meta.dirname}/../src/popup/popup.html`, 'utf8');
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});
const turn = () => vi.advanceTimersByTimeAsync(10);
function popup(h: Harness) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.querySelector<HTMLElement>('#agent-sign-in')!;
  document.body.append(root);
  const port = h.popup();
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#agent-${id}`)!;
  const warning = () => root.querySelector<HTMLElement>('#agent-permission-warning')!;
  const text = () => root.querySelector('#agent-sign-in-status')!.textContent;
  mountAgentSignIn(root, port.browser);
  const arm = async () => {
    await phase(port, 'ready');
    const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
    persona.value = 'alex';
    persona.dispatchEvent(new Event('change'));
    button('review').click();
    await phase(port, 'permission');
    expect(button('review').disabled).toBe(false);
  };
  const prompt = async () => {
    await arm();
    const result = deferred<boolean>();
    h.browser.permissions.request.mockImplementationOnce(() => result.promise);
    button('review').click();
    await phase(port, 'prompt');
    return result;
  };
  return { port, button, warning, text, arm, prompt };
}
function noCapture(h: Harness) {
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  expect(h.native.mock.calls.every(([request]) => request.type === 'list')).toBe(true);
  expect(h.browser.permissions.request.mock.calls.every(([input]) => !input.origins)).toBe(true);
  expect(h.browser.permissions.remove.mock.calls.every(([input]) => !input.origins)).toBe(true);
  expect(h.state.origins).toEqual(h.before.origins);
}
function grant(h: Harness, result: ReturnType<typeof deferred<boolean>>) {
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  result.resolve(true);
}

it('revokes the round-10 delayed disarm overlap instead of taking A’s grant as B’s', async () => {
  const h = captureHarness(true);
  const a = popup(h);
  await a.arm();
  a.port.messages.hold('toPopup');
  h.browser.windows.onFocusChanged.emit(9);
  await turn();
  const b = popup(h);
  const bResult = await b.prompt();
  const aResult = deferred<boolean>();
  h.browser.permissions.request.mockImplementationOnce(() => aResult.promise);
  a.button('review').click();
  // Both requests execute inside their clicks before ANY worker rejection is delivered.
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(2);
  await phase(b.port, 'failed');
  expect(b.text()).toBe('Another sharing started. Try again.');
  grant(h, aResult);
  await turn();
  expect(h.state.cookies).toBe(false);
  grant(h, bResult);
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.state.cookies).toBe(false);
  noCapture(h);
  await vi.advanceTimersByTimeAsync(60000);
  const c = popup(h);
  await c.arm();
});

it.each([
  'before',
  'during',
  'after',
])('revokes a foreign requesting arriving %s B’s grant without reading or sending', async (when) => {
  const h = captureHarness(true);
  const b = popup(h);
  const result = await b.prompt();
  const foreign = popup(h);
  await turn();
  foreign.port.messages.hold('toWorker');
  foreign.port.send({ type: 'requesting', lease: 999 });
  const deliverForeign = async () => {
    const index = foreign.port.messages.pending.findIndex(
      (d) => 'type' in d.message && d.message.type === 'requesting',
    );
    foreign.port.messages.deliver(index);
    await turn();
  };
  if (when === 'before') await deliverForeign();
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  if (when === 'during') await deliverForeign();
  result.resolve(true);
  await turn();
  if (when === 'after') {
    await vi.advanceTimersByTimeAsync(800);
    expect(h.state.cookies).toBe(true);
    noCapture(h);
    await deliverForeign();
  }
  await vi.advanceTimersByTimeAsync(1000);
  expect(b.text()).toBe('Another sharing started. Try again.');
  expect(h.state.cookies).toBe(false);
  noCapture(h);
});

it('waits a full quiet second after the later of onAdded and request settlement', async () => {
  const h = captureHarness(true);
  const b = popup(h);
  const result = await b.prompt();
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(700);
  noCapture(h);
  result.resolve(true);
  await turn();
  const settledAt = Date.now();
  await vi.advanceTimersByTimeAsync(980);
  noCapture(h);
  // A later onAdded extends the quiet period again.
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await vi.advanceTimersByTimeAsync(999);
  noCapture(h);
  await phase(b.port, 'confirming');
  expect(Date.now() - settledAt).toBeGreaterThanOrEqual(1980);
  b.button('confirm').click();
  await phase(b.port, 'shared');
  expect(h.state).toEqual(h.before);
});

it.each([
  'no acknowledgement',
  'missing armed lease',
  'wrong armed lease',
])('disarms locally at the acknowledgement deadline with %s and ignores a reordered late arm', async (kind) => {
  const h = captureHarness(true);
  const a = popup(h);
  await phase(a.port, 'ready');
  const root = a.button('review').closest('#agent-sign-in')!;
  const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
  persona.value = 'alex';
  persona.dispatchEvent(new Event('change'));
  a.port.messages.hold(
    'toPopup',
    (message) => 'phase' in message && message.phase === 'permission',
  );
  a.button('review').click();
  await turn();
  const arm = a.port.messages.pending.find(
    (d) => 'phase' in d.message && d.message.phase === 'permission',
  )!;
  expect(arm).toBeDefined();
  if (kind !== 'no acknowledgement') {
    const view = arm.message;
    if (!('phase' in view)) throw new Error('Expected worker view');
    a.port.client.onMessage.emit({
      ...view,
      armedLease: kind === 'missing armed lease' ? undefined : 999,
    });
  }
  await vi.advanceTimersByTimeAsync(10000);
  expect(a.button('review').disabled).toBe(true);
  arm.deliver();
  a.button('review').dispatchEvent(new MouseEvent('click'));
  expect(h.browser.permissions.request).not.toHaveBeenCalled();
  expect(a.button('review').disabled).toBe(true);
  noCapture(h);
});

it.each([
  'orphan removal',
  'final verification',
  'ordinary cleanup',
])('bounds hung %s, enables recovery and releases admission after a successful button retry', async (stage) => {
  const h = captureHarness(true);
  const a = popup(h);
  const result = await a.prompt();
  const hung = deferred<boolean>();
  if (stage === 'ordinary cleanup') {
    grant(h, result);
    await phase(a.port, 'confirming');
    h.browser.permissions.remove.mockImplementation(() => hung.promise);
    a.button('cancel').click();
  } else {
    h.browser.permissions.remove.mockImplementation(() => hung.promise);
    a.port.client.disconnect();
  }
  const b = popup(h);
  await turn();
  if (stage === 'final verification') {
    // Initial removal times out. The final expiry check then hangs on contains.
    await vi.advanceTimersByTimeAsync(11000);
    h.browser.permissions.remove.mockImplementation(async () => {
      h.state.cookies = false;
      return true;
    });
    const contains = h.browser.permissions.contains.getMockImplementation()!;
    h.browser.permissions.contains.mockImplementation((input) =>
      input.permissions ? hung.promise : contains(input),
    );
    await vi.advanceTimersByTimeAsync(58000);
    // Another revocation near the final deadline must not hide recovery or
    // extend the sixty-second fence plus its one bounded attempt.
    h.state.cookies = true;
    h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
    await vi.advanceTimersByTimeAsync(1000);
    h.browser.permissions.contains.mockImplementation(contains);
  } else {
    await vi.advanceTimersByTimeAsync(11000);
    expect(b.warning().hidden).toBe(false);
    expect(b.button('remove-cookie-access').disabled).toBe(false);
    if (stage === 'orphan removal') await vi.advanceTimersByTimeAsync(60000);
  }
  expect(b.warning().hidden).toBe(false);
  expect(b.button('remove-cookie-access').disabled).toBe(false);
  expect(b.button('review').disabled).toBe(true);
  expect(h.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  h.browser.permissions.remove.mockImplementation(async () => {
    h.state.cookies = false;
    return true;
  });
  b.button('remove-cookie-access').click();
  await phase(b.port, 'ready');
  expect(b.warning().hidden).toBe(true);
  expect(h.browser.storage.local.data[CAPTURE_CLEANUP_KEY]).toBeUndefined();
  await b.arm();
  const calls = h.browser.permissions.contains.mock.calls.length;
  const pushes = b.port.states.length;
  hung.resolve(true); // The obsolete operation cannot verify, clear notices or release again.
  await turn();
  expect(h.browser.permissions.contains).toHaveBeenCalledTimes(calls);
  expect(b.port.states).toHaveLength(pushes);
  expect(b.port.view.phase).toBe('permission');
  if (stage !== 'ordinary cleanup') noCapture(h);
});

it('contests a second requesting for the admitted lease instead of accepting another acquisition', async () => {
  const h = captureHarness(true);
  const b = popup(h);
  const result = await b.prompt();
  b.port.send({ type: 'requesting', lease: b.port.view.lease! });
  await phase(b.port, 'failed');
  grant(h, result);
  await vi.advanceTimersByTimeAsync(1000);
  expect(b.text()).toBe('Another sharing started. Try again.');
  expect(h.state.cookies).toBe(false);
  noCapture(h);
});

it.each([
  'cookie read',
  'native dispatch',
])('rechecks a contest at the final awaited authorization boundary before %s', async (boundary) => {
  const h = captureHarness(true);
  const b = popup(h);
  const result = await b.prompt();
  const host = deferred<boolean>();
  const entered = vi.fn();
  const contains = h.browser.permissions.contains.getMockImplementation()!;
  const pauseFinalHostCheck = () => {
    let checks = 0;
    h.browser.permissions.contains.mockImplementation((input) => {
      if (input.origins && ++checks === 2) {
        entered();
        return host.promise;
      }
      return contains(input);
    });
  };
  if (boundary === 'cookie read') pauseFinalHostCheck();
  grant(h, result);
  if (boundary === 'native dispatch') {
    await phase(b.port, 'confirming');
    pauseFinalHostCheck();
    b.button('confirm').click();
  }
  await vi.waitFor(() => expect(entered).toHaveBeenCalled(), { timeout: 2500 });
  const reads = h.browser.cookies.getAll.mock.calls.length;
  const sends = h.native.mock.calls.length;
  const foreign = popup(h);
  foreign.port.send({ type: 'requesting', lease: 999 });
  await phase(b.port, 'failed');
  host.resolve(true);
  await turn();
  expect(h.browser.cookies.getAll).toHaveBeenCalledTimes(reads);
  expect(h.native).toHaveBeenCalledTimes(sends);
  expect(h.native.mock.calls.some(([request]) => request.type === 'capture')).toBe(false);
  if (boundary === 'cookie read') expect(reads).toBe(0);
  expect(h.state.cookies).toBe(false);
});

it('fences an unknown requesting received while idle so its later grant cannot belong to a new popup', async () => {
  const h = captureHarness(true);
  const a = popup(h);
  await phase(a.port, 'ready');
  a.port.send({ type: 'requesting', lease: 999 });
  await turn();
  const b = popup(h);
  await turn();
  expect(b.port.view.phase).toBe('busy');
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  await turn();
  expect(h.state.cookies).toBe(false);
  noCapture(h);
  await vi.advanceTimersByTimeAsync(60000);
  await b.arm();
});

it.each([
  'cancel',
  'focus change',
])('revokes immediately on %s while native setup is hung in the queue', async (exit) => {
  const h = captureHarness(true);
  const a = popup(h);
  await a.arm();
  const paused = stall(h.native);
  a.button('review').click();
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1), { timeout: 2500 });
  expect(h.state.cookies).toBe(true);
  if (exit === 'cancel') a.button('cancel').click();
  else h.browser.windows.onFocusChanged.emit(2);
  await turn();
  expect(h.state.cookies).toBe(false);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
  const b = popup(h);
  await vi.advanceTimersByTimeAsync(10000);
  await b.arm();
  expect(h.native.mock.calls.some(([request]) => request.type === 'capture')).toBe(false);
});

it.each([
  1, 30, 59,
])('extends an existing fence for a foreign request at %s seconds (round-11 grant adoption)', async (seconds) => {
  const h = captureHarness(true);
  const a = popup(h);
  await a.arm();
  a.port.messages.hold('toPopup');
  h.browser.windows.onFocusChanged.emit(9);
  await turn();
  const b = popup(h);
  await b.prompt();
  const abandonedAt = Date.now();
  b.port.client.disconnect();
  h.native.mockClear();
  await vi.advanceTimersByTimeAsync(seconds * 1000);
  const result = deferred<boolean>();
  h.browser.permissions.request.mockImplementationOnce(() => result.promise);
  a.port.messages.hold('toWorker');
  a.button('review').click();
  expect(h.browser.permissions.request).toHaveBeenCalledTimes(2);
  const foreign = a.port.messages.pending.find(
    (d) => 'type' in d.message && d.message.type === 'requesting',
  )!;
  const observedAt = Date.now();
  foreign.deliver();
  const c = popup(h);
  await vi.advanceTimersByTimeAsync(abandonedAt + 60001 - Date.now());
  expect(c.port.view.phase).toBe('busy');
  expect(c.button('review').disabled).toBe(true);
  grant(h, result);
  await turn();
  expect(h.state.cookies).toBe(false);
  expect(h.native).not.toHaveBeenCalled();
  noCapture(h);
  await vi.advanceTimersByTimeAsync(observedAt + 59999 - Date.now());
  expect(c.port.view.phase).toBe('busy');
  expect(c.button('review').disabled).toBe(true);
  expect(h.native).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await c.arm();
  expect(h.state.cookies).toBe(false);
  expect(h.browser.cookies.getAll).not.toHaveBeenCalled();
});

function stall<Args extends unknown[], Result>(mock: {
  getMockImplementation(): ((...args: Args) => Promise<Result>) | undefined;
  mockImplementationOnce(implementation: (...args: Args) => Promise<Result>): unknown;
}) {
  const release = deferred<void>();
  const entered = vi.fn();
  const implementation = mock.getMockImplementation()!;
  mock.mockImplementationOnce(async (...args) => {
    entered();
    await release.promise;
    return implementation(...args);
  });
  return { entered, release: () => release.resolve() };
}
const browserWaits = ['tabs.query', 'permissions.contains', 'storage read', 'windows.get'] as const;
function stallBrowser(h: Harness, api: (typeof browserWaits)[number]) {
  switch (api) {
    case 'tabs.query':
      return stall(h.browser.tabs.query);
    case 'permissions.contains':
      return stall(h.browser.permissions.contains);
    case 'storage read':
      return stall(h.browser.storage.local.get);
    case 'windows.get':
      return stall(h.browser.windows.get);
  }
}
function choose(owner: ReturnType<typeof popup>) {
  const root = owner.button('review').closest('#agent-sign-in')!;
  const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
  persona.value = 'alex';
  persona.dispatchEvent(new Event('change'));
}

it.each(
  browserWaits.flatMap((api) => ['load', 'review'].map((stage) => ({ api, stage }))),
)('bounds hung $api during $stage, advances the queue and immediately revokes a late grant', async ({
  api,
  stage,
}) => {
  const h = captureHarness(true);
  await turn(); // Startup absence verification is complete before the injected hang.
  let a: ReturnType<typeof popup>;
  let paused: ReturnType<typeof stallBrowser>;
  if (stage === 'review') {
    a = popup(h);
    await phase(a.port, 'ready');
    choose(a);
    paused = stallBrowser(h, api);
    a.button('review').click();
  } else {
    paused = stallBrowser(h, api);
    a = popup(h);
  }
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1));
  const b = popup(h);
  await turn();
  expect(b.button('review').disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  await phase(b.port, 'ready');
  expect(['failed', 'cancelled']).toContain(a.port.view.phase);
  expect(a.button('review').disabled).toBe(true);
  const messages = h.native.mock.calls.length;
  const removals = h.browser.permissions.remove.mock.calls.length;
  const previous = a.port.view.phase;
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals + 1);
  expect(h.state.cookies).toBe(false);
  await turn();
  paused.release();
  await turn();
  expect(a.port.view.phase).toBe(previous);
  expect(h.native).toHaveBeenCalledTimes(messages);
  noCapture(h);
  await b.arm();
});

it.each(
  browserWaits,
)('disconnect cancels popup-load %s without waiting for its deadline', async (api) => {
  const h = captureHarness(true);
  await turn();
  const paused = stallBrowser(h, api);
  const a = popup(h);
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1));
  const disconnectedAt = Date.now();
  a.port.client.disconnect();
  const b = popup(h);
  await phase(b.port, 'ready');
  expect(Date.now() - disconnectedAt).toBeLessThan(1000);
  const calls = h.native.mock.calls.length;
  paused.release();
  await turn();
  expect(h.native).toHaveBeenCalledTimes(calls);
  noCapture(h);
});

it('revokes the round-11 late grant while tabs.query holds the serial queue, even with hung marker storage', async () => {
  const h = captureHarness(true);
  await turn();
  const paused = stallBrowser(h, 'tabs.query');
  const a = popup(h);
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1));
  const marker = stall(h.browser.storage.local.set);
  const removals = h.browser.permissions.remove.mock.calls.length;
  h.state.cookies = true;
  h.browser.permissions.onAdded.emit({ permissions: ['cookies'] });
  expect(marker.entered).toHaveBeenCalledTimes(1);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(removals + 1);
  expect(h.state.cookies).toBe(false);
  a.port.client.disconnect();
  const b = popup(h);
  await vi.advanceTimersByTimeAsync(10000);
  await turn();
  expect(b.warning().hidden).toBe(false);
  expect(b.button('remove-cookie-access').disabled).toBe(false);
  b.button('remove-cookie-access').click();
  await phase(b.port, 'ready');
  await vi.advanceTimersByTimeAsync(600000);
  noCapture(h);
  expect(h.state.cookies).toBe(false);
  await b.arm();
});

it.each([
  'onStartup',
  'onInstalled',
] as const)('runs %s revocation outside a hung load queue', async (event) => {
  const h = captureHarness(true);
  await turn();
  const paused = stallBrowser(h, 'windows.get');
  const a = popup(h);
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1));
  const marker = stall(h.browser.storage.local.set);
  h.state.cookies = true;
  h.browser.runtime[event].emit(undefined);
  await turn();
  expect(h.state.cookies).toBe(false);
  expect(h.browser.permissions.remove).toHaveBeenCalledTimes(1);
  expect(h.native).not.toHaveBeenCalled();
  marker.release();
  a.port.client.disconnect();
  const b = popup(h);
  await b.arm();
  noCapture(h);
});

it('releases a disconnected review’s barrier when its independent removal finishes', async () => {
  const h = captureHarness(true);
  const a = popup(h);
  await phase(a.port, 'ready');
  choose(a);
  h.state.cookies = true;
  const paused = stall(h.browser.permissions.remove);
  a.button('review').click();
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1));
  a.port.client.disconnect();
  const b = popup(h);
  await turn();
  expect(b.button('review').disabled).toBe(true);
  paused.release();
  await b.arm();
  noCapture(h);
});

it('does not resume a nested tab lookup after the containing load times out', async () => {
  const h = captureHarness(true);
  await turn();
  const storage = stall(h.browser.storage.local.get);
  const tab = stall(h.browser.tabs.query);
  const a = popup(h);
  await vi.waitFor(() => expect(storage.entered).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(8000);
  storage.release();
  await vi.waitFor(() => expect(tab.entered).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(2000);
  await phase(a.port, 'failed');
  tab.release();
  await turn();
  expect(h.browser.windows.get).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
});

it.each([
  'list',
  'beginLogin',
  'capture',
] as const)('bounds a hung native %s reply to ten seconds and proceeds with another popup', async (type) => {
  const h = captureHarness(true);
  await turn();
  let a: ReturnType<typeof popup>;
  let paused: ReturnType<typeof stall>;
  if (type === 'list') {
    paused = stall(h.native);
    a = popup(h);
  } else {
    a = popup(h);
    await a.arm();
    if (type === 'capture') {
      a.button('review').click();
      await phase(a.port, 'confirming');
    }
    paused = stall(h.native);
    a.button(type === 'capture' ? 'confirm' : 'review').click();
  }
  await vi.waitFor(() => expect(paused.entered).toHaveBeenCalledTimes(1), { timeout: 2500 });
  expect(h.native.mock.calls.at(-1)![0].type).toBe(type);
  const b = popup(h);
  await vi.advanceTimersByTimeAsync(10000);
  await phase(b.port, 'ready');
  expect(a.port.view.phase).toBe('failed');
  expect(h.state.cookies).toBe(false);
  const reads = h.browser.cookies.getAll.mock.calls.length;
  const sent = h.native.mock.calls.length;
  const pushes = a.port.states.length;
  paused.release();
  await turn();
  expect(a.port.states).toHaveLength(pushes);
  expect(h.browser.cookies.getAll).toHaveBeenCalledTimes(reads);
  expect(h.native).toHaveBeenCalledTimes(sent);
  await b.arm();
});
