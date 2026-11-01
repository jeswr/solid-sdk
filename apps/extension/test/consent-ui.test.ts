// AUTHORED-BY GPT-6.1-Sol (Codex)
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PendingConsentView } from '../src/shared/messages';
import { PIM_STORAGE_CLASS } from '../src/shared/storage-class';
import { expectAccessible } from './permission-a11y';

let dom: JSDOM;
let send: ReturnType<typeof vi.fn>;
type TargetFixture = PendingConsentView['classes'][number]['targets'][number];
const target = (
  url: string,
  kind: TargetFixture['kind'],
  extra: Partial<TargetFixture> = {},
): TargetFixture => ({
  id: `t:${url}`,
  url,
  kind,
  source: 'type-index',
  check: 'unchecked',
  preselected: true,
  ...extra,
});
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
      targets: [target(`https://pod.example/${id}/private`, 'instance')],
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

function storageView(id = '1'): PendingConsentView {
  const initial = view(id);
  return {
    ...initial,
    classes: [
      {
        ...initial.classes[0],
        dataClass: PIM_STORAGE_CLASS,
        modes: ['read', 'write'],
        targets: [
          target(`https://pod.example/${id}/`, 'container', { preselected: false }),
          target('https://other-pod.example/storage/', 'container', { preselected: false }),
        ],
      },
    ],
  };
}

it.each([
  {
    modes: ['read', 'write'] as const,
    copy: 'This site can read and change everything in this pod',
  },
  { modes: ['read'] as const, copy: 'This site can read everything in this pod' },
  { modes: ['append'] as const, copy: 'This site can add to anything in this pod' },
  { modes: ['write'] as const, copy: 'This site can change everything in this pod' },
  {
    modes: ['read', 'append'] as const,
    copy: 'This site can read everything in this pod and add to it',
  },
])('warns about full pod access for $modes and requires selection plus Share', async ({
  modes,
  copy,
}) => {
  const initial = storageView();
  const { document, approve, all } = await mount({
    ...initial,
    classes: [{ ...initial.classes[0], modes }],
  });
  const card = document.querySelector('.class-item')!;
  expect(card.querySelector('.class-title')?.textContent).toBe('Full access to your pod');
  expect(card.querySelector('.warning')?.textContent).toBe(copy);
  expect(card.querySelector('.targets')?.textContent).toBe(
    'https://pod.example/1/https://other-pod.example/storage/',
  );
  expect(card.querySelector('details')).toBeNull();
  const box = card.querySelector('input')!;
  expect(box.checked).toBe(false);
  expect(all.checked).toBe(false);
  expect(approve.disabled).toBe(true);
  approve.click();
  expect(send).toHaveBeenCalledOnce();
  box.click();
  expect(approve.disabled).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  await expectAccessible(document);
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      profileId: '1',
      approvedTargets: {
        [PIM_STORAGE_CLASS]: ['t:https://pod.example/1/', 't:https://other-pod.example/storage/'],
      },
    },
    expect.any(Function),
  );
});

it('keeps ordinary classes selected in mixed requests without approving storage', async () => {
  const initial = view();
  const { document, approve, all } = await mount({
    ...initial,
    classes: [...initial.classes, ...storageView().classes],
  });
  const boxes = document.querySelectorAll<HTMLInputElement>('.class-head input');
  expect(boxes[0].checked).toBe(true);
  expect(boxes[1].checked).toBe(false);
  expect(all.checked).toBe(false);
  expect(all.indeterminate).toBe(true);
  expect(document.querySelectorAll('.warning')).toHaveLength(1);
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      approvedTargets: { 'https://schema.org/Person': ['t:https://pod.example/1/private'] },
    }),
    expect.any(Function),
  );
});

it('resets full pod access to unchecked after switching accounts', async () => {
  const { document, picker, approve } = await mount(storageView());
  document.querySelector<HTMLInputElement>('.class-head input')!.click();
  expect(approve.disabled).toBe(false);
  send.mockResolvedValueOnce(storageView('2'));
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(document.querySelector('.targets')?.textContent).toContain('/2/'));
  expect(document.querySelector<HTMLInputElement>('.class-head input')!.checked).toBe(false);
  expect(approve.disabled).toBe(true);
  expect(send.mock.calls.some(([m]) => m.type === 'SOLID_CONSENT_DECISION')).toBe(false);
});

it('keeps storage without any roots unchecked and sharing disabled', async () => {
  const initial = storageView();
  const { document, approve, all } = await mount({
    ...initial,
    classes: [{ ...initial.classes[0], targets: [] }],
  });
  expect(document.querySelector<HTMLInputElement>('.class-head input')!.checked).toBe(false);
  expect(document.querySelector<HTMLElement>('#empty-note')!.hidden).toBe(false);
  expect(all.checked).toBe(false);
  expect(approve.disabled).toBe(true);
  expect(send).toHaveBeenCalledOnce();
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
        targets: [target('<img src=x>', 'container')],
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
      approvedTargets: { 'https://schema.org/Event': ['t:https://pod.example/1/private'] },
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
      approvedTargets: { 'https://schema.org/Person': ['t:https://pod.example/2/private'] },
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
  // Nothing can be pinned, so there is nothing to select.
  expect(all.disabled).toBe(true);
});

