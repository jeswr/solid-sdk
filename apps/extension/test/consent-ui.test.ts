// AUTHORED-BY GPT-6.1-Sol (Codex)
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PendingConsentView } from '../src/shared/messages';
import { expectAccessible } from './permission-a11y';

let dom: JSDOM;
let send: ReturnType<typeof vi.fn>;
const view = (id = '1'): PendingConsentView => ({
  consentId: 'fixture',
  origin: 'https://app.example',
  webId: `https://pod.example/${id}#me`,
  profileId: id,
  profiles: [
    { id: '1', label: 'Personal', webId: 'https://pod.example/1#me' },
    { id: '2', label: 'Work', webId: 'https://pod.example/2#me' },
  ],
  classes: [
    {
      dataClass: 'https://schema.org/Person',
      modes: ['read'],
      purpose: 'build your address book',
      expiresAt: 3_000_000_000_000,
      shape: null,
      targets: [{ url: `https://pod.example/${id}/private`, kind: 'instance' }],
    },
  ],
});
async function mount(
  initial: PendingConsentView | null = view(),
  theme = 'light',
  url = 'https://extension.example/consent?consentId=fixture',
) {
  dom = new JSDOM(readFileSync(new URL('../src/consent/consent.html', import.meta.url), 'utf8'), {
    url,
  });
  dom.window.localStorage.setItem('app-shell-theme', theme);
  send = vi.fn(async (message: Record<string, unknown>, callback?: () => void) => {
    if (message.type === 'SOLID_GET_PENDING_CONSENT')
      return message.profileId ? view(String(message.profileId)) : initial;
    callback?.();
    return undefined;
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  vi.spyOn(dom.window, 'close').mockImplementation(() => {});
  vi.resetModules();
  await import('../src/consent/consent');
  await vi.waitFor(() => {
    const doc = dom.window.document;
    expect(
      doc.querySelector('#classes')?.getAttribute('aria-busy') === 'false' ||
        !doc.querySelector<HTMLElement>('#error')!.hidden,
    ).toBe(true);
  });
  const document = dom.window.document;
  return {
    document,
    approve: document.querySelector<HTMLButtonElement>('#approve')!,
    all: document.querySelector<HTMLInputElement>('#select-all')!,
    picker: document.querySelector<HTMLSelectElement>('#profile')!,
  };
}
afterEach(() => {
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows the purpose headline, readable data cards, exact scope and the worker-fixed duration', async () => {
  const { document, approve } = await mount();
  expect(document.querySelector('h1')?.textContent).toBe(
    'To build your address book, https://app.example requests access to:',
  );
  expect(document.querySelector('#webid')?.textContent).toBe('Personal');
  expect(document.body.textContent).not.toMatch(
    /WebID|https:\/\/schema.org|https:\/\/pod.example\/1#me/,
  );
  const card = document.querySelector('article.class-item')!;
  const box = card.querySelector('input')!;
  expect(card.querySelector('.class-title')?.textContent).toBe('Contacts');
  expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toContain(
    'contact information',
  );
  expect(card.querySelector('.chips')?.textContent).toBe('Read');
  expect(card.querySelector('.meta')?.textContent).toContain('1 item');
  expect(card.querySelector('.targets')?.textContent).toBe('https://pod.example/1/private');
  const duration = document.querySelector<HTMLInputElement>('[role="radiogroup"] input')!;
  expect(duration.type).toBe('radio');
  expect(duration.checked).toBe(true);
  expect(duration.disabled).toBe(true);
  expect(document.querySelector('#duration-label')?.textContent).toContain('Until');
  expect(document.querySelector('#duration-hint')?.textContent).toContain('site sets');
  expect(approve.textContent).toBe('Share');
  expect(document.querySelector('#deny')?.textContent).toBe('Cancel');
  expect(approve.className).toBe(document.querySelector('#deny')?.className);
  expect(approve.disabled).toBe(false);
  await expectAccessible(document);
});

it.each([
  'light',
  'dark',
])('uses the saved %s theme and only shows a switcher for multiple active choices', async (theme) => {
  const initial = { ...view(), profiles: [view().profiles[0]] };
  const { document, picker } = await mount(initial, theme);
  expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
  expect(document.querySelector<HTMLElement>('#account-switcher')?.hidden).toBe(true);
  expect(picker.disabled).toBe(true);
  expect(document.querySelector('#webid')?.textContent).toBe('Personal');
  await expectAccessible(document);
});

it('falls back without a purpose and keeps untrusted labels, purposes and targets as text', async () => {
  const initial = view();
  const { document } = await mount({
    ...initial,
    classes: [{ ...initial.classes[0], purpose: null }],
  });
  expect(document.querySelector('h1')?.textContent).toBe('https://app.example requests access to:');
  send.mockResolvedValueOnce({
    ...view('2'),
    profiles: [{ ...initial.profiles[1], label: '<img src=x onerror=alert(1)>' }],
    classes: [
      {
        ...initial.classes[0],
        dataClass: 'https://example.test/#%3Csvg%20onload=alert(1)%3E',
        purpose: '<script>page input</script>',
        targets: [{ url: '<img src=x>', kind: 'container' }],
      },
    ],
  });
  const picker = document.querySelector('select')!;
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(document.querySelector('.targets')?.textContent).toContain('<img'));
  expect(document.querySelector('#webid')?.textContent).toContain('<img');
  expect(document.querySelector('h1')?.textContent).toContain('<script>page input</script>');
  expect(document.querySelector('.class-title')?.textContent).toContain('<svg');
  expect(document.querySelector('.targets')?.textContent).toContain('folder and its contents');
  expect(document.querySelectorAll('main script, main img, main svg')).toHaveLength(0);
});

it('keeps Select all in sync, shows partial selection, and prevents sharing an empty selection', async () => {
  const initial = view();
  const { document, approve, all } = await mount({
    ...initial,
    classes: [...initial.classes, { ...initial.classes[0], dataClass: 'https://schema.org/Event' }],
  });
  const boxes = document.querySelectorAll<HTMLInputElement>('.class-head input');
  expect(all.checked).toBe(true);
  boxes[0].click();
  expect(all.checked).toBe(false);
  expect(all.indeterminate).toBe(true);
  expect(approve.disabled).toBe(false);
  all.click();
  expect([...boxes].every((box) => box.checked)).toBe(true);
  expect(all.indeterminate).toBe(false);
  all.click();
  expect(approve.disabled).toBe(true);
  approve.click();
  expect(send).toHaveBeenCalledOnce();
  expect(document.querySelector('#selection-hint')?.textContent).toContain('Choose at least one');
  boxes[1].click();
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      profileId: '1',
      approvedClasses: ['https://schema.org/Event'],
    },
    expect.any(Function),
  );
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(send.mock.calls.filter(([m]) => m.type === 'SOLID_CONSENT_DECISION')).toHaveLength(1);
});

