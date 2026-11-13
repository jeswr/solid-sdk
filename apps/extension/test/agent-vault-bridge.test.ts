// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeVaultBridge } from '../src/background/agent-vault';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
  };
  const runtime = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    getURL: (path: string) => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${path}`,
    connectNative: vi.fn(() => port),
    onMessage: { addListener: vi.fn() },
    lastError: undefined,
  };
  installNativeVaultBridge({ runtime } as unknown as typeof chrome);
  const listener = runtime.onMessage.addListener.mock.calls[0][0];
  const sender = { id: runtime.id, url: runtime.getURL('popup/popup.html') };
  return { runtime, port, listener, sender };
}
const request = { type: 'AGENT_VAULT', request: { type: 'list', site: 'https://shop.test' } };
describe('native host trust boundary', () => {
  it('refuses content scripts, pages, other extensions and other extension surfaces', () => {
    const { listener, sender, runtime } = fixture();
    for (const candidate of [
      {},
      { ...sender, tab: { id: 1 } },
      { ...sender, id: 'foreign' },
      { ...sender, url: 'https://shop.test/' },
      { ...sender, url: runtime.getURL('sidepanel/sidepanel.html') },
    ]) {
      const respond = vi.fn();
      expect(listener(request, candidate, respond)).toBe(false);
      expect(respond).toHaveBeenCalledWith({ ok: false });
    }
    expect(runtime.connectNative).not.toHaveBeenCalled();
  });
  it('routes only validated metadata and reuses the worker native port', async () => {
    const { listener, sender, runtime, port } = fixture();
    const respond = vi.fn();
    expect(listener(request, sender, respond)).toBe(true);
    expect(port.postMessage).toHaveBeenCalledWith({ id: 1, ...request.request });
    port.onMessage.addListener.mock.calls[0][0]({
      id: 1,
      ok: true,
      result: { type: 'list', profiles: [], personas: [], cookieDomains: [] },
    });
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({
      ok: true,
      result: { type: 'list', profiles: [], personas: [], cookieDomains: [] },
    });
    listener(request, sender, vi.fn());
    expect(runtime.connectNative).toHaveBeenCalledTimes(1);
    expect(port.disconnect).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
  });
  it('rejects host additions, disconnects and never relays a credential-shaped error', async () => {
    const { listener, sender, port } = fixture();
    const respond = vi.fn();
    listener(request, sender, respond);
    port.onMessage.addListener.mock.calls[0][0]({
      id: 1,
      ok: false,
      error: 'fixture-cookie-secret',
    });
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({ ok: false });
    expect(port.disconnect).toHaveBeenCalled();
  });
  it('rejects malformed requests before opening a native port', async () => {
    const { listener, sender, runtime } = fixture();
    const respond = vi.fn();
    listener(
      { type: 'AGENT_VAULT', request: { ...request.request, cookies: ['fixture-secret'] } },
      sender,
      respond,
    );
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({ ok: false });
    expect(runtime.connectNative).not.toHaveBeenCalled();
  });
});
