// AUTHORED-BY Codex GPT-6.1-Sol

import { normaliseEmail, normalisePhone } from "../lib/dedupe/normalise";
import type { ListContact } from "../lib/list";
import type { ContactAddress, ContactData, ContactGroupData, Snapshot } from "../lib/model";
import { formatPhoneNumber, parsePhoneNumber } from "../lib/phone";
import { formatAddressMultiline, ISO_COUNTRY_CODES, type PostalAddress } from "../lib/postal";

/** Explicit undefined clears an optional field; omission preserves it. */
export type ContactPatch = { name?: string } & {
  [K in "emails" | "phones" | "addresses" | "note" | "organization" | "webId"]?:
    | ContactData[K]
    | undefined;
};
export function applyContactPatch(data: ContactData, patch: ContactPatch): ContactData {
  const next = { ...data, ...patch };
  for (const key of Object.keys(patch) as (keyof ContactPatch)[]) {
    if (next[key] === undefined) delete next[key];
  }
  return next as ContactData;
}

function relativeDocument(book: string, value: string): string {
  if (/%2f|%5c|%2e/i.test(value)) throw new TypeError("Invalid contact reference");
  const base = new URL(".", book);
  const target = new URL(value, base);
  target.hash = "";
  if (
    !/^https?:$/.test(base.protocol) ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.search ||
    !target.pathname.startsWith(base.pathname) ||
    target.pathname === base.pathname ||
    /%2f|%5c|%2e/i.test(target.pathname)
  )
    throw new TypeError("Invalid contact reference");
  return target.href.slice(base.href.length);
}

/** Opaque, canonical base64url of a document path relative to the book container. */
export function encodeContactRef(book: string, id: string): string {
  return btoa(relativeDocument(book, id))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeContactRef(book: string, ref: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new TypeError("Invalid contact reference");
  const path = atob(ref.replace(/-/g, "+").replace(/_/g, "/"));
  const url = new URL(path, new URL(".", book)).href;
  if (encodeContactRef(book, url) !== ref) throw new TypeError("Invalid contact reference");
  return url;
}

export function displayPhone(phone: string): string {
  const bare = phone.replace(/^tel:/, "");
  try {
    return formatPhoneNumber(bare, "international");
  } catch {
    return bare;
  }
}

// AUTHORED-BY Claude Opus 5.5
/** A stored country of two letters is a code when it is an assigned ISO code; otherwise a name. */
export function postalAddress(address: ContactAddress): PostalAddress {
  const country = address.country?.trim() ?? "";
  const code = country.toUpperCase();
  return {
    street: (address.street ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    locality: address.locality ?? "",
    region: address.region ?? "",
    postalCode: address.postalCode ?? "",
    ...(ISO_COUNTRY_CODES.includes(code)
      ? { countryCode: code }
      : country && !/^[A-Za-z]{2}$/.test(country)
        ? { countryName: country }
        : {}),
  };
}

/** The user's region from the browser locale, so a domestic address omits its country. */
export function homeCountry(locale: string): string {
  try {
    const region = new Intl.Locale(locale).maximize().region as string;
    // Numeric UN M.49 regions such as 419 (Latin America) have no national template.
    return ISO_COUNTRY_CODES.includes(region) ? region : "US";
  } catch {
    return "US";
  }
}

/** Display lines per the national template; pod data the formatter rejects falls back to its parts. */
export function displayAddress(address: ContactAddress, home: string): string {
  try {
    return formatAddressMultiline(postalAddress(address), home);
  } catch {
    return [
      address.street,
      [address.locality, address.region, address.postalCode].filter(Boolean).join(" "),
      address.country,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function singleLine(value: string): string {
  return value
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim();
}

/** The list's strict search subset is a presentation adapter; detail retains the original RDF. */
export function projectContact(person: Snapshot<ContactData>): ListContact {
  const data = person.data;
  const emails = (data.emails ?? []).flatMap((value) => {
    const email = value.replace(/^mailto:/, "");
    try {
      normaliseEmail(email);
      return [email];
    } catch {
      return [];
    }
  });
  const phones = (data.phones ?? []).flatMap((value) => {
    let phone = value.replace(/^tel:/, "");
    try {
      // The list supports base numbers only. Extensions stay in the detail snapshot.
      try {
        normalisePhone(phone);
      } catch {
        phone = parsePhoneNumber(phone).e164;
      }
      return [displayPhone(phone)];
    } catch {
      return [];
    }
  });
  const name = singleLine(data.name);
  const organization = singleLine(data.organization ?? "");
  return {
    id: `${person.url}#this`,
    ...(name ? { displayName: name } : {}),
    ...(emails.length ? { emails } : {}),
    ...(phones.length ? { phones } : {}),
    ...(organization ? { organization } : {}),
  };
}

export function contactLabels(id: string, groups: readonly Snapshot<ContactGroupData>[]) {
  return groups.filter((group) => group.data.members?.includes(id));
}

export function filterContacts(
  contacts: readonly ListContact[],
  starred: ReadonlySet<string>,
  group?: Snapshot<ContactGroupData>,
  onlyStarred = false,
) {
  return contacts.filter(
    (contact) =>
      (!onlyStarred || starred.has(contact.id)) &&
      (!group || group.data.members?.includes(contact.id)),
  );
}

export interface StarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function starsKey(webId: string) {
  return `solid-suite:contacts:starred:${webId}`;
}
export function readStars(storage: StarStorage, webId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(starsKey(webId)) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}
export function toggleStar(
  storage: StarStorage,
  webId: string,
  stars: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(stars);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  storage.setItem(starsKey(webId), JSON.stringify([...next]));
  return next;
}
