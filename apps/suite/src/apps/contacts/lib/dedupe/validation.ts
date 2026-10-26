// AUTHORED-BY Codex GPT-6.1-Sol
import { DedupeError, type DedupeErrorCode, text } from "./errors";
import { normaliseEmail, normalisePhone, validateCountryCode, validateWebId } from "./normalise";
import type { DedupeContact, DedupeOptions } from "./types";

export interface PreparedContact {
  id: string;
  fields: Record<string, string>;
  multiFields: Record<string, string[]>;
  webIds: string[];
  emails: string[];
  phones: string[];
}

function record(value: unknown, code: DedupeErrorCode): void {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string")
  ) {
    throw new DedupeError(code);
  }
  // Only enumerable data properties: do not execute getters or drop hidden fields.
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new DedupeError(code);
    }
  }
}

function stringValue(value: string): string {
  text(value, "invalid-contact");
  return value;
}

function strings(value: readonly string[], normalise: (value: string) => string): string[] {
  if (!Array.isArray(value)) throw new DedupeError("invalid-contact");
  const result = new Set<string>();
  for (const item of value) result.add(normalise(item));
  return [...result].sort();
}

/** Fresh records and arrays; no mutation or retention of mutable input containers. */
export function prepareContacts(
  contacts: readonly DedupeContact[],
  options: DedupeOptions,
): PreparedContact[] {
  record(options, "invalid-options");
  if (Object.keys(options).some((key) => key !== "defaultCountryCallingCode")) {
    throw new DedupeError("invalid-options");
  }
  validateCountryCode(options.defaultCountryCallingCode);
  if (!Array.isArray(contacts)) throw new DedupeError("invalid-contact");
  const byId = new Map<string, PreparedContact>();
  const scalarNames = new Set<string>();
  const multiNames = new Set<string>();
  for (const contact of contacts) {
    record(contact, "invalid-contact");
    if (
      Object.keys(contact).some(
        (key) => !["id", "fields", "multiFields", "webIds", "emails", "phones"].includes(key),
      )
    ) {
      throw new DedupeError("invalid-contact");
    }
    text(contact.id, "invalid-contact");
    if (byId.has(contact.id)) throw new DedupeError("duplicate-id");
    const fields = contact.fields ?? {};
    const multiFields = contact.multiFields ?? {};
    // Explicit null is unsupported, rather than another spelling of an omitted field.
    if (contact.fields === null || contact.multiFields === null) {
      throw new DedupeError("invalid-contact");
    }
    record(fields, "invalid-contact");
    record(multiFields, "invalid-contact");
    const scalarEntries = Object.keys(fields)
      .sort()
      .map((key) => {
        text(key, "invalid-contact");
        scalarNames.add(key);
        return [key, stringValue(fields[key] as string)] as const;
      });
    const multiEntries = Object.keys(multiFields)
      .sort()
      .map((key) => {
        text(key, "invalid-contact");
        multiNames.add(key);
        return [key, strings(multiFields[key] as readonly string[], stringValue)] as const;
      });
    byId.set(contact.id, {
      id: contact.id,
      fields: Object.fromEntries(scalarEntries),
      multiFields: Object.fromEntries(multiEntries),
      webIds: strings(contact.webIds === undefined ? [] : contact.webIds, validateWebId),
      emails: strings(contact.emails === undefined ? [] : contact.emails, normaliseEmail),
      phones: strings(contact.phones === undefined ? [] : contact.phones, (value) =>
        normalisePhone(value, options.defaultCountryCallingCode),
      ),
    });
  }
  for (const key of scalarNames) {
    if (multiNames.has(key)) throw new DedupeError("invalid-contact");
  }
  return [...byId.keys()].sort().map((id) => byId.get(id) as PreparedContact);
}
