// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { detectFields, FIELD_CATEGORIES } from '../src/content/formfill/detect';
import { forms } from './fixtures/forms/corpus';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('detectFields fixture corpus', () => {
  it.each(forms)('$name', ({ html, expected, confidence }) => {
    document.body.innerHTML = html;
    const fields = detectFields(document);
    expect(Object.fromEntries(fields.map(({ element, field }) => [element.id, field]))).toEqual(
      expected,
    );
    for (const result of fields) {
      expect(result.confidence).toBe(confidence);
      expect(result.category).toBe(FIELD_CATEGORIES[result.field]);
    }
    expect(detectFields(document.querySelector('form')!)).toEqual(fields);
  });
});

describe('detection precedence and safety', () => {
  it.each([
    ['Company address', 'street-address'],
    ['Business street', 'street-address'],
    ['Organization address line 1', 'address-line1'],
    ['Company address line 2', 'address-line2'],
    ['Company postcode', 'postal-code'],
    ['Business postal code', 'postal-code'],
  ])('classifies %s as address data before generic organization hints', (label, field) => {
    document.body.innerHTML = `<label for="company">${label}</label><input id="company">`;
    expect(detectFields(document)).toMatchObject([
      { field, category: 'address', confidence: 'heuristic' },
    ]);
  });

  it.each([
    ['tel-extension', 'phone_extension'],
    ['organization-title', 'company_role'],
    ['address-level3', 'street_district'],
    ['section-a shipping address-line3', 'address_line_3'],
    ['work tel-extension', 'phone_ext'],
    ['tel-extension webauthn', 'phone_extension'],
    ['section- tel-extension', 'phone_extension'],
  ])('skips explicit unsupported autocomplete %s instead of guessing from %s', (token, name) => {
    document.body.innerHTML = `<input id="x" name="${name}" autocomplete="${token}">`;
    expect(detectFields(document)).toEqual([]);
  });

  it('accepts a bare section- prefix and a trailing webauthn token', () => {
    document.body.innerHTML = `<input id="a" name="company" autocomplete="section- email">
      <input id="b" name="company" autocomplete="shipping tel webauthn">`;
    expect(detectFields(document).map(({ field }) => field)).toEqual(['email', 'tel']);
  });

  it('still uses heuristics when autocomplete is absent, on, or not a field name', () => {
    document.body.innerHTML = `<input id="a" name="phone">
      <input id="b" name="phone" autocomplete="on"><input id="c" name="phone" autocomplete="nope">`;
    expect(detectFields(document).map(({ field }) => field)).toEqual(['tel', 'tel', 'tel']);
  });

  it('uses autocomplete before labels, then labels before names, IDs and placeholders', () => {
    document.body.innerHTML = `<form>
      <label for="a">Surname</label><input id="a" name="firstName" autocomplete="EMAIL">
      <label for="b">Telephone</label><input id="b" name="email" placeholder="Surname">
      <input id="email" name="firstName" placeholder="Surname">
      <input id="familyName" placeholder="Email"><input id="unknown" placeholder="Company">
      <input name="username"><input name="message"><input autocomplete="toString">
    </form>`;
    expect(detectFields(document).map(({ field, confidence }) => [field, confidence])).toEqual([
      ['email', 'autocomplete'],
      ['tel', 'heuristic'],
      ['given-name', 'heuristic'],
      ['family-name', 'heuristic'],
      ['organization', 'heuristic'],
    ]);
  });

  it.each(['home', 'work', 'mobile', 'fax', 'pager'])('accepts the %s contact hint', (hint) => {
    document.body.innerHTML = `<input autocomplete="  section-A\tshipping ${hint} email  ">
      <input autocomplete="billing ${hint} tel">`;
    expect(detectFields(document).map(({ field }) => field)).toEqual(['email', 'tel']);
  });

  it.each([
    'home name',
    'webauthn',
    'email webauthn webauthn',
    'email unexpected',
    'shipping section-A email',
    'home',
    'on',
  ])('ignores invalid or unsupported autocomplete %s and falls back', (tokens) => {
    document.body.innerHTML = `<input name="company" autocomplete="${tokens}">`;
    expect(detectFields(document)[0]).toMatchObject({
      field: 'organization',
      confidence: 'heuristic',
    });
  });

  it.each([
    '<input type="hidden" autocomplete="email">',
    '<input type="password" autocomplete="email">',
    '<input type="text" name="email_password" autocomplete="current-password">',
    '<input type="email" name="email" autocomplete="section-login NEW-PASSWORD">',
    '<textarea name="email" autocomplete="current-password"></textarea>',
    '<select name="email" autocomplete="new-password"><option></option></select>',
    '<input type="checkbox" name="email">',
    '<input type="radio" name="email">',
    '<input type="file" name="email">',
    '<input type="submit" name="email">',
    '<input type="button" name="email">',
    '<input type="date" name="email">',
    '<input disabled autocomplete="email">',
    '<fieldset disabled><input autocomplete="email"></fieldset>',
    '<textarea readonly autocomplete="street-address"></textarea>',
    '<div hidden><input autocomplete="email"></div>',
    '<div inert><input autocomplete="email"></div>',
    '<div style="display:none"><input autocomplete="email"></div>',
    '<input style="visibility:hidden" autocomplete="email">',
    '<input style="visibility:collapse" autocomplete="email">',
    '<input autocomplete="OFF" name="email">',
    '<form autocomplete=" off "><input autocomplete="email"></form>',
    '<input autocomplete="section-a billing CC-NUMBER" name="email">',
    '<input autocomplete="cc-name" name="name">',
    '<input autocomplete="cc-exp-year" name="postal_code">',
    '<input autocomplete="one-time-code" name="phone">',
  ])('excludes unsafe or unavailable fields: %s', (html) => {
    document.body.innerHTML = html;
    expect(detectFields(document)).toEqual([]);
  });

  it('accepts numeric postal controls, aria labels, empty labels and documents without a window', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = `<form><input type="number" autocomplete="postal-code">
      <input aria-label="Email"><label for="blank"></label><input id="blank" placeholder="Telephone">
      <input name="unrecognized"></form>`;
    expect(detectFields(doc).map(({ field }) => field)).toEqual(['postal-code', 'email', 'tel']);
  });

  it('limits a form root to that form and leaves the DOM untouched', () => {
    document.body.innerHTML =
      '<form><input name="email" value="existing"></form><form><input name="name"></form>';
    const before = document.body.innerHTML;
    expect(detectFields(document.querySelector('form')!)).toHaveLength(1);
    expect(document.body.innerHTML).toBe(before);
  });

  it('detects controls by form ownership, including external controls and reassigned descendants', () => {
    document.body.innerHTML = `<input id="external-email" form="checkout" autocomplete="email">
      <form id="checkout"><fieldset><input id="owned" autocomplete="given-name"></fieldset>
        <input id="reassigned" form="other" autocomplete="family-name"><button>Submit</button>
        <output name="email">Ignored</output></form>
      <form id="other"><input id="foreign" autocomplete="organization"></form>
      <textarea id="external-address" form="checkout" autocomplete="street-address"></textarea>
      <select id="external-country" form="checkout" autocomplete="country"><option>GB</option></select>`;
    const before = document.body.innerHTML;
    const ids = (root: Document | HTMLFormElement) =>
      detectFields(root).map(({ element }) => element.id);
    expect(ids(document.querySelector<HTMLFormElement>('#checkout')!)).toEqual([
      'external-email',
      'owned',
      'external-address',
      'external-country',
    ]);
    expect(ids(document.querySelector<HTMLFormElement>('#other')!)).toEqual([
      'reassigned',
      'foreign',
    ]);
    expect(ids(document)).toEqual([
      'external-email',
      'owned',
      'reassigned',
      'foreign',
      'external-address',
      'external-country',
    ]);
    expect(document.body.innerHTML).toBe(before);
  });
});
