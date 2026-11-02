// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import type { ContactData } from "./model";
import { normalisePhoneNumber, parsePhoneNumber } from "./phone";

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
export const contactFormSchema = z.object({
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
});
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
    webId: data.webId ?? "",
    note: data.note ?? "",
    labels,
  };
}
/** Explicit undefined clears optional fields through ContactPatch. */
export function contactFormData(values: ContactFormValues) {
  const clean = contactFormSchema.parse(values);
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
    webId: clean.webId ? new URL(clean.webId).href : undefined,
    note: clean.note || undefined,
  };
}
