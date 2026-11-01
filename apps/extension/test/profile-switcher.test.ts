// @vitest-environment jsdom
// AUTHORED-BY GPT-6.1-Sol (Codex)
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountProfileSwitcher } from '../src/popup/profile-switcher';
import type { Profile, ProfileRequest } from '../src/shared/messages';

let mounted: ReturnType<typeof mountProfileSwitcher>;
let profiles: Profile[];
let defaultProfileId: string | null;
let requests: ProfileRequest[];
let error: string | undefined;
let removalError: string | undefined;
// When set, the next worker reply is held until `release()` so a test can observe the busy UI.
let held: (() => void) | null = null;
let holdNext = false;
const release = () => {
  const run = held;
  held = null;
  run?.();
};
// jsdom has no focus fixup: emulate the browser dropping focus from a disabled/hidden control.
const focusFixup = () => {
  const active = document.activeElement as HTMLButtonElement | null;
  if (!active || !(active.disabled || active.closest('[hidden]'))) return;
  // jsdom ignores blur() on a disabled control; focusing then removing a probe resets to <body>.
  const probe = document.createElement('button');
  document.body.append(probe);
  probe.focus();
  probe.remove();
};
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const action = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label,
  )!;
beforeEach(async () => {
  profiles = ['Personal', 'Work'].map((label, index) => ({
    id: String(index + 1),
    label,
    webId: `https://fixture.invalid/${index}`,
    issuer: 'https://fixture.invalid/',
    sessionState: 'active',
    dpopKeyRef: String(index + 1),
  }));
  defaultProfileId = '1';
  requests = [];
  held = null;
  holdNext = false;
  error = undefined;
  removalError = undefined;
  document.body.replaceChildren();
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (request: ProfileRequest, reply: (reply: unknown) => void) => {
        if (holdNext) {
          holdNext = false;
          held = () => respond(request, reply);
          return;
        }
        respond(request, reply);
      },
    },
  });
  function respond(request: ProfileRequest, callback: (reply: unknown) => void) {
    requests.push(request);
    if (request.type === 'SOLID_PROFILE_REMOVE') {
      profiles = profiles.map((p) =>
        p.id === request.profileId ? { ...p, sessionState: 'removing' } : p,
      );
      if (removalError) return callback({ error: removalError });
    }
    if (error) return callback({ error });
    if (request.type === 'SOLID_PROFILE_SET_DEFAULT') defaultProfileId = request.profileId;
    if (request.type === 'SOLID_PROFILE_REMOVE')
      profiles = profiles.filter((p) => p.id !== request.profileId);
    if (request.type === 'SOLID_PROFILE_RENAME')
      profiles = profiles.map((p) =>
        p.id === request.profileId ? { ...p, label: request.label } : p,
      );
    callback({ ok: true, profiles, defaultProfileId });
  }
  mounted = mountProfileSwitcher(document.body);
  await flush();
});
afterEach(() => {
  mounted.cleanup();
  vi.unstubAllGlobals();
});

it('renders labelled profiles and native default controls with an avatar per profile', async () => {
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(2);
  expect(document.querySelectorAll('.profile-avatar')).toHaveLength(2);
  expect(action('Set Personal as default').getAttribute('aria-pressed')).toBe('true');
  action('Set Work as default').click();
  await flush();
  expect(action('Set Work as default').getAttribute('aria-pressed')).toBe('true');
  expect(get('profile-status').textContent).toBe('Default profile changed.');
});

