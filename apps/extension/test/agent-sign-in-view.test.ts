// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { mountAgentSignIn } from '../src/popup/agent-sign-in-view';

afterEach(() => {
  document.body.innerHTML = '';
});
it('shows the site, cookie count and persona before the confirm click sends anything', async () => {
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
    permissions: { request: vi.fn(async () => true), remove: vi.fn(async () => true) },
  } as unknown as typeof chrome;
  const root = document.getElementById('agent-sign-in')!;
  mountAgentSignIn(root, browser);
  const persona = root.querySelector<HTMLSelectElement>('#agent-persona')!;
  const confirm = root.querySelector<HTMLButtonElement>('#agent-confirm')!;
  const review = root.querySelector<HTMLButtonElement>('#agent-review')!;
  await vi.waitFor(() => expect(persona.disabled).toBe(false));
  expect(getAll).not.toHaveBeenCalled();
  persona.value = 'alex';
  persona.dispatchEvent(new Event('change'));
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
});
