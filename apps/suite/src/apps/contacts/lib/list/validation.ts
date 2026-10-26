// AUTHORED-BY Codex GPT-6.1-Sol
import { normaliseEmail, normalisePhone } from "../dedupe/normalise";
import type { ListContact, ListOptions } from "./types";

export type ContactListErrorCode =
  | "invalid-contact"
  | "duplicate-id"
  | "invalid-options"
  | "invalid-query";

/** Typed failures never echo contact details or search text. */
export class ContactListError extends Error {
  override readonly name = "ContactListError";
  constructor(readonly code: ContactListErrorCode) {
    super(`Contact list: ${code}`);
  }
}

function record(value: unknown, allowed: readonly string[], code: ContactListErrorCode): void {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new ContactListError(code);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key) as PropertyDescriptor;
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new ContactListError(code);
    }
  }
}

export function text(value: unknown, code: ContactListErrorCode): asserts value is string {
  if (typeof value !== "string" || !value.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new ContactListError(code);
  }
}

function nonblank(value: unknown): void {
  text(value, "invalid-contact");
  if (!value.trim()) throw new ContactListError("invalid-contact");
}

function array(value: unknown): void {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new ContactListError("invalid-contact");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) throw new ContactListError("invalid-contact");
  for (const key of keys) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key) as PropertyDescriptor;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new ContactListError("invalid-contact");
    }
  }
}

export function validateContacts(contacts: readonly ListContact[]): void {
  array(contacts);
  const ids = new Set<string>();
  for (const contact of contacts) {
    record(
      contact,
      ["id", "displayName", "givenName", "familyName", "emails", "phones", "organization"],
      "invalid-contact",
    );
    nonblank(contact.id);
    if (ids.has(contact.id)) throw new ContactListError("duplicate-id");
    ids.add(contact.id);
    for (const field of ["displayName", "givenName", "familyName", "organization"] as const) {
      if (Object.hasOwn(contact, field)) nonblank(contact[field]);
    }
    for (const field of ["emails", "phones"] as const) {
      if (!Object.hasOwn(contact, field)) continue;
      const values = contact[field];
      array(values);
      for (const value of values as readonly string[]) {
        nonblank(value);
        try {
          if (field === "emails") normaliseEmail(value);
          else normalisePhone(value);
        } catch {
          throw new ContactListError("invalid-contact");
        }
      }
    }
  }
}

export function context(options: ListOptions) {
  record(options, ["locale", "nameOrder"], "invalid-options");
  const locale = options.locale === undefined ? "en" : options.locale;
  const nameOrder = options.nameOrder === undefined ? "given-family" : options.nameOrder;
  if (
    typeof locale !== "string" ||
    !locale ||
    !["given-family", "family-given"].includes(nameOrder)
  ) {
    throw new ContactListError("invalid-options");
  }
  try {
    const requested = new Intl.Locale(locale);
    // Only base locales: unsupported extension requests must not silently fall back.
    if (requested.toString() !== requested.baseName) throw new ContactListError("invalid-options");
    if (
      Intl.Collator.supportedLocalesOf([locale]).length !== 1 ||
      Intl.Segmenter.supportedLocalesOf([locale]).length !== 1
    ) {
      throw new ContactListError("invalid-options");
    }
    return {
      locale,
      nameOrder,
      collator: new Intl.Collator(locale, { usage: "sort", sensitivity: "base" }),
      graphemes: new Intl.Segmenter(locale, { granularity: "grapheme" }),
      words: new Intl.Segmenter(locale, { granularity: "word" }),
    };
  } catch {
    throw new ContactListError("invalid-options");
  }
}

export type ListContext = ReturnType<typeof context>;
