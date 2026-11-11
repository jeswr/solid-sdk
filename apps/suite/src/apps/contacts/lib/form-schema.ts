// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import type { ContactAddress, ContactData } from "./model";
import { MAX_ADDRESSES } from "./model/data";
import { normalisePhoneNumber, parsePhoneNumber } from "./phone";
import { MAX_ADDRESS_COMPONENT_LENGTH, MAX_STREET_LINES } from "./postal/types";

/** Absolute HTTPS, with HTTP reserved for local development. Never accept URL credentials. */
export function secureContactUrl(value: string): boolean {
  if (!/^https?:\/\//.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
const phone = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) return true;
    const result = normalisePhoneNumber(value.replace(/^tel:/i, ""));
    return result.ok && result.number.extension === null;
  }, "Enter an international phone number, such as +1 202 555 0123, without an extension.");
// AUTHORED-BY Claude Opus 5.5
const tooLong = "This address is too long.";
export const ADDRESS_PARTS = ["street", "locality", "region", "postalCode", "country"] as const;
export type AddressFormValues = {
  kind: "" | "home" | "work";
} & Record<(typeof ADDRESS_PARTS)[number], string>;
export const emptyAddress = (): AddressFormValues => ({
  kind: "",
  street: "",
  locality: "",
  region: "",
  postalCode: "",
  country: "",
});
function addressData(address: AddressFormValues): ContactAddress | undefined {
  const data: ContactAddress = {};
  // Normalise line endings and drop blank street lines; the stored value keeps one line per row.
  const street = address.street
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (street) data.street = street;
  for (const part of ["locality", "region", "postalCode", "country"] as const)
    if (address[part]) data[part] = address[part];
  if (!Object.keys(data).length) return undefined;
  if (address.kind) data.kind = address.kind;
  return data;
}
const addressRow = z.object({
  kind: z.enum(["", "home", "work"]),
  street: z.string().trim(),
  locality: z.string().trim(),
  region: z.string().trim(),
  postalCode: z.string().trim(),
  country: z.string().trim(),
});
const rowsKey = (rows: readonly AddressFormValues[]) =>
  JSON.stringify(rows.map((row) => [row.kind, ...ADDRESS_PARTS.map((part) => row[part].trim())]));
/**
 * Limits apply once the addresses change: a contact another app wrote past them stays
 * editable (its other fields) without first having to delete address data.
 */
function addressList(initial: readonly AddressFormValues[] | undefined) {
  const unchanged = initial && rowsKey(initial);
  return z.array(addressRow).superRefine((rows, ctx) => {
    if (rowsKey(rows) === unchanged) return;
    if (rows.length > MAX_ADDRESSES)
      ctx.addIssue({
        code: "custom",
        message: `A contact can have at most ${MAX_ADDRESSES} addresses.`,
      });
    rows.forEach((row, index) => {
      for (const part of ADDRESS_PARTS) {
        const limit =
          part === "street"
            ? MAX_STREET_LINES * MAX_ADDRESS_COMPONENT_LENGTH
            : MAX_ADDRESS_COMPONENT_LENGTH;
        if (row[part].length > limit)
          ctx.addIssue({ code: "custom", path: [index, part], message: tooLong });
      }
    });
  });
}
const contactFormBase = z.object({
  name: z.string().trim().min(1, "Enter a full name."),
  organization: z.string().trim(),
  emails: z.array(
    z.object({
      value: z
        .string()
        .trim()
        .refine(
          (value) => value === "" || z.email().safeParse(value.replace(/^mailto:/i, "")).success,
          "Enter a valid email address.",
        ),
    }),
  ),
  phones: z.array(z.object({ value: phone })),
  webId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || secureContactUrl(value),
      "Enter an absolute HTTPS WebID (HTTP is allowed only on localhost).",
    ),
  note: z.string().trim(),
  labels: z.array(z.string()),
  addresses: z.array(addressRow),
});
/** The form's schema; pass the contact's loaded addresses so unchanged ones skip the limits. */
export function contactFormSchemaFor(initial?: readonly AddressFormValues[]) {
  return contactFormBase.extend({ addresses: addressList(initial) });
}
export const contactFormSchema = contactFormSchemaFor();
export type ContactFormValues = z.infer<typeof contactFormSchema>;
export function contactFormDefaults(
  data: ContactData = { name: "" },
  labels: string[] = [],
): ContactFormValues {
  return {
    name: data.name,
    organization: data.organization ?? "",
    emails: data.emails?.length
      ? data.emails.map((value) => ({ value: value.replace(/^mailto:/i, "") }))
      : [{ value: "" }],
    phones: data.phones?.length
      ? data.phones.map((value) => ({ value: value.replace(/^tel:/i, "") }))
      : [{ value: "" }],
    addresses: (data.addresses ?? []).map((address) => ({
      kind: address.kind ?? "",
      street: address.street ?? "",
      locality: address.locality ?? "",
      region: address.region ?? "",
      postalCode: address.postalCode ?? "",
      country: address.country ?? "",
    })),
    webId: data.webId ?? "",
    note: data.note ?? "",
    labels,
  };
}
/** Explicit undefined clears optional fields through ContactPatch. */
export function contactFormData(values: ContactFormValues, schema = contactFormSchema) {
  const clean = schema.parse(values);
  return {
    name: clean.name,
    organization: clean.organization || undefined,
    emails: clean.emails
      .filter(({ value }) => value)
      .map(({ value }) => `mailto:${value.replace(/^mailto:/i, "")}`),
    phones: clean.phones
      .filter(({ value }) => value)
      .map(({ value }) => {
        return `tel:${parsePhoneNumber(value.replace(/^tel:/i, "")).e164}`;
      }),
    addresses: clean.addresses
      .map(addressData)
      .filter((address): address is ContactAddress => address !== undefined),
    webId: clean.webId ? new URL(clean.webId).href : undefined,
    note: clean.note || undefined,
  };
}
