// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import type { NormalisedDoc } from "../core/types.js";
import { safeIri } from "../core/vocab.js";
import { pathId } from "../mail/paths.js";
import type { GoogleBirthday, GooglePerson } from "./fixtures.js";
import { Contact, ContactAddress, ContactName, ContactValue, text, VCARD } from "./vocab-map.js";

/** Array elements and optional fields still need validation at the untrusted JSON boundary. */
export function fields<T extends object>(value: T[] | undefined): T[] {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === "object")
    : [];
}

export function personId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("people/")) return undefined;
  const id = value.slice("people/".length);
  if (!id.trim() || id === "." || id === "..") return undefined;
  // encodeURIComponent rejects lone surrogates; one malformed id must not abort the run.
  try {
    encodeURIComponent(id);
  } catch {
    return undefined;
  }
  return id;
}

export function personSlug(id: string): string {
  return `contacts/Person/${pathId(id)}/index.ttl`;
}

export function birthday(date: GoogleBirthday["date"]): string | undefined {
  if (!date) return undefined;
  const month = date.month ?? 0;
  const day = date.day ?? 0;
  const year = date.year ?? 0;
  if (
    !Number.isInteger(year) ||
    year < 0 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  )
    return undefined;
  if (month < 1 || month > 12 || day < 1) return undefined;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (day > days) return undefined;
  const suffix = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return year === 0 ? `--${suffix}` : `${String(year).padStart(4, "0")}-${suffix}`;
}

export function personDocument(
  person: GooglePerson,
  id: string,
  resolve: (slug: string) => string,
): { doc: NormalisedDoc; fn: string } {
  const slug = personSlug(id);
  const url = resolve(slug);
  const dataset = new Store();
  const contact = new Contact(`${url}#this`, dataset, DataFactory);
  contact.types.add(`${VCARD}Individual`);
  const names = fields(person.names);
  const name = names.find((value) => value.metadata?.primary === true) ?? names[0];
  const fn =
    text(name?.displayName) ??
    ([
      name?.honorificPrefix,
      name?.givenName,
      name?.middleName,
      name?.familyName,
      name?.honorificSuffix,
    ]
      .map(text)
      .filter(Boolean)
      .join(" ") ||
      "(unnamed contact)");
  contact.fn = fn;
  if (name) {
    contact.hasName = `${url}#name`;
    new ContactName(`${url}#name`, dataset, DataFactory).parts = name;
  }
  for (const [index, email] of fields(person.emailAddresses).entries()) {
    const value = text(email.value);
    const iri = value && safeIri(`mailto:${value}`);
    if (!iri) continue;
    const node = `${url}#email-${index}`;
    contact.emails.add(node);
    const wrapper = new ContactValue(node, dataset, DataFactory);
    wrapper.kind = email.type;
    wrapper.iri = iri;
  }
  for (const [index, phone] of fields(person.phoneNumbers).entries()) {
    const raw = text(phone.value);
    if (!raw) continue;
    const value = text(phone.canonicalForm) ?? raw;
    const node = `${url}#tel-${index}`;
    contact.telephones.add(node);
    const wrapper = new ContactValue(node, dataset, DataFactory);
    wrapper.kind = phone.type;
    if (/^\+?[0-9][0-9().-]*$/.test(value)) wrapper.iri = `tel:${value}`;
    else wrapper.raw = raw;
  }
  for (const [index, address] of fields(person.addresses).entries()) {
    const node = `${url}#addr-${index}`;
    contact.addresses.add(node);
    const wrapper = new ContactAddress(node, dataset, DataFactory);
    wrapper.kind = address.type;
    wrapper.fields = address;
  }
  for (const organization of fields(person.organizations)) contact.addOrganization(organization);
  for (const value of fields(person.birthdays)) {
    const date = birthday(value.date);
    if (date) {
      contact.birthday = date;
      break;
    }
  }
  return {
    fn,
    doc: {
      slug,
      dataset,
      category: "contacts",
      forClass: `${VCARD}Individual`,
      skipRegistration: true,
      sourceUrl: `https://contacts.google.com/person/${encodeURIComponent(id)}`,
    },
  };
}
