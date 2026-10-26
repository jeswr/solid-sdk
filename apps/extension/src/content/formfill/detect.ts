// AUTHORED-BY Codex GPT-6.1-Sol
/** DOM-only classification. Calling this module never writes values or installs listeners. */
export const FIELD_CATEGORIES = {
  name: 'contact',
  'given-name': 'contact',
  'family-name': 'contact',
  email: 'contact',
  tel: 'contact',
  organization: 'contact',
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'address',
  'address-level1': 'address',
  'address-level2': 'address',
  'postal-code': 'address',
  country: 'address',
  'country-name': 'address',
} as const;

export type FieldKind = keyof typeof FIELD_CATEGORIES;
export type FieldCategory = 'contact' | 'address';
export type FormFillElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface DetectedField {
  readonly element: FormFillElement;
  readonly field: FieldKind;
  readonly category: FieldCategory;
  readonly confidence: 'autocomplete' | 'heuristic';
}

export function autocompleteTokens(element: FormFillElement): string[] {
  return (element.getAttribute('autocomplete') ?? '').toLowerCase().trim().split(/\s+/);
}

/** Shared by detection, the consent gate and the writer; recheck at the time of writing. */
export function fieldRefusalReason(element: FormFillElement): string | null {
  const tokens = autocompleteTokens(element);
  if (
    (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'password') ||
    tokens.includes('current-password') ||
    tokens.includes('new-password')
  ) {
    return 'password-field';
  }
  if (tokens.some((token) => token.startsWith('cc-'))) return 'payment-field';
  if (tokens.includes('one-time-code')) return 'one-time-code-field';
  if (
    tokens.includes('off') ||
    element.form?.getAttribute('autocomplete')?.toLowerCase().trim() === 'off'
  ) {
    return 'autocomplete-off';
  }
  if (
    element.tagName === 'INPUT' &&
    !['text', 'email', 'tel', 'number'].includes((element as HTMLInputElement).type)
  ) {
    return 'unsupported-input-type';
  }
  if (element.matches(':disabled') || element.hasAttribute('readonly')) return 'uneditable-field';
  if (element.closest('[hidden], [inert]')) return 'hidden-field';
  const view = element.ownerDocument.defaultView;
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    ) {
      return 'hidden-field';
    }
  }
  return null;
}

/** A well-formed autocomplete naming a field we do not fill is 'unsupported', not a guess. */
function fromAutocomplete(tokens: string[]): FieldKind | 'unsupported' | null {
  // A trailing webauthn token is valid after any field (WHATWG autofill detail tokens).
  if (tokens.length > 1 && tokens[tokens.length - 1] === 'webauthn') tokens = tokens.slice(0, -1);
  let index = 0;
  if (tokens[index].startsWith('section-')) index++;
  if (tokens[index] === 'shipping' || tokens[index] === 'billing') index++;
  const contactHint = ['home', 'work', 'mobile', 'fax', 'pager'].includes(tokens[index]);
  if (contactHint) index++;
  const field = tokens[index];
  if (index !== tokens.length - 1 || !AUTOFILL_FIELD_NAMES.has(field)) return null;
  if (contactHint && !/^(tel(-.+)?|email|impp)$/.test(field)) return null;
  return Object.hasOwn(FIELD_CATEGORIES, field) ? (field as FieldKind) : 'unsupported';
}

// WHATWG autofill field names. An explicit but unsupported field (tel-extension,
// organization-title, address-level3, ...) must not fall through to label heuristics.
const AUTOFILL_FIELD_NAMES = new Set([
  'name',
  'honorific-prefix',
  'given-name',
  'additional-name',
  'family-name',
  'honorific-suffix',
  'nickname',
  'username',
  'new-password',
  'current-password',
  'one-time-code',
  'organization-title',
  'organization',
  'street-address',
  'address-line1',
  'address-line2',
  'address-line3',
  'address-level4',
  'address-level3',
  'address-level2',
  'address-level1',
  'country',
  'country-name',
  'postal-code',
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
  'transaction-currency',
  'transaction-amount',
  'language',
  'bday',
  'bday-day',
  'bday-month',
  'bday-year',
  'sex',
  'url',
  'photo',
  'tel',
  'tel-country-code',
  'tel-national',
  'tel-area-code',
  'tel-local',
  'tel-local-prefix',
  'tel-local-suffix',
  'tel-extension',
  'email',
  'impp',
]);

const HEURISTICS: readonly [FieldKind, RegExp][] = [
  ['given-name', /\b(first|given|fore)\s*name\b/],
  ['family-name', /\b(last|family)\s*name\b|\bsurname\b/],
  ['email', /\be\s*mail\b/],
  ['tel', /\b(tel|telephone|phone|mobile)\b/],
  ['address-line2', /\b(address\s*(line\s*)?2|apartment|apt|suite|unit|extended address)\b/],
  ['address-line1', /\b(address\s*(line\s*)?1|street and house number)\b/],
  ['postal-code', /\b(post\s*code|postal\s*code|zip\s*(code)?)\b/],
  ['country-name', /\bcountry\b/],
  ['address-level2', /\b(city|town|locality|suburb)\b/],
  ['address-level1', /\b(state|province|region|county)\b/],
  ['street-address', /\b(street|address)\b/],
  ['organization', /\b(company|organisation|organization|business)\b/],
  ['name', /^(name|full\s*name|your name|contact name|customer name|billing name|shipping name)$/],
];

function fromHeuristics(element: FormFillElement): FieldKind | null {
  const hints = [
    // Supported controls always have a labels list; hidden inputs were excluded above.
    ...Array.from(element.labels!, (label) => label.textContent!),
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('name') ?? '',
    element.id,
    element.getAttribute('placeholder') ?? '',
  ];
  for (const hint of hints) {
    const normalized = hint
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    for (const [field, pattern] of HEURISTICS) {
      if (pattern.test(normalized)) return field;
    }
  }
  return null;
}

/** Classify one control, also usable by the writer for communication format checks. */
export function detectField(element: FormFillElement): DetectedField | null {
  if (fieldRefusalReason(element)) return null;
  const autocomplete = fromAutocomplete(autocompleteTokens(element));
  if (autocomplete === 'unsupported') return null;
  const field = autocomplete ?? fromHeuristics(element);
  return field
    ? {
        element,
        field,
        category: FIELD_CATEGORIES[field],
        confidence: autocomplete ? 'autocomplete' : 'heuristic',
      }
    : null;
}

/** Autocomplete takes priority; labels, name, id and placeholder provide ordered fallbacks. */
export function detectFields(root: Document | HTMLFormElement): DetectedField[] {
  const fields: DetectedField[] = [];
  const elements =
    root.nodeType === 9
      ? root.querySelectorAll<FormFillElement>('input, textarea, select')
      : Array.from((root as HTMLFormElement).elements).filter(
          (element): element is FormFillElement => element.matches('input, textarea, select'),
        );
  for (const element of elements) {
    const field = detectField(element);
    if (field) fields.push(field);
  }
  return fields;
}