it('supports rename, Escape cancel and focus return without sending a mutation', async () => {
  action('Rename Work').click();
  expect(document.activeElement).toBe(get('profile-input'));
  expect(get<HTMLInputElement>('profile-input').value).toBe('Work');
  get('profile-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  expect(get('profile-editor').hidden).toBe(true);
  expect(document.activeElement).toBe(action('Rename Work'));
  expect(requests).toHaveLength(1);
  action('Rename Work').click();
  get<HTMLInputElement>('profile-input').value = 'Office';
  get('profile-editor').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(action('Rename Office')).toBeDefined();
  expect(document.activeElement).toBe(action('Rename Office'));
});

it('requires explicit removal confirmation and explains its effect', async () => {
  action('Remove Work').click();
  expect(requests).toHaveLength(1);
  expect(document.activeElement).toBe(get('profile-cancel'));
  expect(get('profile-editor-help').textContent).toContain('revokes its app access');
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(requests.at(-1)).toEqual({ type: 'SOLID_PROFILE_REMOVE', profileId: '2' });
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(1);
  expect(document.activeElement).toBe(get('profile-add'));
});

it('keeps failed input for retry and announces the error', async () => {
  get('profile-add').click();
  get<HTMLInputElement>('profile-input').value = 'https://fixture.invalid/new';
  error = 'Sign-in cancelled.';
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(get('profile-error').textContent).toBe(error);
  expect(get('profile-error').getAttribute('role')).toBe('alert');
  expect(get('profile-editor').hidden).toBe(false);
  expect(get<HTMLInputElement>('profile-input').value).toBe('https://fixture.invalid/new');
});

it.each([
  'Retry removal',
  'Retry profiles',
])('recovers a failed removal after cancelling the editor with %s', async (retry) => {
  removalError = 'Cache unavailable.';
  action('Remove Work').click();
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(get('profile-error').textContent).toBe(removalError);
  expect(document.querySelector('[data-profile-id="2"]')?.textContent).toContain('Removal pending');
  get('profile-cancel').click();
  expect(get('profile-editor').hidden).toBe(true);

  // A repeated purge failure stays retryable.
  get('profile-retry').click();
  await flush();
  expect(requests.filter((request) => request.type === 'SOLID_PROFILE_REMOVE')).toHaveLength(2);
  expect(get('profile-error').textContent).toBe(removalError);
  expect(document.querySelector('[data-profile-id="2"]')?.textContent).toContain('Removal pending');
  expect(action('Set Work as default').disabled).toBe(true);
  expect(action('Rename Work').disabled).toBe(true);
  const removal = action('Retry removal of Work');
  expect(removal.textContent).toBe('Retry removal');
  expect(removal.disabled).toBe(false);
  expect(removal.getAttribute('aria-disabled')).toBe('false');
  expect(action('Sign in to Work')).toBeUndefined();
  expect(get('profile-retry').hidden).toBe(false);
  action('Set Work as default').click();
  action('Rename Work').click();
  expect(get('profile-editor').hidden).toBe(true);

  removalError = undefined;
  (retry === 'Retry removal' ? removal : get('profile-retry')).click();
  await flush();
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(1);
  expect(requests.filter((request) => request.type === 'SOLID_PROFILE_REMOVE')).toHaveLength(3);
  expect(defaultProfileId).toBe('1');
  expect(get('profile-error').textContent).toBe('');
});

it('restores focus to Sign in and add after a failed keyboard submission', async () => {
  get('profile-add').click();
  get<HTMLInputElement>('profile-input').value = 'https://fixture.invalid/new';
  const save = get<HTMLButtonElement>('profile-save');
  save.focus();
  error = 'Sign-in cancelled.';
  holdNext = true;
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(save.disabled).toBe(true);
  focusFixup();
  expect(document.activeElement).toBe(document.body);
  release();
  await flush();
  expect(get('profile-error').textContent).toBe(error);
  expect(get('profile-editor').hidden).toBe(false);
  expect(document.activeElement).toBe(save);
});

it('moves focus to a visible control when Retry profiles hides itself', async () => {
  removalError = 'Cache unavailable.';
  action('Remove Work').click();
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  get('profile-cancel').click();

  removalError = undefined;
  const retry = get<HTMLButtonElement>('profile-retry');
  retry.focus();
  holdNext = true;
  retry.click();
  await flush();
  focusFixup();
  release();
  await flush();
  expect(retry.hidden).toBe(true);
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(1);
  expect(document.activeElement).toBe(get('profile-add'));
});

it('moves focus to Add when a successful profile refresh hides Retry profiles', async () => {
  error = 'Storage unavailable.';
  await mounted.controller.refresh();
  const retry = get<HTMLButtonElement>('profile-retry');
  expect(retry.hidden).toBe(false);
  retry.focus();
  error = undefined;
  retry.click();
  await flush();
  expect(retry.hidden).toBe(true);
  expect(document.activeElement).toBe(get('profile-add'));
});

it('never pulls focus back from a control outside Profiles when an operation fails', async () => {
  const outside = document.createElement('button');
  outside.textContent = 'Theme';
  document.body.append(outside);
  get('profile-add').click();
  get<HTMLInputElement>('profile-input').value = 'https://fixture.invalid/new';
  get<HTMLButtonElement>('profile-save').focus();
  error = 'Sign-in cancelled.';
  holdNext = true;
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  outside.focus();
  release();
  await flush();
  expect(get('profile-error').textContent).toBe(error);
  expect(document.activeElement).toBe(outside);
});

it('leaves focus on an outside control when a rename completes successfully', async () => {
  const outside = document.createElement('button');
  outside.textContent = 'Theme';
  document.body.append(outside);
  action('Rename Work').click();
  get<HTMLInputElement>('profile-input').value = 'Office';
  holdNext = true;
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  outside.focus();
  release();
  await flush();
  expect(get('profile-editor').hidden).toBe(true);
  expect(document.activeElement).toBe(outside);
});

it('offers removal recovery when an existing pending profile loads without an error', async () => {
  profiles = profiles.map((p) => (p.id === '2' ? { ...p, sessionState: 'removing' } : p));
  await mounted.controller.refresh();
  expect(get('profile-error').textContent).toBe('');
  expect(get('profile-retry').hidden).toBe(true);
  action('Retry removal of Work').click();
  await flush();
  expect(requests.at(-1)).toEqual({ type: 'SOLID_PROFILE_REMOVE', profileId: '2' });
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(1);
});

it('shows signed-out profiles and permits re-login even at capacity', async () => {
  profiles = Array.from({ length: 8 }, (_, i) => ({
    ...profiles[0],
    id: String(i),
    label: `Profile ${i}`,
    sessionState: 'signed-out',
  }));
  await mounted.controller.refresh();
  expect(get<HTMLButtonElement>('profile-add').disabled).toBe(true);
  action('Sign in to Profile 0').click();
  await flush();
  expect(requests.at(-1)).toEqual({ type: 'SOLID_PROFILE_ADD', webId: profiles[0].webId });
});

it('focuses Add after retrying a pending removal frees the eighth slot', async () => {
  profiles = Array.from({ length: 8 }, (_, i) => ({
    ...profiles[0],
    id: String(i),
    label: `Profile ${i}`,
    sessionState: i === 7 ? 'removing' : 'active',
  }));
  await mounted.controller.refresh();
  expect(get<HTMLButtonElement>('profile-add').disabled).toBe(true);
  const retry = action('Retry removal of Profile 7');
  retry.focus();
  retry.click();
  await flush();
  expect(document.querySelectorAll('#profile-list li')).toHaveLength(7);
  expect(get<HTMLButtonElement>('profile-add').disabled).toBe(false);
  expect(document.activeElement).toBe(get('profile-add'));
});

it('focuses an enabled surviving control after adding the eighth profile', async () => {
  profiles = Array.from({ length: 7 }, (_, i) => ({
    ...profiles[0],
    id: String(i),
    label: `Profile ${i}`,
  }));
  await mounted.controller.refresh();
  get('profile-add').click();
  get<HTMLInputElement>('profile-input').value = 'https://fixture.invalid/new';
  // The worker returns the newly authenticated profile when the add completes.
  profiles = [...profiles, { ...profiles[0], id: '7', label: 'New' }];
  get('profile-editor').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(get('profile-editor').hidden).toBe(true);
  expect(get<HTMLButtonElement>('profile-add').disabled).toBe(true);
  expect(document.activeElement).toBe(action('Set Profile 0 as default'));
  expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
});

it('renders untrusted labels as text and falls back on missing or failed avatars', async () => {
  profiles = [
    { ...profiles[0], label: '<img src=x onerror=alert(1)>', avatar: 'javascript:alert(1)' },
  ];
  await mounted.controller.refresh();
  expect(document.querySelector('.profile-text strong')?.textContent).toBe(profiles[0].label);
  expect(document.querySelectorAll('img')).toHaveLength(0);
  profiles = [{ ...profiles[0], avatar: 'https://fixture.invalid/avatar.png' }];
  await mounted.controller.refresh();
  const img = document.querySelector('img')!;
  expect(img.referrerPolicy).toBe('no-referrer');
  img.dispatchEvent(new Event('error'));
  expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.querySelector('.profile-avatar')?.textContent).not.toBe('');
});
