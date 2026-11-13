// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';

afterEach(() => {
  document.body.innerHTML = '';
});
function fixture() {
  document.body.innerHTML = readFileSync(`${import.meta.dirname}/../src/popup/popup.html`, 'utf8');
  const sendMessage = vi.fn(async (message: { request: { type: string } }) => {
    const type = message.request.type;
    const result =
      type === 'list'
        ? {
            type,
            profiles: [{ id: 'personal', label: 'Personal' }],
            personas: [{ id: 'alex', profile: 'personal', label: 'Alex Example' }],
            cookieDomains: [],
          }
        : type === 'beginLogin'
          ? { type, token: '00000000-0000-4000-8000-000000000001' }
          : { type };
    return { ok: true, result };
  });
  const getAll = vi.fn(async () => [
    {
      name: 'sid',
      value: 'fixture-cookie-secret',
      domain: 'shop.test',
      path: '/',
      hostOnly: true,
      httpOnly: true,
      secure: true,
      session: true,
      storeId: '0',
      sameSite: 'lax',
    },
  ]);
  const state = { cookiesGranted: false, siteGranted: true };
  const browser = {
    runtime: {
      sendMessage,
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      })),
    },
    tabs: { query: vi.fn(async () => [{ id: 3, url: 'https://shop.test/account' }]) },
    cookies: { getAll },
    permissions: {
      contains: vi.fn(async (input: chrome.permissions.Permissions) =>
        input.origins ? state.siteGranted : state.cookiesGranted,
      ),
      request: vi.fn(async () => {
        state.cookiesGranted = true;
        return true;
      }),
      remove: vi.fn(async () => {
        state.cookiesGranted = false;
        return true;
      }),
    },
  };
  const root = document.getElementById('agent-sign-in')!;
  return { root, browser, sendMessage, getAll, state };
}
async function selectPersona(root: HTMLElement) {
  const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
  await vi.waitFor(() => expect(persona.disabled).toBe(false));
  persona.value = 'alex';
  persona.dispatchEvent(new Event('change'));
}
it('shows the site, cookie count and persona before the confirm click sends anything', async () => {
  const { root, browser, sendMessage, getAll } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  const review = root.querySelector<HTMLButtonElement>('#agent-review')!;
  await selectPersona(root);
  expect(getAll).not.toHaveBeenCalled();
  // Changing persona makes the explicitly selected account reviewable.
  expect(review.disabled).toBe(false);
  review.click();
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  expect(root.querySelector('#agent-preview')?.textContent).toContain(
    '1 cookie for https://shop.test with Alex Example (Personal)',
  );
  expect(root.textContent).not.toContain('fixture-cookie-secret');
  expect(sendMessage.mock.calls.map(([m]) => m.request.type)).toEqual(['list', 'beginLogin']);
  confirm.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')?.textContent).toContain('Sign-in shared'),
  );
  expect(sendMessage.mock.calls.map(([m]) => m.request.type)).toEqual([
    'list',
    'beginLogin',
    'capture',
  ]);
  expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(true);
});

it('tells the person to use Chrome’s extension menu for withheld site access without contacting the native host', async () => {
  const { root, browser, sendMessage, getAll } = fixture();
  browser.permissions.contains.mockResolvedValue(false);
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
      "Chrome's extension menu first, then try again",
    ),
  );
  expect(sendMessage).not.toHaveBeenCalled();
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(getAll).not.toHaveBeenCalled();
});

it.each([
  'rejects',
  'still present',
])('blocks confirmation with a visible warning when review cleanup %s', async (failure) => {
  const { root, browser, sendMessage } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  if (failure === 'rejects')
    browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  else browser.permissions.remove.mockResolvedValue(true);
  root.querySelector<HTMLButtonElement>('#agent-review')!.click();
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  await vi.waitFor(() => expect(warning.hidden).toBe(false));
  expect(warning.hidden).toBe(false);
  expect(warning.textContent).toContain('Sharing is blocked');
  expect(root.querySelector<HTMLElement>('#agent-preview')!.hidden).toBe(false);
  expect(confirm.disabled).toBe(true);
  confirm.click();
  expect(sendMessage.mock.calls.map(([m]) => m.request.type)).toEqual(['list', 'beginLogin']);
  expect(warning.hidden).toBe(false);
  expect(root.textContent).not.toContain('fixture-secret');
});