it('reloads scope and resets the selection before sharing from another account', async () => {
  const { document, picker, approve, all } = await mount();
  expect(document.querySelector<HTMLElement>('#account-switcher')?.hidden).toBe(false);
  all.click();
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  expect(approve.disabled).toBe(true);
  expect(all.disabled).toBe(true);
  await vi.waitFor(() =>
    expect(document.querySelector('.targets')?.textContent).toContain('/2/private'),
  );
  expect(document.querySelector('#webid')?.textContent).toBe('Work');
  expect(all.checked).toBe(true);
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      profileId: '2',
      approvedClasses: ['https://schema.org/Person'],
    },
    expect.any(Function),
  );
  expect(dom.window.close).toHaveBeenCalledOnce();
});

it.each([
  'resolve',
  'reject',
])('ignores stale account loads that %s after a newer selection', async (outcome) => {
  const { document, picker, approve } = await mount();
  let resolve!: (value: PendingConsentView) => void;
  let reject!: (reason: Error) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  (document.querySelector('.class-head input') as HTMLInputElement).click();
  expect(approve.disabled).toBe(true);
  picker.value = '1';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(approve.disabled).toBe(false));
  if (outcome === 'resolve') resolve(view('2'));
  else reject(new Error('Stale load failed'));
  await new Promise((done) => setTimeout(done, 0));
  expect(document.querySelector('#webid')?.textContent).toBe('Personal');
  expect(document.querySelector<HTMLElement>('#error')?.hidden).toBe(true);
  expect(approve.disabled).toBe(false);
});

it('keeps sharing disabled after a failed account load, including changes to old controls', async () => {
  const { document, picker, approve, all } = await mount();
  send.mockRejectedValueOnce(new Error('Load failed'));
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() =>
    expect(document.querySelector('#error')?.textContent).toContain('Could not load'),
  );
  (document.querySelector('.class-head input') as HTMLInputElement).click();
  expect(approve.disabled).toBe(true);
  expect(all.disabled).toBe(true);
  picker.value = '1';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(approve.disabled).toBe(false));
  expect(document.querySelector('#error')?.textContent).toBe('');
  expect(document.querySelector<HTMLElement>('#error')?.hidden).toBe(true);
});

it.each([
  false,
  true,
])('shows the empty scope without preselecting it (no classes: %s)', async (noClasses) => {
  const initial = view();
  const { document, approve, all } = await mount({
    ...initial,
    classes: noClasses ? [] : [{ ...initial.classes[0], targets: [] }],
  });
  expect(document.querySelector<HTMLElement>('#empty-note')?.hidden).toBe(false);
  expect(approve.disabled).toBe(true);
  expect(all.checked).toBe(false);
  expect(all.disabled).toBe(noClasses);
});

it.each([
  'Cancel',
  'pagehide',
])('denies on %s with the existing empty class decision', async (action) => {
  const { document } = await mount();
  if (action === 'Cancel') (document.querySelector('#deny') as HTMLButtonElement).click();
  else dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      approvedClasses: [],
    },
    expect.any(Function),
  );
});

it.each(['missing', 'expired'])('keeps Share disabled for a %s request', async (state) => {
  const { document, approve } = await mount(
    null,
    'light',
    state === 'missing' ? 'https://extension.example/consent' : undefined,
  );
  expect(approve.disabled).toBe(true);
  expect(document.querySelector<HTMLElement>('#error')?.hidden).toBe(false);
});

it.each([
  [[{ url: 'https://pod.example/docs/', kind: 'container' as const }], '1 folder and its contents'],
  [
    [
      { url: 'https://pod.example/a/', kind: 'container' as const },
      { url: 'https://pod.example/b/', kind: 'container' as const },
      { url: 'https://pod.example/c', kind: 'instance' as const },
    ],
    '2 folders and their contents and 1 item',
  ],
  [[], '0 items'],
])('summarises folder scope visibly (%#)', async (targets, summary) => {
  const initial = view();
  const { document } = await mount({
    ...initial,
    classes: [{ ...initial.classes[0]!, targets }],
  });
  expect(document.querySelector('.meta')?.textContent).toContain(summary);
});
