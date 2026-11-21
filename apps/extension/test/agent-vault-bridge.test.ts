// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from 'vitest';
import { captureHarness, confirming, phase } from './agent-capture-fixture';

it('denies pages, content scripts, other extensions and other extension surfaces capture ports', () => {
  const h = captureHarness();
  const sender = { id: h.browser.runtime.id, url: h.browser.runtime.getURL('popup/popup.html') };
  for (const candidate of [
    {},
    { ...sender, tab: { id: 1 } },
    { ...sender, id: 'foreign' },
    { ...sender, url: 'https://shop.test/' },
    { ...sender, url: h.browser.runtime.getURL('sidepanel/sidepanel.html') },
  ]) {
    const p = h.popup(candidate as typeof sender);
    expect(p.worker.disconnect).toHaveBeenCalled();
  }
  expect(h.native).not.toHaveBeenCalled();
});
it('closes the generic popup native proxy so capture cannot bypass the lease', () => {
  const h = captureHarness();
  const listener = h.browser.runtime.onMessage.addListener.mock.calls[0][0];
  for (const type of ['list', 'beginLogin', 'capture']) {
    const respond = vi.fn();
    expect(listener({ type: 'AGENT_VAULT', request: { type } }, {}, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith({ ok: false });
  }
  expect(h.native).not.toHaveBeenCalled();
});
it('rejects extra intent fields, cookie payloads, native requests and spoofed lease ownership', async () => {
  const h = captureHarness();
  const a = await confirming(h);
  const b = h.popup();
  h.native.mockClear();
  for (const input of [
    { type: 'confirm', lease: a.view.lease, cookies: ['fixture-secret'] },
    { type: 'capture', token: 'x' },
    { type: 'permission', lease: a.view.lease, granted: true, extra: 'x' },
  ])
    a.worker.onMessage.emit(input);
  b.send({ type: 'confirm', lease: a.view.lease! });
  b.send({ type: 'cancel', lease: a.view.lease! });
  expect(h.native).not.toHaveBeenCalled();
  expect(a.view.phase).toBe('confirming');
  a.cancel();
});
it('retains one worker native port and validates outgoing capture schema', async () => {
  const h = captureHarness();
  const a = await confirming(h);
  a.confirm();
  await phase(a, 'shared');
  expect(h.browser.runtime.connectNative).toHaveBeenCalledTimes(1);
  expect(h.nativePort.disconnect).not.toHaveBeenCalled();
  expect(h.nativePort.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
    'list',
    'beginLogin',
    'capture',
  ]);
  expect(h.nativePort.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'capture',
      message: expect.objectContaining({ account: 'alex' }),
    }),
  );
});
it.each([
  'extra field',
  'wrong type',
  'unknown id',
  'disconnect',
])('rejects invalid native replies without relaying credentials: %s', async (failure) => {
  const h = captureHarness();
  const held = new Promise<never>(() => {});
  h.native.mockImplementationOnce(() => held);
  const a = h.popup();
  a.load();
  await vi.waitFor(() => expect(h.native).toHaveBeenCalled());
  if (failure === 'disconnect') h.nativePort.onDisconnect.emit(undefined);
  else
    h.nativePort.onMessage.emit(
      failure === 'extra field'
        ? { id: 1, ok: false, error: 'fixture-cookie-secret' }
        : { id: failure === 'unknown id' ? 99 : 1, ok: true, result: { type: 'capture' } },
    );
  await phase(a, 'failed');
  expect(a.view.message).not.toContain('fixture-cookie-secret');
  if (failure !== 'wrong type') expect(h.nativePort.disconnect).toHaveBeenCalled();
});
