// AUTHORED-BY Codex GPT-6.1-Sol

import { normaliseEmail, normalisePhone } from "./dedupe/normalise";
import { contactFormData, contactFormDefaults, contactFormSchema } from "./form-schema";
import type { ContactAddress, ContactData } from "./model";
import { parseVcards } from "./model/import";
import { parseVCards, serializeVCards, type VCardAddress, type VCardField } from "./vcard";

export interface ImportRow {
  data: ContactData;
  warnings: string[];
  duplicates: string[];
  include: boolean;
  valid: boolean;
}
function key(value: string, phone: boolean): string | undefined {
  try {
    return phone
      ? normalisePhone(value.replace(/^tel:/i, ""))
      : normaliseEmail(value.replace(/^mailto:/i, ""));
  } catch {
    return undefined;
  }
}
export function duplicateContacts(
  data: ContactData,
  existing: readonly ContactData[],
  phones = true,
): ContactData[] {
  return existing.filter((person) =>
    (["emails", ...(phones ? (["phones"] as const) : [])] as const).some((field) => {
      const keys = new Set(
        (data[field] ?? [])
          .map((value) => key(value, field === "phones"))
          .filter((value) => value !== undefined),
      );
      return (person[field] ?? []).some((value) => {
        const normalized = key(value, field === "phones");
        return normalized !== undefined && keys.has(normalized);
      });
    }),
  );
}
// AUTHORED-BY Claude Opus 5.5
const words = (parts: readonly string[]) =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
/** PO box and extended address fold into the street lines; TYPE=home/work becomes the kind. */
export function vcardAddress(field: VCardField<VCardAddress>): ContactAddress | undefined {
  const { poBox, extended, street, locality, region, postalCode, country } = field.value;
  const address: ContactAddress = {};
  const lines = [...poBox, ...extended, ...street].map((line) => line.trim()).filter(Boolean);
  if (lines.length) address.street = lines.join("\n");
  for (const [key, parts] of [
    ["locality", locality],
    ["region", region],
    ["postalCode", postalCode],
    ["country", country],
  ] as const) {
    const value = words(parts);
    if (value) address[key] = value;
  }
  if (!Object.keys(address).length) return undefined;
  const types = field.parameters.TYPE ?? [];
  if (types.includes("work")) address.kind = "work";
  else if (types.includes("home")) address.kind = "home";
  return address;
}
function adr(address: ContactAddress): VCardField<VCardAddress> {
  const part = (value: string | undefined) => (value ? [value] : []);
  return {
    value: {
      poBox: [],
      extended: [],
      street: address.street ? address.street.split("\n") : [],
      locality: part(address.locality),
      region: part(address.region),
      postalCode: part(address.postalCode),
      country: part(address.country),
    },
    parameters: address.kind ? { TYPE: [address.kind] } : {},
  };
}

/** Strict parser rejects malformed envelopes; the model mapper retains supported DAV fields. */
export function previewVcards(text: string, existing: readonly ContactData[]): ImportRow[] {
  const cards = parseVCards(text);
  if (!cards.length) throw new Error("No contacts were found in these vCard files.");
  const mapped = parseVcards(text);
  const seen = [...existing];
  return cards.map((card, index) => {
    const data: ContactData = {
      ...mapped[index],
      name: card.fn,
      emails: card.emails.map(({ value }) => `mailto:${value.replace(/^mailto:/i, "")}`),
      phones: card.tels.map(({ value }) => `tel:${value.replace(/^tel:/i, "")}`),
    };
    const addresses = card.addresses
      .map(vcardAddress)
      .filter((address): address is ContactAddress => address !== undefined);
    if (addresses.length) data.addresses = addresses;
    // The older DAV mapper folds ORG into NOTE; the current model supports it directly.
    if (card.org) data.organization = card.org.join("; ");
    delete data.note;
    if (card.note !== undefined) data.note = card.note;
    const warnings: string[] = [];
    const firstUrl = card.urls?.[0];
    if (firstUrl) data.webId = firstUrl.value;
    if ((card.urls?.length ?? 0) > 1)
      warnings.push(
        "Only the first URL can be saved as a WebID. Keep the original file for additional URLs.",
      );
    if (
      card.bday !== undefined ||
      card.photo !== undefined ||
      card.title !== undefined ||
      card.categories.length
    )
      warnings.push(
        "Birthdays, photos, titles and source labels cannot be saved by this contact model. Keep the original file.",
      );
    if ([...card.emails, ...card.tels].some((field) => field.parameters.TYPE?.length))
      warnings.push("Email and phone types cannot be saved by this contact model.");

    const validation = contactFormSchema.safeParse(contactFormDefaults(data));
    if (!validation.success)
      warnings.push(...validation.error.issues.map((issue) => issue.message));
    const duplicates = duplicateContacts(data, seen).map((person) => person.name);
    seen.push(data);
    if (validation.success) Object.assign(data, contactFormData(validation.data));
    return {
      data,
      warnings,
      duplicates,
      valid: validation.success,
      include: validation.success && !duplicates.length,
    };
  });
}
export function exportContacts(contacts: readonly ContactData[]): string {
  return serializeVCards(
    contacts.map((data) => ({
      version: "4.0",
      fn: data.name,
      emails: (data.emails ?? []).map((value) => ({
        value: value.replace(/^mailto:/i, ""),
        parameters: {},
      })),
      tels: (data.phones ?? []).map((value) => ({ value, parameters: { VALUE: ["uri"] } })),
      addresses: (data.addresses ?? []).map(adr),
      categories: [],
      ...(data.webId === undefined ? {} : { urls: [{ value: data.webId, parameters: {} }] }),
      ...(data.organization === undefined ? {} : { org: [data.organization] }),
      ...(data.note === undefined ? {} : { note: data.note }),
    })),
  );
}
export interface ImportResult {
  imported: string[];
  failed: string[];
  labelFailed: string[];
}
/** At most three outstanding creates; controller serializes writes to the shared people index. */
export async function importContacts(
  rows: readonly ImportRow[],
  create: (data: ContactData) => Promise<string>,
  label: ((id: string) => Promise<unknown>) | undefined,
  progress: (completed: number) => void,
): Promise<ImportResult> {
  const selected = rows.filter((row) => row.include);
  const result: ImportResult = { imported: [], failed: [], labelFailed: [] };
  let cursor = 0;
  let completed = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (cursor < selected.length) {
        const row = selected[cursor++] as ImportRow;
        try {
          const id = await create(row.data);
          result.imported.push(id);
          if (label) {
            try {
              await label(id);
            } catch {
              result.labelFailed.push(row.data.name);
            }
          }
        } catch {
          result.failed.push(row.data.name);
        }
        progress(++completed);
      }
    }),
  );
  return result;
}
