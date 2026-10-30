// AUTHORED-BY Codex GPT-6.1-Sol
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFormFill } from '../src/content/formfill-controller';
import type { FormFillResponse } from '../src/shared/messages';

let dom: JSDOM;
let cleanup: () => void;
let receive: (message: unknown, sender: unknown) => void;
let roots: ShadowRoot[];
let send: ReturnType<typeof vi.fn>;
let response: FormFillResponse;
const html = `<form><label>Name<input id="name" autocomplete="name"></label><label>Address<input id="address" autocomplete="street-address"></label><input id="password" type="password"><button type="submit">Submit</button></form>`;
function mount(content = html, url = 'https://shop.example/checkout') {
  dom = new JSDOM(content, { url });
  const original = dom.window.Element.prototype.attachShadow;
  vi.spyOn(dom.window.Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    expect(init.mode).toBe('closed');
    const root = original.call(this, init);
    roots.push(root);
    return root;
  });
  cleanup = installFormFill(dom.window as unknown as Window & typeof globalThis);
}
function trigger() {
  (dom.window.document.getElementById('name') as HTMLInputElement).focus();
  receive({ type: 'SOLID_FORMFILL_TRIGGER' }, { id: 'ours' });
}
beforeEach(() => {
  roots = [];
  response = {
    origin: 'https://shop.example',
    values: [{ field: 'name', category: 'contact', value: 'Alex' }],
  };
  send = vi.fn(async (message: { type: string }) =>
    message.type === 'SOLID_FORMFILL_REQUEST' ? response : { ok: true },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ours',
      sendMessage: send,
      onMessage: {
        addListener: (fn: typeof receive) => {
          receive = fn;
        },
        removeListener: vi.fn(),
      },
    },
  });
});
afterEach(() => {
  cleanup?.();
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders one closed-shadow button by the first recognised field, with accessible label and no automatic request', () => {
  mount();
  const hosts = dom.window.document.querySelectorAll('[data-solid-formfill]');
  expect(hosts).toHaveLength(1);
  expect(hosts[0].shadowRoot).toBeNull();
  expect(hosts[0].previousElementSibling?.id).toBe('name');
  expect(roots[0].querySelector('button')?.getAttribute('aria-label')).toBe('Fill from pod');
  expect(send).not.toHaveBeenCalled();
  const button = roots[0].querySelector('button')!;
  button.click();
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ' }));
  expect(send).not.toHaveBeenCalled();
});
// jsdom has no trusted input source; invoke captured listeners with browser metadata.
it('accepts only trusted click and Enter/Space activation', async () => {
  const handlers = new Map<string, EventListener>();
  dom = new JSDOM(html, { url: 'https://shop.example/checkout' });
  const add = dom.window.HTMLButtonElement.prototype.addEventListener;
  vi.spyOn(dom.window.HTMLButtonElement.prototype, 'addEventListener').mockImplementation(function (
    this: HTMLButtonElement,
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    handlers.set(type, fn as EventListener);
    add.call(this, type, fn, options);
  });
  cleanup = installFormFill(dom.window as unknown as Window & typeof globalThis);
  const click = handlers.get('click')!;
  const keydown = handlers.get('keydown')!;
  for (const trusted of [false, true]) {
    const before = send.mock.calls.length;
    click({ isTrusted: trusted } as Event);
    await vi.waitFor(() => expect(send.mock.calls.length).toBe(before + (trusted ? 2 : 0)));
  }
  for (const key of ['a', 'Enter', ' ']) {
    const before = send.mock.calls.length;
    keydown({ isTrusted: true, key, repeat: false, preventDefault: vi.fn() } as unknown as Event);
    await vi.waitFor(() => expect(send.mock.calls.length).toBe(before + (key === 'a' ? 0 : 2)));
  }
  expect(send.mock.calls.filter(([m]) => m.type === 'SOLID_FORMFILL_REQUEST')).toHaveLength(3);
});
it.each([
  ['<form autocomplete="off"><input autocomplete="name"></form>', 'https://shop.example'],
  [
    '<form><input autocomplete="cc-number"><input autocomplete="one-time-code"><input type="password"></form>',
    'https://shop.example',
  ],
  [html, 'http://remote.example'],
])('renders no icon for refused forms or insecure pages', (content, url) => {
  mount(content, url);
  expect(roots).toHaveLength(0);
  expect(send).not.toHaveBeenCalled();
});
it('adds icons for late forms and removes them when the form becomes refused', async () => {
  mount('<main></main>');
  dom.window.document.body.insertAdjacentHTML('beforeend', html);
  await vi.waitFor(() => expect(roots).toHaveLength(1));
  dom.window.document.querySelector('form')!.setAttribute('autocomplete', 'off');
  await vi.waitFor(() =>
    expect(dom.window.document.querySelector('[data-solid-formfill]')).toBeNull(),
  );
});
it('requests only field/category metadata and writes approved values without overwriting or submitting', async () => {
  mount();
  const submit = vi.fn();
  dom.window.document.querySelector('form')!.addEventListener('submit', submit);
  trigger();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[0][0]).toEqual({
    type: 'SOLID_FORMFILL_REQUEST',
    fields: [
      { field: 'name', category: 'contact' },
      { field: 'street-address', category: 'address' },
    ],
  });
  expect((dom.window.document.getElementById('name') as HTMLInputElement).value).toBe('Alex');
  expect((dom.window.document.getElementById('address') as HTMLInputElement).value).toBe('');
  trigger();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
  expect(send.mock.calls.at(-1)![0]).toEqual({
    type: 'SOLID_FORMFILL_REPORT',
    filled: 0,
    skipped: 2,
  });
  expect(submit).not.toHaveBeenCalled();
});
it('rechecks field refusal and classification after the preview, preserving newly entered data', async () => {
  mount();
  let release!: (value: FormFillResponse) => void;
  send.mockImplementation((message: { type: string }) =>
    message.type === 'SOLID_FORMFILL_REQUEST'
      ? new Promise<FormFillResponse>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(),
  );
  trigger();
  const name = dom.window.document.getElementById('name') as HTMLInputElement;
  const address = dom.window.document.getElementById('address') as HTMLInputElement;
  name.type = 'password';
  address.value = 'Typed while reviewing';
  release({
    origin: 'https://shop.example',
    values: [
      ...response.values,
      { field: 'street-address', category: 'address', value: '42 Sample Street' },
    ],
  });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(name.value).toBe('');
  expect(address.value).toBe('Typed while reviewing');
});
it('drops another-origin replies, page messages and forged worker triggers', async () => {
  mount();
  response = { ...response, origin: 'https://elsewhere.example' };
  receive({ type: 'SOLID_FORMFILL_TRIGGER' }, { id: 'foreign' });
  receive({ type: 'SOLID_FORMFILL_TRIGGER' }, { id: 'ours', tab: { id: 3 } });
  expect(send).not.toHaveBeenCalled();
  trigger();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect((dom.window.document.getElementById('name') as HTMLInputElement).value).toBe('');
});

it('refuses cross-origin iframe icons and worker triggers locally', async () => {
  dom = new JSDOM('<iframe src="https://embedded.example/"></iframe>', {
    url: 'https://shop.example/',
  });
  const frame = dom.window.document.querySelector('iframe')!.contentWindow!;
  frame.document.write(html);
  cleanup = installFormFill(frame as unknown as Window & typeof globalThis);
  expect(frame.document.querySelector('[data-solid-formfill]')).toBeNull();
  (frame.document.getElementById('name') as HTMLInputElement).focus();
  receive({ type: 'SOLID_FORMFILL_TRIGGER' }, { id: 'ours' });
  expect(send).not.toHaveBeenCalled();
});
