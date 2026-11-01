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

/** Local names of the profile predicates the editor may show (any vocabulary). */
export const PROFILE_FIELD_NAMES: readonly string[] = [
  "name",
  "fn",
  "hasPhoto",
  "img",
  "pronouns",
  "hasEmail",
  "hasTelephone",
  "email",
  "telephone",
];

const localName = (predicate: string) => predicate.split(/[#/]/).at(-1) ?? "";

/** Keep only allowlisted profile fields, label them plainly, and add the missing ones. */
export function profileFields(resolved: readonly FieldSpec[]): FieldSpec[] {
  const profile = resolved
    .filter((field) => PROFILE_FIELD_NAMES.includes(localName(field.predicate)))
    .map((field) => {
      const local = localName(field.predicate);
      if (["name", "fn"].includes(local)) return { ...field, label: "Name" };
      if (local === "hasEmail")
        return { ...field, label: "Email", kind: "email" as const, mode: "mailto" as const };
      if (local === "hasTelephone")
        return { ...field, label: "Phone", kind: "tel" as const, mode: "tel" as const };
      if (["hasPhoto", "img"].includes(local))
        return { ...field, label: "Photo", kind: "url" as const, mode: "iri" as const };
      if (local === "pronouns") return { ...field, label: "Pronouns" };
      return field;
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
