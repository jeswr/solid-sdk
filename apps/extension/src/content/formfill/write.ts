// AUTHORED-BY Codex GPT-6.1-Sol
import { communicationValue, MAX_FORM_FILL_VALUE_LENGTH } from '../../shared/formfill-values';
import { detectField, type FormFillElement, fieldRefusalReason } from './detect';

export interface WriteOptions {
  readonly overwrite?: boolean;
}

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  uk: 'gb',
  gbr: 'gb',
  usa: 'us',
  'united states of america': 'united states',
  'great britain': 'united kingdom',
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function countryName(value: string): string {
  const normalized = normalize(value);
  const alias = COUNTRY_ALIASES[normalized] ?? normalized;
  if (/^[a-z]{2}$/.test(alias)) {
    return normalize(new Intl.DisplayNames(['en'], { type: 'region' }).of(alias.toUpperCase())!);
  }
  return alias;
}

/**
 * Call only after consent + frame policy checks. Returns whether a value was written.
 * Uses the element's own realm, bypassing per-element setters used by controlled inputs.
 * No submission, focus changes or listener installation; only input then change events.
 */
export function writeValue(
  element: FormFillElement,
  value: string,
  { overwrite = false }: WriteOptions = {},
): boolean {
  if (fieldRefusalReason(element)) return false;
  if (value.length > MAX_FORM_FILL_VALUE_LENGTH) return false;
  // Programmatic setters do not enforce maxlength. Skip rather than corrupt a value.
  if (element.tagName !== 'SELECT') {
    const { maxLength } = element as HTMLInputElement | HTMLTextAreaElement;
    if (maxLength >= 0 && value.length > maxLength) return false;
  }
  const kind =
    element.tagName === 'INPUT' && ['email', 'tel'].includes((element as HTMLInputElement).type)
      ? (element as HTMLInputElement).type
      : detectField(element)?.field;
  if (kind === 'email' || kind === 'tel') {
    const validated = communicationValue(value, kind);
    if (validated === null) return false;
    value = validated;
  }
  const hasValue =
    element.tagName === 'SELECT'
      ? Array.from((element as HTMLSelectElement).options).some(
          (option) => option.selected && option.value !== '',
        )
      : element.value !== '';
  if (!overwrite && hasValue) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  let prototype: object;
  let property = 'value';
  let nextValue: string | number = value;
  if (element.tagName === 'SELECT') {
    const options = Array.from((element as HTMLSelectElement).options);
    const eligible = (option: HTMLOptionElement) =>
      !option.disabled && !option.closest('optgroup[disabled]');
    let index = options.findIndex(
      (option) =>
        eligible(option) &&
        (normalize(option.value) === normalize(value) ||
          normalize(option.text) === normalize(value)),
    );
    // Country aliases ("GE", "UK") are only meaningful for country controls; elsewhere
    // they would map region codes such as Genève to unrelated countries.
    if (index === -1 && (kind === 'country' || kind === 'country-name')) {
      index = options.findIndex(
        (option) =>
          eligible(option) &&
          (countryName(option.value) === countryName(value) ||
            countryName(option.text) === countryName(value)),
      );
    }
    if (index === -1) return false;
    prototype = view.HTMLSelectElement.prototype;
    property = 'selectedIndex';
    nextValue = index;
  } else {
    prototype =
      element.tagName === 'TEXTAREA'
        ? view.HTMLTextAreaElement.prototype
        : view.HTMLInputElement.prototype;
  }
  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
  if (!setter) return false;
  const previousValue = element.value;
  setter.call(element, nextValue);
  // Native setters may sanitize unsupported numbers or line endings. Fail without events.
  if (property === 'value' && element.value !== nextValue) {
    setter.call(element, previousValue);
    return false;
  }
  element.dispatchEvent(new view.Event('input', { bubbles: true }));
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  return true;
}
