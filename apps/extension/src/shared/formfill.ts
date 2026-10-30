// AUTHORED-BY Codex GPT-6.1-Sol
import type { FormFillData } from '../background/core/formfill-data';
import { FIELD_CATEGORIES, type FieldCategory, type FieldKind } from '../content/formfill/detect';

export interface FormFillField {
  readonly field: FieldKind;
  readonly category: FieldCategory;
}
export interface FormFillValue extends FormFillField {
  readonly value: string;
}

export const FIELD_LABELS: Record<FieldKind, string> = {
  name: 'Full name',
  'given-name': 'First name',
  'family-name': 'Last name',
  email: 'Email',
  tel: 'Phone',
  organization: 'Organization',
  'street-address': 'Street address',
  'address-line1': 'Address line 1',
  'address-line2': 'Address line 2',
  'address-level1': 'State or region',
  'address-level2': 'City',
  'postal-code': 'Postal code',
  country: 'Country',
  'country-name': 'Country',
};

/** Validate the entire bounded request; a forged field/category pair fails closed. */
export function formFillFields(raw: unknown): FormFillField[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return [];
  const fields = new Map<FieldKind, FormFillField>();
  for (const f of raw) {
    if (
      !f ||
      typeof f !== 'object' ||
      !Object.hasOwn(FIELD_CATEGORIES, f.field) ||
      FIELD_CATEGORIES[f.field as FieldKind] !== f.category
    )
      return [];
    fields.set(f.field, { field: f.field, category: f.category });
  }
  return [...fields.values()];
}

export function formFillValues(
  data: FormFillData,
  fields: readonly FormFillField[],
): FormFillValue[] {
  const { contact: c, address: a } = data;
  const values: Record<FieldKind, string | null> = {
    name: c.name,
    'given-name': c.givenName,
    'family-name': c.familyName,
    email: c.email,
    tel: c.tel,
    organization: c.organization,
    'street-address': a.streetAddress,
    'address-line1': a.streetAddress,
    'address-line2': a.extendedAddress,
    'address-level1': a.region,
    'address-level2': a.locality,
    'postal-code': a.postalCode,
    country: a.countryName,
    'country-name': a.countryName,
  };
  return fields.flatMap((f) => (values[f.field] ? [{ ...f, value: values[f.field]! }] : []));
}
