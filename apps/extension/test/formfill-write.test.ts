// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormFillElement } from '../src/content/formfill/detect';
import { writeValue } from '../src/content/formfill/write';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mount(html: string): FormFillElement {
  document.body.innerHTML = `<form>${html}<button>Submit</button></form>`;
  return document.querySelector<FormFillElement>('input, textarea, select')!;
}

describe('writeValue', () => {
  it.each([
    '',
    '42',
  ])('restores a numeric telephone control after native sanitization (previous: %s)', (previous) => {
    const element = mount(`<input type="number" autocomplete="tel" value="${previous}">`);
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    const ownSetter = vi.fn((value: string) => native.set!.call(element, value));
    Object.defineProperty(element, 'value', {
      get: () => native.get!.call(element),
      set: ownSetter,
    });
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, '+441234567890', { overwrite: true })).toBe(false);
    expect(element.value).toBe(previous);
    expect(event).not.toHaveBeenCalled();
    expect(ownSetter).not.toHaveBeenCalled();
  });

  it.each([
    ['<input value="Old">', 'Alice\nExample'],
    ['<textarea>Old</textarea>', '1 Main Street\r\nFlat 2'],
  ])('restores controls when the native setter changes the supplied string: %s', (html, value) => {
    const element = mount(html);
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, value, { overwrite: true })).toBe(false);
    expect(element.value).toBe('Old');
    expect(event).not.toHaveBeenCalled();
  });

  it('still writes representable numbers and multiline textarea values', () => {
    const input = mount('<input type="number" autocomplete="tel">');
    expect(writeValue(input, '441234567890')).toBe(true);
    expect(input.value).toBe('441234567890');
    const textarea = mount('<textarea autocomplete="street-address"></textarea>');
    expect(writeValue(textarea, '1 Main Street\nFlat 2')).toBe(true);
    expect(textarea.value).toBe('1 Main Street\nFlat 2');
  });

  it.each([
    ['<input type="email" value="old@example.test">', 'javascript:alice@example.test'],
    ['<input autocomplete="home email" value="old@example.test">', 'bad@@example.test'],
    ['<input name="email" value="old@example.test">', 'alice@example..test'],
    ['<textarea autocomplete="email">old@example.test</textarea>', 'not an email'],
    ['<input type="email" value="old@example.test">', 'mailto:alice%GG@example.test'],
    ['<input type="email" value="old@example.test">', 'mailto:alice@example.test%0A'],
    ['<input type="email" value="old@example.test">', 'mailto:alice%0D%0ABcc%3Aother@example.test'],
    ['<input type="tel" value="123">', 'javascript:alert(1)'],
    ['<input autocomplete="tel" value="123">', 'CALL ME'],
    ['<input name="phone" value="123">', '---'],
  ])('rejects invalid communication values without overwriting or firing events: %s', (html, value) => {
    const element = mount(html);
    const previous = element.value;
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, value, { overwrite: true })).toBe(false);
    expect(element.value).toBe(previous);
    expect(event).not.toHaveBeenCalled();
  });

  it.each([
    ['<input type="email">', 'MAILTO:alice.smith+tag@example.test', 'alice.smith+tag@example.test'],
    ['<input type="email">', 'mailto:alice%2Btag@example.com', 'alice+tag@example.com'],
    ['<input autocomplete="email">', 'mailto:alice%25tag@example.test', 'alice%tag@example.test'],
    ['<input type="email">', 'mailto:alice%252Btag@example.test', 'alice%2Btag@example.test'],
    ['<input type="email">', 'alice%2Btag@example.test', 'alice%2Btag@example.test'],
    ['<input autocomplete="email">', 'alice%tag@example.test', 'alice%tag@example.test'],
    ['<input autocomplete="email">', 'alice@example.test', 'alice@example.test'],
    ['<input type="tel">', 'TEL:+44 (0)20-1234.5678', '+44 (0)20-1234.5678'],
    ['<input name="phone">', '12345', '12345'],
  ])('writes validated communication values and strips the matching scheme: %s', (html, value, expected) => {
    const element = mount(html);
    expect(writeValue(element, value)).toBe(true);
    expect(element.value).toBe(expected);
  });

  it.each([
    '<input>',
    '<textarea></textarea>',
    `<select><option value=""></option><option>${'a'.repeat(257)}</option></select>`,
  ])('refuses values over 256 characters without changing controls or firing events: %s', (html) => {
    const element = mount(html);
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, 'a'.repeat(257), { overwrite: true })).toBe(false);
    expect(element.value).toBe('');
    expect(event).not.toHaveBeenCalled();
  });

  it.each([
    ['<input maxlength="4" value="Old">', 'Alice'],
    ['<textarea maxlength="4">Old</textarea>', 'Alice'],
    ['<input type="email" maxlength="4" value="old@example.test">', 'alice@example.test'],
    ['<input autocomplete="email" maxlength="4" value="old@example.test">', 'alice@example.test'],
    ['<input type="tel" maxlength="4" value="123">', '+441234567890'],
    ['<input autocomplete="tel" maxlength="4" value="123">', '+441234567890'],
    ['<input maxlength="0">', 'Alice'],
  ])('skips values exceeding maxlength without truncating or changing existing data: %s', (html, value) => {
    const element = mount(html);
    const previous = element.value;
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, value, { overwrite: true })).toBe(false);
    expect(element.value).toBe(previous);
    expect(event).not.toHaveBeenCalled();
  });

  it('accepts values at maxlength and the global length limit', () => {
    expect(writeValue(mount('<input maxlength="4">'), 'Alice')).toBe(false);
    const input = mount('<input maxlength="4">');
    expect(writeValue(input, 'Alix')).toBe(true);
    expect(input.value).toBe('Alix');
    const textarea = mount('<textarea></textarea>');
    expect(writeValue(textarea, 'x'.repeat(256))).toBe(true);
    expect(textarea.value).toHaveLength(256);
  });

  it.each([
    'input',
    'textarea',
  ])('updates a React-style controlled %s via the native setter and bubbling events', (tag) => {
    const element = mount(`<${tag}></${tag}>`);
    const prototype = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const native = Object.getOwnPropertyDescriptor(prototype, 'value')!;
    let trackedValue = '';
    let renderedValue = '';
    const ownSetter = vi.fn((value: string) => {
      trackedValue = value;
      native.set!.call(element, value);
    });
    Object.defineProperty(element, 'value', {
      get: () => native.get!.call(element),
      set: ownSetter,
    });
    const events: string[] = [];
    const form = document.querySelector('form')!;
    form.addEventListener('input', (event) => {
      events.push(event.type);
      if (element.value !== trackedValue) {
        trackedValue = element.value;
        renderedValue = trackedValue;
      }
    });
    form.addEventListener('change', (event) => {
      events.push(event.type);
    });
    const submit = vi.fn();
    form.addEventListener('submit', submit);
    const requestSubmit = vi.spyOn(form, 'requestSubmit');
    expect(writeValue(element, 'Alice Example')).toBe(true);
    expect(element.value).toBe('Alice Example');
    expect(renderedValue).toBe('Alice Example');
    expect(ownSetter).not.toHaveBeenCalled();
    expect(events).toEqual(['input', 'change']);
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('preserves existing input, textarea and select values unless overwrite is explicit', () => {
    for (const html of [
      '<input value="Alice">',
      '<textarea>Alice</textarea>',
      '<select><option>Alice</option><option>Bob</option></select>',
    ]) {
      const element = mount(html);
      const input = vi.fn();
      element.addEventListener('input', input);
      expect(writeValue(element, 'Bob')).toBe(false);
      expect(element.value).toBe('Alice');
      expect(input).not.toHaveBeenCalled();
      expect(writeValue(element, 'Bob', { overwrite: true })).toBe(true);
      expect(element.value).toBe('Bob');
      expect(input).toHaveBeenCalledTimes(1);
    }
    expect(writeValue(mount('<input value=" ">'), 'Bob')).toBe(false);
  });

  it.each([
    ['ca', '<option value="CA">Canada</option>', 'CA'],
    ['  cAnAdA  ', '<option value="CA">Canada</option>', 'CA'],
    ['United Kingdom', '<option value="GB">Britain</option>', 'GB'],
    ['UK', '<option value="826">United Kingdom</option>', '826'],
    ['GBR', '<option value="826">United Kingdom</option>', '826'],
    ['USA', '<option value="840">United States</option>', '840'],
    ['United States of America', '<option value="US">US</option>', 'US'],
    ['Great Britain', '<option value="GB">GB</option>', 'GB'],
    ['DE', '<option value="276">Germany</option>', '276'],
  ])('matches select value/text or country alias %s', (value, option, expected) => {
    const element = mount(
      `<select autocomplete="country"><option value="">Choose</option>${option}</select>`,
    );
    const events: string[] = [];
    element.addEventListener('input', (event) => {
      events.push(event.type);
    });
    element.addEventListener('change', (event) => {
      events.push(event.type);
    });
    expect(writeValue(element, value)).toBe(true);
    expect(element.value).toBe(expected);
    expect(events).toEqual(['input', 'change']);
  });

  it.each([
    ['<select autocomplete="address-level1">', 'Georgia', '<option value="GE">Genève</option>'],
    ['<select name="region">', 'Georgia', '<option value="GE">Genève</option>'],
    ['<select>', 'UK', '<option value="826">United Kingdom</option>'],
  ])('does not apply country aliases outside country fields: %s %s', (open, value, option) => {
    const element = mount(`${open}<option value="">Choose</option>${option}</select>`);
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, value)).toBe(false);
    expect(element.value).toBe('');
    expect(event).not.toHaveBeenCalled();
  });

  it('skips disabled options and optgroups, and selects the matching duplicate by index', () => {
    const element = mount(`<select><option value="">Choose</option>
      <option disabled value="CA">Canada</option><optgroup disabled><option value="CA">Canada</option></optgroup>
      <option value="CA">Canada</option></select>`) as HTMLSelectElement;
    expect(writeValue(element, 'Canada')).toBe(true);
    expect(element.selectedIndex).toBe(3);
  });

  it('preserves a multi-select selection even if its first selected option is empty', () => {
    const element = mount(`<select multiple><option value="" selected>Choose</option>
      <option value="CA" selected>Canada</option><option value="GB">United Kingdom</option></select>`) as HTMLSelectElement;
    expect(writeValue(element, 'GB')).toBe(false);
    expect(
      Array.from(element.options)
        .filter((option) => option.selected)
        .map((option) => option.value),
    ).toEqual(['', 'CA']);
    expect(writeValue(element, 'GB', { overwrite: true })).toBe(true);
    expect(
      Array.from(element.options)
        .filter((option) => option.selected)
        .map((option) => option.value),
    ).toEqual(['GB']);
  });

  it('leaves unmatched selects unchanged without dispatching events', () => {
    const element = mount(
      '<select><option value="">Choose</option><option value="FR">France</option></select>',
    );
    const event = vi.fn();
    element.addEventListener('input', event);
    element.addEventListener('change', event);
    expect(writeValue(element, 'Atlantis')).toBe(false);
    expect(element.value).toBe('');
    expect(event).not.toHaveBeenCalled();
  });

  it.each([
    '<input type="password">',
    '<input type="text" name="email_password" autocomplete="current-password">',
    '<input type="email" autocomplete="section-login NEW-PASSWORD">',
    '<textarea autocomplete="current-password"></textarea>',
    '<select autocomplete="new-password"><option value=""></option><option>private data</option></select>',
    '<input autocomplete="cc-number">',
    '<input autocomplete="one-time-code">',
    '<input autocomplete="off">',
    '<input disabled>',
    '<input readonly>',
    '<input type="hidden">',
  ])('refuses unsafe controls even with overwrite: %s', (html) => {
    const element = mount(html);
    const event = vi.fn();
    element.addEventListener('input', event);
    expect(writeValue(element, 'private data', { overwrite: true })).toBe(false);
    expect(element.value).toBe('');
    expect(event).not.toHaveBeenCalled();
  });

  it('uses the native prototypes and Event constructor from the element realm', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = '<input>';
    const element = doc.querySelector('input')!;
    const listener = vi.fn();
    element.addEventListener('input', listener);
    expect(writeValue(element, 'Alice')).toBe(true);
    expect(element.value).toBe('Alice');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fails closed for documents without a window', () => {
    const doc = document.implementation.createHTMLDocument();
    expect(writeValue(doc.createElement('input'), 'Alice')).toBe(false);
  });

  it.each([
    undefined,
    { value: '' },
  ])('fails closed if the native value setter is unavailable: %s', (descriptor) => {
    const element = mount('<input>');
    const original = Object.getOwnPropertyDescriptor;
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((object, property) =>
      object === HTMLInputElement.prototype && property === 'value'
        ? descriptor
        : original(object, property),
    );
    expect(writeValue(element, 'Alice')).toBe(false);
    expect(element.value).toBe('');
  });
});
