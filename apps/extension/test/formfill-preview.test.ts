// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import type { FormFillPreview } from '../src/shared/messages';
import { expectAccessible } from './permission-a11y';

let dom: JSDOM;
let send: ReturnType<typeof vi.fn>;
const view = (profileId = '1'): FormFillPreview => ({
  requestId: 'fixture',
  origin: 'https://shop.example',
  profileId,
  profiles: [
    { id: '1', label: 'Personal' },
    { id: '2', label: 'Work' },
  ],
  values: [
    {
      field: 'name',
      category: 'contact',
      value: `<img src=x onerror=alert(1)> Person ${profileId}`,
    },
    { field: 'street-address', category: 'address', value: '42 Sample Street' },
  ],
  selected: profileId === '1' ? ['address'] : [],
});
async function mount(
  url = 'https://extension.example/formfill/preview.html?requestId=fixture',
  initial: FormFillPreview | null = view(),
  theme = 'light',
) {
  dom = new JSDOM(readFileSync(new URL('../src/formfill/preview.html', import.meta.url), 'utf8'), {
    url,
  });
  dom.window.localStorage.setItem('app-shell-theme', theme);
  send = vi.fn(async (message: { type: string; profileId?: string }) =>
    message.type === 'SOLID_FORMFILL_PREVIEW'
      ? message.profileId
        ? view(message.profileId)
        : initial
      : undefined,
  );
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  vi.spyOn(dom.window, 'close').mockImplementation(() => {});
  vi.resetModules();
  await import('../src/formfill/preview');
}
afterEach(() => {
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  'light',
  'dark',
])('renders accessible category cards in the saved %s theme', async (theme) => {
  await mount(undefined, view(), theme);
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('.category-card')).toHaveLength(2));
  expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
  for (const card of document.querySelectorAll('.category-card')) {
    expect(card.querySelector('legend')?.textContent).toBe(
      card.querySelector('.category-header label')?.textContent?.trim(),
    );
    const box = card.querySelector('input')!;
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toContain(
      'matching',
    );
    expect(card.querySelectorAll('dt')).toHaveLength(card.querySelectorAll('dd').length);
  }
  expect(document.querySelector('#remember')?.getAttribute('aria-describedby')).toBe(
    'remember-hint',
  );
  await expectAccessible(document);
});
it('labels native keyboard controls, renders values as text, and submits only checked categories', async () => {
  await mount();
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('dd')).toHaveLength(2));
  expect(document.querySelector('label[for="profile"]')?.textContent).toBe('Use account');
  expect(document.querySelector('#origin')?.textContent).toBe('https://shop.example');
  expect(document.querySelector('dd')?.textContent).toContain('<img src=x');
  expect(document.querySelector('#categories img')).toBeNull();
  const contact = document.querySelector('fieldset input') as HTMLInputElement;
  expect(contact.checked).toBe(false);
  expect(contact.closest('label')?.textContent).toContain('Contact details');
  const address = document.querySelectorAll<HTMLInputElement>('fieldset input')[1];
  expect(address.checked).toBe(true);
  expect(address.closest('label')?.textContent).toContain('Address');
  expect(document.querySelector('#fill')?.getAttribute('type')).toBe('submit');
  const fill = document.querySelector('#fill') as HTMLButtonElement;
  expect(fill.disabled).toBe(false);
  expect(fill.getAttribute('aria-describedby')).toBe('selection-hint');
  expect(document.getElementById('selection-hint')?.textContent).toBe(
    'Only the checked kinds of detail will be filled.',
  );
  document
    .querySelector('form')!
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(dom.window.close).toHaveBeenCalledOnce());
  expect(send).toHaveBeenLastCalledWith({
    type: 'SOLID_FORMFILL_DECISION',
    requestId: 'fixture',
    profileId: '1',
    categories: ['address'],
    remember: true,
  });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(send.mock.calls.filter(([m]) => m.type === 'SOLID_FORMFILL_DECISION')).toHaveLength(1);
});
it('requires a category on first use and updates the button and accessible explanation live', async () => {
  await mount(undefined, { ...view(), selected: [] });
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('dd')).toHaveLength(2));
  const fill = document.querySelector('#fill') as HTMLButtonElement;
  const hint = document.getElementById(fill.getAttribute('aria-describedby')!)!;
  const [contact, address] = document.querySelectorAll<HTMLInputElement>('fieldset input');
  expect(hint.getAttribute('aria-live')).toBe('polite');
  expect(hint.hidden).toBe(false);
  expect(hint.textContent).toBe('Choose at least one kind of detail to fill.');
  expect(fill.disabled).toBe(true);
  fill.click();
  document
    .querySelector('form')!
    .dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  expect(send).toHaveBeenCalledOnce();
  expect(dom.window.close).not.toHaveBeenCalled();
  contact.click();
  expect(fill.disabled).toBe(false);
  expect(hint.textContent).toBe('Only the checked kinds of detail will be filled.');
  address.click();
  contact.click();
  expect(fill.disabled).toBe(false);
  address.click();
  expect(fill.disabled).toBe(true);
  expect(hint.textContent).toBe('Choose at least one kind of detail to fill.');
  contact.click();
  fill.click();
  await vi.waitFor(() => expect(dom.window.close).toHaveBeenCalledOnce());
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ categories: ['contact'], remember: false }),
  );
  address.click();
  expect(fill.disabled).toBe(true);
});
it('updates the preview on profile selection and clears previous category choices', async () => {
  await mount();
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('dd')).toHaveLength(2));
  const picker = document.querySelector('select')!;
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
  await vi.waitFor(() => expect(document.querySelector('dd')?.textContent).toContain('Person 2'));
  expect(
    [...document.querySelectorAll<HTMLInputElement>('fieldset input')].every((box) => !box.checked),
  ).toBe(true);
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('#selection-hint')?.textContent).toBe(
    'Choose at least one kind of detail to fill.',
  );
  (document.querySelector('fieldset input') as HTMLInputElement).click();
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(false);
  document
    .querySelector('form')!
    .dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(dom.window.close).toHaveBeenCalledOnce());
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ profileId: '2', categories: ['contact'], remember: false }),
  );
});
it('keeps Fill disabled if remembered categories have no matching values', async () => {
  await mount(undefined, { ...view(), values: [view().values[0]] });
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('dd')).toHaveLength(1));
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('#selection-hint')?.textContent).toBe(
    'Choose at least one kind of detail to fill.',
  );
});
it('keeps Fill disabled when there are no available values', async () => {
  await mount(undefined, { ...view(), values: [] });
  const document = dom.window.document;
  await vi.waitFor(() =>
    expect((document.querySelector('#profile') as HTMLSelectElement).disabled).toBe(false),
  );
  expect(document.querySelectorAll('fieldset input')).toHaveLength(0);
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
  expect((document.querySelector('#empty') as HTMLElement).hidden).toBe(false);
});
it('does not enable Fill from old category controls during a profile load or after failure', async () => {
  await mount();
  const document = dom.window.document;
  await vi.waitFor(() => expect(document.querySelectorAll('dd')).toHaveLength(2));
  let reject!: (error: Error) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectLoad) => {
        reject = rejectLoad;
      }),
  );
  const picker = document.querySelector('select')!;
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  const contact = document.querySelector('fieldset input') as HTMLInputElement;
  const fill = document.querySelector('#fill') as HTMLButtonElement;
  contact.click();
  expect(fill.disabled).toBe(true);
  reject(new Error('Load failed'));
  await vi.waitFor(() =>
    expect(document.querySelector('#error')?.textContent).toContain('Could not load'),
  );
  contact.click();
  expect(fill.disabled).toBe(true);
  picker.value = '1';
  picker.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(fill.disabled).toBe(false));
  expect(document.querySelector('#error')?.textContent).toBe('');
  expect(document.querySelector<HTMLElement>('#error')?.hidden).toBe(true);
});
it('keeps Fill disabled when the request has expired', async () => {
  await mount(undefined, null);
  const document = dom.window.document;
  await vi.waitFor(() =>
    expect(document.querySelector('#error')?.textContent).toContain('expired'),
  );
  expect((document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
});
it.each(['Escape', 'Cancel', 'close'])('denies on %s without sending values', async (action) => {
  await mount();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  if (action === 'Escape')
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  else if (action === 'Cancel')
    (dom.window.document.querySelector('#cancel') as HTMLButtonElement).click();
  else dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await vi.waitFor(() => expect(dom.window.close).toHaveBeenCalledOnce());
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'SOLID_FORMFILL_DECISION', categories: [] }),
  );
});
it('disables filling when the request is absent or expired', async () => {
  await mount('https://extension.example/formfill/preview.html');
  expect(send).not.toHaveBeenCalled();
  expect((dom.window.document.querySelector('#fill') as HTMLButtonElement).disabled).toBe(true);
  expect(dom.window.document.querySelector('#error')?.textContent).toContain('unavailable');
});
