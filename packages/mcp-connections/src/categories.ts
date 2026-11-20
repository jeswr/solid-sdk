// AUTHORED-BY Codex GPT-6.1-Sol
import { SPECIAL_CATEGORIES } from "@jeswr/pkg-memory/categories";

const PD = "https://w3id.org/dpv/pd#";
/** Every category audited by solid-mcp, plus common personal-data categories. */
export const PERSONAL_DATA_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    SPECIAL_CATEGORIES.map((iri) => [
      iri,
      iri
        .slice(iri.lastIndexOf("#") + 1)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2"),
    ]),
  ),
  [`${PD}HealthRecord`]: "Health records",
  [`${PD}MedicalHealth`]: "Medical health",
  [`${PD}Financial`]: "Financial data",
  [`${PD}Contact`]: "Contact details",
  [`${PD}ContactDetails`]: "Contact details",
  [`${PD}EmailAddress`]: "Email address",
  [`${PD}TelephoneNumber`]: "Phone number",
  [`${PD}Address`]: "Address",
  [`${PD}PaymentCard`]: "Payment card details",
  [`${PD}PersonalData`]: "Personal data",
});

export function personalDataCategoryLabel(iri: string): string {
  return Object.hasOwn(PERSONAL_DATA_CATEGORY_LABELS, iri)
    ? (PERSONAL_DATA_CATEGORY_LABELS[iri] as string)
    : "Other personal data";
}