it.each(['Cancel', 'pagehide'])('denies on %s with an empty target decision', async (action) => {
  const { document } = await mount();
  if (action === 'Cancel') (document.querySelector('#deny') as HTMLButtonElement).click();
  else dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      approvedTargets: {},
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

it('shows expiry and keeps the window open when revocation refuses an already displayed approval', async () => {
  const { document, approve, all, picker } = await mount();
  send.mockImplementationOnce((_message, callback) => {
    callback({ error: 'This access request has expired. Please request access again.' });
  });
  approve.click();
  expect(dom.window.close).not.toHaveBeenCalled();
  expect(document.querySelector('#error')?.textContent).toContain('expired');
  expect(document.querySelector<HTMLElement>('#error')?.hidden).toBe(false);
  expect(approve.disabled).toBe(true);
  expect(all.disabled).toBe(true);
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(approve.disabled).toBe(true);
  expect(document.querySelector('#error')?.textContent).toContain('expired');
  (document.querySelector('#deny') as HTMLButtonElement).click();
  expect(dom.window.close).toHaveBeenCalledOnce();
  expect(
    send.mock.calls.filter(([message]) => message.type === 'SOLID_CONSENT_DECISION'),
  ).toHaveLength(1);
});

it.each([
  [[target('https://pod.example/docs/', 'container')], '1 folder and its contents'],
  [
    [
      target('https://pod.example/a/', 'container'),
      target('https://pod.example/b/', 'container'),
      target('https://pod.example/c', 'instance'),
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

it('shows truncation from the resolver while retaining the discovered scope', async () => {
  const initial = view();
  const { document } = await mount({
    ...initial,
    classes: [{ ...initial.classes[0], truncated: true }],
  });
  expect(document.querySelector('.class-item')?.textContent).toContain(
    'Some data could not be checked',
  );
  expect(document.querySelector('.targets')?.textContent).toBe('https://pod.example/1/private');
});

function mixedSourceView(): PendingConsentView {
  const initial = view();
  return {
    ...initial,
    classes: [
      {
        ...initial.classes[0],
        targets: [
          target('https://pod.example/1/contacts/', 'container', {
            id: 'sai-conforms',
            source: 'sai',
            check: 'conforms',
          }),
          target('https://pod.example/1/maybe/', 'container', {
            id: 'sai-unchecked',
            source: 'sai',
            preselected: false,
          }),
          target('https://pod.example/1/people.ttl', 'instance', { id: 'type-index' }),
        ],
      },
    ],
  };
}

it('groups targets by source, preselects confirmed ones and explains unconfirmed ones', async () => {
  const { document, approve, all } = await mount(mixedSourceView());
  const card = document.querySelector('.class-item')!;
  expect([...card.querySelectorAll('.target-group')].map((p) => p.textContent)).toEqual([
    'From your data registries',
    'From your type index',
  ]);
  const lists = card.querySelectorAll('ul.targets');
  expect(lists).toHaveLength(2);
  expect(lists[0].querySelectorAll('input')).toHaveLength(2);
  expect(lists[1].querySelectorAll('input')).toHaveLength(1);
  const box = (id: string) =>
    card.querySelector<HTMLInputElement>(`input[data-target-id="${id}"]`)!;
  expect(box('sai-conforms').checked).toBe(true);
  expect(box('sai-unchecked').checked).toBe(false);
  expect(box('type-index').checked).toBe(true);
  expect(box('sai-conforms').hasAttribute('aria-describedby')).toBe(false);
  expect(
    document.getElementById(box('sai-unchecked').getAttribute('aria-describedby')!)?.textContent,
  ).toBe("Couldn't confirm this holds contacts");
  expect(card.querySelector('details')!.open).toBe(true);
  expect(lists[0].textContent).toContain(
    'https://pod.example/1/contacts/ (folder and its contents)',
  );
  const classBox = card.querySelector<HTMLInputElement>('.class-head input')!;
  expect(classBox.checked).toBe(false);
  expect(classBox.indeterminate).toBe(true);
  expect(all.indeterminate).toBe(true);
  expect(document.querySelector('#selection-hint')?.textContent).toBe(
    '2 items selected. Only checked items will be shared.',
  );
  await expectAccessible(document);
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      profileId: '1',
      approvedTargets: { 'https://schema.org/Person': ['sai-conforms', 'type-index'] },
    },
    expect.any(Function),
  );
});

it('lets the person choose single targets and toggles a whole class from its box', async () => {
  const { document, approve } = await mount(mixedSourceView());
  const card = document.querySelector('.class-item')!;
  const box = (id: string) =>
    card.querySelector<HTMLInputElement>(`input[data-target-id="${id}"]`)!;
  const classBox = card.querySelector<HTMLInputElement>('.class-head input')!;
  box('sai-unchecked').click();
  expect(classBox.checked).toBe(true);
  expect(classBox.indeterminate).toBe(false);
  classBox.click();
  expect(
    [...card.querySelectorAll<HTMLInputElement>('[data-target-id]')].some((b) => b.checked),
  ).toBe(false);
  expect(approve.disabled).toBe(true);
  expect(document.querySelector('#selection-hint')?.textContent).toBe(
    'Choose at least one item to share.',
  );
  box('sai-unchecked').click();
  expect(document.querySelector('#selection-hint')?.textContent).toBe(
    '1 item selected. Only checked items will be shared.',
  );
  approve.click();
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      approvedTargets: { 'https://schema.org/Person': ['sai-unchecked'] },
    }),
    expect.any(Function),
  );
});

it('keeps the target list closed when every target is preselected', async () => {
  const { document } = await mount();
  expect(document.querySelector('details')!.open).toBe(false);
  expect(document.querySelector('.target-group')?.textContent).toBe('From your type index');
  expect(document.querySelector('.target-hint')).toBeNull();
});

it('lists whole-pod storage roots without source headings or unconfirmed hints', async () => {
  const { document } = await mount(storageView());
  expect(document.querySelector('.target-group')).toBeNull();
  expect(document.querySelector('.target-hint')).toBeNull();
  expect(document.querySelectorAll('[data-target-id]')).toHaveLength(2);
});
