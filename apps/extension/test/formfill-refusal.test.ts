// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectFields } from '../src/content/formfill/detect';
import { type RefusalInputs, refusalReason } from '../src/content/formfill/refusal';

let inputs: RefusalInputs;
beforeEach(() => {
  document.body.innerHTML = '<input autocomplete="email">';
  inputs = {
    url: 'https://shop.example/checkout',
    isTopFrame: true,
    frameOrigin: 'https://shop.example',
    topOrigin: 'https://shop.example',
    field: detectFields(document)[0],
    consentedCategories: new Set(['contact']),
  };
});

describe('refusalReason', () => {
  it('permits a consented field on HTTPS and in same-origin frames', () => {
    expect(refusalReason(inputs)).toBeNull();
    expect(refusalReason({ ...inputs, isTopFrame: false })).toBeNull();
    expect(refusalReason({ ...inputs, frameOrigin: 'https://SHOP.example:443/' })).toBeNull();
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://[::1]:3000',
  ])('permits loopback HTTP: %s', (origin) => {
    expect(
      refusalReason({ ...inputs, url: `${origin}/form`, frameOrigin: origin, topOrigin: origin }),
    ).toBeNull();
  });

  it.each(['url', 'frameOrigin', 'topOrigin'] as const)('fails closed on unparseable %s', (key) => {
    expect(refusalReason({ ...inputs, [key]: 'not a URL' })).toBe('invalid-url');
    expect(refusalReason({ ...inputs, [key]: '' })).toBe('invalid-url');
  });

  it.each([
    'http://shop.example',
    'http://localhost.evil.example',
    'ftp://shop.example',
    'file:///tmp/form',
    'data:text/html,hello',
    'about:blank',
  ])('refuses insecure or opaque URLs: %s', (url) => {
    expect(refusalReason({ ...inputs, url })).toBe('insecure-page');
  });

  it('checks transport for frame and top metadata too', () => {
    expect(refusalReason({ ...inputs, frameOrigin: 'http://shop.example' })).toBe('insecure-page');
    expect(refusalReason({ ...inputs, topOrigin: 'http://shop.example' })).toBe('insecure-page');
  });

  it('refuses cross-origin iframes, including different ports and schemes', () => {
    for (const topOrigin of [
      'https://other.example',
      'https://shop.example:444',
      'http://localhost',
    ]) {
      expect(refusalReason({ ...inputs, isTopFrame: false, topOrigin })).toBe('cross-origin-frame');
    }
  });

  it('refuses inconsistent page/frame and top-frame origins', () => {
    expect(refusalReason({ ...inputs, frameOrigin: 'https://other.example' })).toBe(
      'origin-mismatch',
    );
    expect(refusalReason({ ...inputs, topOrigin: 'https://other.example' })).toBe(
      'origin-mismatch',
    );
  });

  it.each([
    ['type', 'password', 'password-field'],
    ['autocomplete', 'current-password', 'password-field'],
    ['autocomplete', 'section-login NEW-PASSWORD', 'password-field'],
    ['autocomplete', 'cc-name', 'payment-field'],
    ['autocomplete', 'one-time-code', 'one-time-code-field'],
    ['autocomplete', 'off', 'autocomplete-off'],
    ['readonly', '', 'uneditable-field'],
  ])('rechecks a detected field after %s changes to %s', (attribute, value, reason) => {
    inputs.field.element.setAttribute(attribute, value);
    expect(refusalReason(inputs)).toBe(reason);
  });

  it('requires the specific category, even when another category is consented', () => {
    expect(refusalReason({ ...inputs, consentedCategories: new Set() })).toBe(
      'category-not-consented',
    );
    expect(refusalReason({ ...inputs, consentedCategories: new Set(['address']) })).toBe(
      'category-not-consented',
    );
    document.body.innerHTML = '<input autocomplete="street-address">';
    const field = detectFields(document)[0];
    expect(refusalReason({ ...inputs, field })).toBe('category-not-consented');
    expect(
      refusalReason({ ...inputs, field, consentedCategories: new Set(['address']) }),
    ).toBeNull();
  });
});