it('keeps the cleanup warning visible alongside native-host failure and cancellation', async () => {
  const { root, browser, sendMessage } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  sendMessage.mockRejectedValueOnce(new Error('fixture-secret'));
  const review = root.querySelector<HTMLButtonElement>('#agent-review')!;
  review.click();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!.disabled).toBe(
      false,
    ),
  );
  expect(review.disabled).toBe(true);
  expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
    'Could not prepare sharing',
  );
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  expect(warning.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>('#agent-cancel')!.click();
  expect(root.querySelector('#agent-sign-in-status')!.textContent).toBe('Sharing cancelled.');
  expect(warning.hidden).toBe(false);
  expect(root.textContent).not.toContain('fixture-secret');
});

it('shows Chrome’s site-access instructions if access is withheld after review', async () => {
  const { root, browser, sendMessage } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  root.querySelector<HTMLButtonElement>('#agent-review')!.click();
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  browser.permissions.contains.mockResolvedValue(false);
  sendMessage.mockClear();
  confirm.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
      "Chrome's extension menu first, then try again",
    ),
  );
  expect(sendMessage).not.toHaveBeenCalled();
});

it('refuses pre-granted cookies on popup load with a removal warning and no native messages', async () => {
  const { root, browser, sendMessage, getAll, state } = fixture();
  state.cookiesGranted = true;
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  const remove = root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!;
  await vi.waitFor(() => expect(warning.hidden).toBe(false));
  expect(remove.textContent).toBe('Remove cookie access');
  expect(warning.querySelectorAll('button')).toHaveLength(1);
  const review = root.querySelector<HTMLButtonElement>('#agent-review')!;
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  expect(review.disabled).toBe(true);
  expect(confirm.disabled).toBe(true);
  review.click();
  confirm.click();
  expect(root.querySelector<HTMLElement>('#agent-preview')!.hidden).toBe(true);
  expect(browser.permissions.contains).toHaveBeenNthCalledWith(1, { permissions: ['cookies'] });
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.permissions.remove).not.toHaveBeenCalled();
  expect(browser.runtime.connect).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(getAll).not.toHaveBeenCalled();
  expect(state.cookiesGranted).toBe(true);
});

it('enables sharing only after the remove button verifies absence, and the next capture ends without cookies', async () => {
  const { root, browser, sendMessage, state } = fixture();
  state.cookiesGranted = true;
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  await vi.waitFor(() => expect(warning.hidden).toBe(false));
  let verify!: (present: boolean) => void;
  browser.permissions.contains.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        verify = resolve;
      }),
  );
  const remove = root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!;
  remove.click();
  await vi.waitFor(() => expect(browser.permissions.remove).toHaveBeenCalledOnce());
  expect(browser.permissions.remove).toHaveBeenCalledWith({ permissions: ['cookies'] });
  expect(browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
  expect(browser.permissions.contains.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
    browser.permissions.remove.mock.invocationCallOrder[0],
  );
  expect(remove.disabled).toBe(true);
  expect(root.querySelector<HTMLSelectElement>('#agent-persona')!.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('#agent-review')!.disabled).toBe(true);
  expect(sendMessage).not.toHaveBeenCalled();
  verify(false);
  await selectPersona(root);
  expect(warning.hidden).toBe(true);
  const review = root.querySelector<HTMLButtonElement>('#agent-review')!;
  expect(review.disabled).toBe(false);
  review.click();
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  expect(state.cookiesGranted).toBe(false);
  confirm.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain('Sign-in shared'),
  );
  expect(state).toEqual({ cookiesGranted: false, siteGranted: true });
  expect(browser.permissions.request.mock.calls).toEqual([[{ permissions: ['cookies'] }]]);
  expect(sendMessage.mock.calls.map(([m]) => m.request.type)).toEqual([
    'list',
    'beginLogin',
    'capture',
  ]);
});

