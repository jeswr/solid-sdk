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
  let cookiesGranted = false;
  const browser = {
    runtime: {
      sendMessage,
      connect: () => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      }),
    },
    tabs: { query: async () => [{ id: 3, url: 'https://shop.test/account' }] },
    cookies: { getAll },
    permissions: {
      contains: vi.fn(async (input: chrome.permissions.Permissions) =>
        input.origins ? true : cookiesGranted,
      ),
      request: vi.fn(async () => {
        cookiesGranted = true;
        return true;
      }),
      remove: vi.fn(async () => {
        cookiesGranted = false;
        return true;
      }),
    },
  };
  const root = document.getElementById('agent-sign-in')!;
  return { root, browser, sendMessage, getAll };
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
])('keeps a visible warning when cookie removal %s while truthfully reporting capture success', async (failure) => {
  const { root, browser, sendMessage } = fixture();
  mountAgentSignIn(root, browser as unknown as typeof chrome);
  await selectPersona(root);
  if (failure === 'rejects')
    browser.permissions.remove.mockRejectedValue(new Error('fixture-secret'));
  else browser.permissions.remove.mockResolvedValue(true);
  root.querySelector<HTMLButtonElement>('#agent-review')!.click();
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  const warning = root.querySelector<HTMLElement>('#agent-permission-warning')!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  expect(warning.hidden).toBe(false);
  expect(warning.textContent).toContain('could not confirm that cookie access was removed');
  confirm.click();
  await vi.waitFor(() =>
    expect(root.querySelector('#agent-sign-in-status')!.textContent).toContain('Sign-in shared'),
  );
  expect(sendMessage.mock.calls.map(([m]) => m.request.type)).toEqual([
    'list',
    'beginLogin',
    'capture',
  ]);
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
  await vi.waitFor(() => expect(review.disabled).toBe(false));
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
