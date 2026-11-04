// AUTHORED-BY Codex GPT-6 (moved here from components/item/edit-form.tsx)
// AUTHORED-BY Claude Opus 5.5
/**
 * Which fields the Home item editor offers. Pure + node-testable.
 *
 * A WebID profile document holds account plumbing (OIDC issuer, storage, inboxes, type
 * indexes) next to the person's public details. Editing it as a generic auto-form would
 * let a stray keystroke break sign-in, so the profile editor is an allowlist: name,
 * photo, pronouns, email and phone. Every other document gets its resolved form.
 *
 * Either way, fields that can't be edited without losing data (several values, or a
 * nested structure) come back read-only with a hint — see {@link lockUneditableFields}.
 */
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { type FieldSpec, normaliseField } from "./field-types";
import { resolveForm } from "./resolve-form";
import { lockUneditableFields } from "./subject-edit";

/**
 * How each allowlisted profile predicate (by local name, any vocabulary) is shown. A
 * `vcard:hasEmail`/`hasTelephone`/`hasPhoto` link is an IRI; a plain `email`/`telephone`
 * keeps the value form the document already uses, so only its label changes.
 */
const PROFILE_OVERRIDES: ReadonlyMap<string, Partial<FieldSpec>> = new Map([
  ["name", { label: "Name" }],
  ["fn", { label: "Name" }],
  ["hasPhoto", { label: "Photo", kind: "url", mode: "iri" }],
  ["img", { label: "Photo", kind: "url", mode: "iri" }],
  ["pronouns", { label: "Pronouns" }],
  ["hasEmail", { label: "Email", kind: "email", mode: "mailto" }],
  ["hasTelephone", { label: "Phone", kind: "tel", mode: "tel" }],
  ["email", { label: "Email" }],
  ["telephone", { label: "Phone" }],
]);

/** Local names of the profile predicates the editor may show (any vocabulary). */
export const PROFILE_FIELD_NAMES: readonly string[] = [...PROFILE_OVERRIDES.keys()];

/** The text after the last `#` or `/` of a predicate IRI. */
const localName = (predicate: string) => predicate.replace(/^.*[#/]/, "");

/** Keep only allowlisted profile fields, label them plainly, and add the missing ones. */
export function profileFields(resolved: readonly FieldSpec[]): FieldSpec[] {
  const profile = resolved.flatMap((field) => {
    const override = PROFILE_OVERRIDES.get(localName(field.predicate));
    return override ? [{ ...field, ...override }] : [];
  });
  for (const [label, predicate, kind, mode] of [
    ["Name", `${NS.FOAF}name`, "text", "literal"],
    ["Photo", `${NS.VCARD}hasPhoto`, "url", "iri"],
    ["Pronouns", `${NS.SCHEMA}pronouns`, "text", "literal"],
    ["Email", `${NS.VCARD}hasEmail`, "email", "mailto"],
    ["Phone", `${NS.VCARD}hasTelephone`, "tel", "tel"],
  ] as const)
    if (!profile.some((field) => field.label === label || field.predicate === predicate))
      profile.push(normaliseField({ label, predicate, kind, mode }));
  return profile;
}

/** The editor's fields for one item: the profile allowlist for the WebID document. */
export function itemEditFields(
  item: { url: string; dataset: DatasetCore; subject: Term },
  webId: string,
): FieldSpec[] {
  const resolved = resolveForm(item.url, item.dataset, item.subject).fields;
  const fields = item.url === webId.split("#")[0] ? profileFields(resolved) : resolved;
  return lockUneditableFields(fields, item.dataset, item.subject);
}