it.each([
  'rejects',
  'still present',
  'verification rejects',
])('keeps sharing refused with Chrome settings instructions when the remove button %s', async (failure) => {
  const { root, browser, sendMessage, getAll, state } = fixture();
  state.cookiesGranted = true;
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  await vi.waitFor(() => expect(warning.hidden).toBe(false));
  if (failure === 'rejects')
    browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  if (failure === 'still present') browser.permissions.remove.mockResolvedValue(false);
  if (failure === 'verification rejects')
    browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!.click();
  await vi.waitFor(() => expect(warning.textContent).toContain("Chrome's extension settings"));
  expect(warning.hidden).toBe(false);
  expect(root.querySelector<HTMLButtonElement>('#agent-review')!.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('#agent-confirm')!.disabled).toBe(true);
  expect(browser.permissions.remove.mock.calls).toEqual([[{ permissions: ['cookies'] }]]);
  expect(browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.runtime.connect).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(getAll).not.toHaveBeenCalled();
  expect(root.textContent).not.toContain('fixture-secret');
});

it('shows both withheld-site instructions and the stale-grant warning on popup load', async () => {
  const { root, browser, sendMessage, state } = fixture();
  state.cookiesGranted = true;
  state.siteGranted = false;
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
      "Chrome's extension menu",
    ),
  );
  expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(false);
  expect(root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!.disabled).toBe(
    false,
  );
  expect(browser.permissions.contains.mock.calls).toEqual([
    [{ permissions: ['cookies'] }],
    [{ origins: ['https://shop.test:443/*'] }],
  ]);
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  root.querySelector<HTMLButtonElement>('#agent-remove-cookie-access')!.click();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(true),
  );
  expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
    "Chrome's extension menu",
  );
  expect(root.querySelector<HTMLButtonElement>('#agent-review')!.disabled).toBe(true);
  expect(sendMessage).not.toHaveBeenCalled();
});

it.each([
  'invalid tab',
  'withheld-site check rejects',
])('keeps the stale-grant warning visible when popup load fails at %s', async (failure) => {
  const { root, browser, sendMessage, state } = fixture();
  state.cookiesGranted = true;
  if (failure === 'invalid tab')
    browser.tabs.query.mockResolvedValue([{ id: 3, url: 'chrome://settings' }]);
  else
    browser.permissions.contains
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('fixture-secret'));
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain(
      'Open a signed-in HTTPS site',
    ),
  );
  expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(false);
  expect(root.querySelector<HTMLButtonElement>('#agent-review')!.disabled).toBe(true);
  expect(browser.permissions.contains).toHaveBeenNthCalledWith(1, { permissions: ['cookies'] });
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(root.textContent).not.toContain('fixture-secret');
});

it('refuses review if a cookie grant appears after popup load without requesting or sending anything', async () => {
  const { root, browser, sendMessage, getAll, state } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  state.cookiesGranted = true;
  sendMessage.mockClear();
  root.querySelector<HTMLButtonElement>('#agent-review')!.click();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(false),
  );
  expect(root.querySelector<HTMLElement>('#agent-preview')!.hidden).toBe(true);
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.permissions.remove).not.toHaveBeenCalled();
  expect(browser.runtime.connect).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(getAll).not.toHaveBeenCalled();
});

it.each([
  'late grant',
  'check rejects',
])('refuses confirmation and cleans up when cookie authority changes after review: %s', async (change) => {
  const { root, browser, sendMessage, state } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  root.querySelector<HTMLButtonElement>('#agent-review')!.click();
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  expect(state.cookiesGranted).toBe(false);
  state.cookiesGranted = true;
  if (change === 'check rejects')
    browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  sendMessage.mockClear();
  browser.permissions.request.mockClear();
  browser.permissions.remove.mockClear();
  confirm.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain('Sharing refused'),
  );
  expect(sendMessage).not.toHaveBeenCalled();
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(browser.permissions.remove.mock.calls).toEqual([[{ permissions: ['cookies'] }]]);
  expect(browser.permissions.contains).toHaveBeenLastCalledWith({ permissions: ['cookies'] });
  expect(state).toEqual({ cookiesGranted: false, siteGranted: true });
  expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('#agent-preview')!.hidden).toBe(true);
  expect(confirm.disabled).toBe(true);
  expect(root.textContent).not.toContain('fixture-secret');
});

it('refuses popup loading when cookie absence cannot be checked', async () => {
  const { root, browser, sendMessage } = fixture();
  browser.permissions.contains.mockRejectedValueOnce(new Error('fixture-secret'));
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('#agent-permission-warning')!.hidden).toBe(false),
  );
  expect(root.querySelector<HTMLButtonElement>('#agent-review')!.disabled).toBe(true);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(browser.permissions.request).not.toHaveBeenCalled();
  expect(root.textContent).not.toContain('fixture-secret');
});
