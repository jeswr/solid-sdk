// AUTHORED-BY Codex GPT-6.1-Sol
import { compareContacts, firstGrapheme, listName } from "./text";
import type { ContactSection, ListContact, ListOptions } from "./types";
import { context, validateContacts } from "./validation";

/** Native-letter sections sorted by locale; nonletter and unnamed contacts are last. */
export function sectionContacts(
  contacts: readonly ListContact[],
  options: ListOptions = {},
): ContactSection[] {
  validateContacts(contacts);
  const ctx = context(options);
  const buckets = new Map<string, ListContact[]>();
  for (const contact of [...contacts].sort((a, b) => compareContacts(a, b, ctx))) {
    const initial = firstGrapheme(listName(contact, ctx), ctx).toLocaleUpperCase(ctx.locale);
    let label = "#";
    if (/^\p{L}/u.test(initial)) {
      const base = initial.normalize("NFD").replace(/\p{M}/gu, "");
      label = ctx.collator.compare(initial, base) === 0 ? base : initial.normalize("NFC");
    }
    const bucket = buckets.get(label);
    if (bucket) bucket.push(contact);
    else buckets.set(label, [contact]);
  }
  const labels = [...buckets.keys()].filter((label) => label !== "#").sort(ctx.collator.compare);
  if (buckets.has("#")) labels.push("#");
  return labels.map((label) => ({ label, contacts: buckets.get(label) as ListContact[] }));
}
