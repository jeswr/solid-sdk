// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeVaultBridge } from '../src/background/agent-vault';
import { CAPTURE_PERMISSION_PORT } from '../src/shared/agent-capture-permissions';

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
    onConnect: { addListener: vi.fn() },
    lastError: undefined,
  };
  const state = {
    origins: ['https://shop.test:443/*', 'https://other.test:443/*'],
    cookies: false,
  };
  const before = structuredClone(state);
  const permissions = {
    contains: vi.fn(async (_permissions: chrome.permissions.Permissions) => state.cookies),
    remove: vi.fn(async (input: chrome.permissions.Permissions) => {
      if (input.origins) state.origins = state.origins.filter((o) => !input.origins!.includes(o));
      if (input.permissions?.includes('cookies')) state.cookies = false;
      return true;
    }),
    onAdded: { addListener: vi.fn() },
  };
  const action = { setBadgeText: vi.fn(async () => {}) };
  installNativeVaultBridge({ runtime, permissions, action } as unknown as typeof chrome);
  const listener = runtime.onMessage.addListener.mock.calls[0][0];
  const sender = { id: runtime.id, url: runtime.getURL('popup/popup.html') };
  return { runtime, port, listener, sender, permissions, state, before, action };
}
const request = { type: 'AGENT_VAULT', request: { type: 'list', site: 'https://shop.test' } };
describe('native host trust boundary', () => {
  it('restores the original permission state on popup close, including a late permission grant', async () => {
    const { runtime, sender, permissions, state, before } = fixture();
    const popup = {
      name: CAPTURE_PERMISSION_PORT,
      sender,
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    runtime.onConnect.addListener.mock.calls[0][0](popup);
    popup.onMessage.addListener.mock.calls[0][0]({ site: 'https://shop.test' });
    state.cookies = true;
    permissions.onAdded.addListener.mock.calls[0][0]({ permissions: ['cookies'] });
    expect(permissions.remove).not.toHaveBeenCalled();
    // Popup destruction prevents its finally from running; the worker owns this cleanup.
    popup.onDisconnect.addListener.mock.calls[0][0]();
    expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    await vi.runAllTimersAsync();
    expect(state).toEqual(before);
    expect(permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
    expect(permissions.remove).toHaveBeenCalledTimes(1);
    permissions.remove.mockClear();
    state.cookies = true;
    permissions.onAdded.addListener.mock.calls[0][0]({ permissions: ['cookies'] });
    expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    await vi.runAllTimersAsync();
    expect(state).toEqual(before);
    expect(permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
    expect(permissions.remove).toHaveBeenCalledTimes(1);
    expect(runtime.connectNative).not.toHaveBeenCalled();
  });
  it.each([
    'rejects',
    'still present',
  ])('shows a toolbar warning when popup-close cookie removal %s', async (failure) => {
    const { runtime, sender, permissions, state, before, action } = fixture();
    state.cookies = true;
    if (failure === 'rejects') permissions.remove.mockRejectedValue(new Error('fixture-secret'));
    else permissions.remove.mockResolvedValue(true);
    const popup = {
      name: CAPTURE_PERMISSION_PORT,
      sender,
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    runtime.onConnect.addListener.mock.calls[0][0](popup);
    popup.onMessage.addListener.mock.calls[0][0]({ site: 'https://shop.test' });
    popup.onDisconnect.addListener.mock.calls[0][0]();
    expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
    await vi.runAllTimersAsync();
    expect(permissions.contains).toHaveBeenCalledWith({ permissions: ['cookies'] });
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(state.origins).toEqual(before.origins);
  });
  it('denies content scripts permission-cleanup ports', () => {
    const { runtime, sender } = fixture();
    const popup = {
      name: CAPTURE_PERMISSION_PORT,
      sender: { ...sender, tab: { id: 1 } },
      disconnect: vi.fn(),
    };
    runtime.onConnect.addListener.mock.calls[0][0](popup);
    expect(popup.disconnect).toHaveBeenCalled();
  });
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
