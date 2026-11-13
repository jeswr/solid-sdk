// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';
import { captureHarness, deferred, phase } from './agent-capture-fixture';

afterEach(() => {
  document.body.innerHTML = '';
});
function fixture() {
  const h = captureHarness();
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
  } else await vi.waitFor(() => expect(nativeTypes(f)).toContain('beginLogin'));
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
it.each([
  'valid',
  'withheld',
  'invalid',
  'host check rejects',
  'cookie check rejects',
])('shows stale cookie warning and removal on every popup load: %s', async (kind) => {
  const f = fixture();
  f.h.state.cookies = true;
  if (kind === 'withheld') f.h.state.origins.shift();
  if (kind === 'invalid')
    f.h.browser.tabs.query.mockResolvedValue([
      { id: 7, url: 'chrome://settings', incognito: false },
    ]);
  if (kind === 'host check rejects')
    f.h.browser.permissions.contains
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('fixture-secret'));
  if (kind === 'cookie check rejects')
    f.h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  f.mount();
  await phase(f.p, 'failed');
  expect(f.warning().hidden).toBe(false);
  expect(f.button('remove-cookie-access').disabled).toBe(false);
  expect(f.button('remove-cookie-access').textContent).toBe('Remove cookie access');
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('confirm').disabled).toBe(true);
  expect(f.h.browser.permissions.contains).toHaveBeenNthCalledWith(1, { permissions: ['cookies'] });
  expect(f.h.browser.permissions.request).not.toHaveBeenCalled();
  expect(f.h.browser.permissions.remove).not.toHaveBeenCalled();
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.root.textContent).not.toContain('fixture-secret');
  if (kind === 'withheld') expect(f.text()).toContain("Chrome's extension menu");
});
it('only enables sharing after explicit removal verifies absence', async () => {
  const f = fixture();
  f.h.state.cookies = true;
  f.mount();
  await phase(f.p, 'failed');
  const absent = deferred<boolean>();
  f.h.browser.permissions.contains.mockImplementationOnce(() => absent.promise);
  f.button('remove-cookie-access').click();
  await vi.waitFor(() => expect(f.h.browser.permissions.remove).toHaveBeenCalled());
  expect(f.button('review').disabled).toBe(true);
  expect(f.button('remove-cookie-access').disabled).toBe(true);
  expect(f.h.native).not.toHaveBeenCalled();
  absent.resolve(false);
  await phase(f.p, 'ready');
  expect(f.warning().hidden).toBe(true);
  await f.review();
  f.button('confirm').click();
  await phase(f.p, 'shared');
  expect(f.h.state).toEqual(f.h.before);
});
it.each([
  'rejects',
  'still present',
  'verification rejects',
])('keeps removal failure visible with Chrome settings instructions: %s', async (failure) => {
  const f = fixture();
  f.h.state.cookies = true;
  f.mount();
  await phase(f.p, 'failed');
  if (failure === 'rejects')
    f.h.browser.permissions.remove.mockRejectedValueOnce(new Error('fixture-secret'));
  if (failure === 'still present') f.h.browser.permissions.remove.mockResolvedValueOnce(false);
  if (failure === 'verification rejects')
    f.h.browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  f.button('remove-cookie-access').click();
  await vi.waitFor(() => expect(f.warning().textContent).toContain("Chrome's extension settings"));
  expect(f.warning().hidden).toBe(false);
  expect(f.button('review').disabled).toBe(true);
  expect(f.h.native).not.toHaveBeenCalled();
  expect(f.root.textContent).not.toContain('fixture-secret');
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
