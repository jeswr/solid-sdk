// AUTHORED-BY GPT-6.1-Sol (Codex)
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';

let dom: JSDOM;
afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

it('stamps origin and activation in ISOLATED, ignoring page-supplied authority and management messages', async () => {
  dom = new JSDOM('', { url: 'https://ungranted.example/app' });
  const sendMessage = vi.fn((_message: unknown, callback?: (value: unknown) => void) =>
    callback?.({ webId: null }),
  );
  const activation = { isActive: false };
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('navigator', { userActivation: activation });
  vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });
  vi.resetModules();
  await import('../src/content/content-script');
  const post = (type: string) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window,
        data: {
          type,
          channel: 'solid-browser-ext',
          dir: 'to-content',
          stampedOrigin: 'https://granted.example',
          userActivated: true,
          origin: 'https://granted.example',
        },
      }),
    );
  for (const type of [
    'SOLID_FETCH_REQUEST',
    'SOLID_GET_STATE',
    'SOLID_REQUEST_ACCESS',
    'SOLID_LOGOUT',
  ])
    post(type);
  for (const [message] of sendMessage.mock.calls)
    expect(message).toMatchObject({ stampedOrigin: 'https://ungranted.example' });
  expect(sendMessage.mock.calls[2][0]).toMatchObject({ userActivated: false });
  activation.isActive = true;
  post('SOLID_REQUEST_ACCESS');
  expect(sendMessage.mock.lastCall?.[0]).toMatchObject({
    stampedOrigin: 'https://ungranted.example',
    userActivated: true,
  });
  sendMessage.mockClear();
  post('SOLID_ORIGIN_GRANT_PROFILE');
  post('SOLID_ORIGIN_GRANT_REVOKE');
  expect(sendMessage).not.toHaveBeenCalled();
});

it('drops identity broadcasts for another origin or without an origin, including a late navigation', async () => {
  dom = new JSDOM('', { url: 'https://granted.example/app' });
  const addListener = vi.fn();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
  vi.resetModules();
  await import('../src/content/content-script');
  const receive = addListener.mock.calls[0][0];
  const post = vi.spyOn(dom.window, 'postMessage');
  receive({
    type: 'SOLID_STATE_CHANGED',
    origin: 'https://granted.example',
    webId: 'https://alice.example/#me',
  });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'SOLID_STATE_UPDATE', webId: 'https://alice.example/#me' }),
    'https://granted.example',
  );
  post.mockClear();
  dom.reconfigure({ url: 'https://ungranted.example/' });
  for (const origin of ['https://granted.example', undefined, null, 'null'])
    receive({ type: 'SOLID_STATE_CHANGED', origin, webId: 'https://alice.example/#me' });
  expect(post).not.toHaveBeenCalled();
  receive({ type: 'SOLID_STATE_CHANGED', origin: 'https://ungranted.example', webId: null });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'SOLID_STATE_UPDATE', webId: null }),
    'https://ungranted.example',
  );
});
