// AUTHORED-BY Codex GPT-6.1-Sol
import { firstGrapheme, nameParts } from "./text";
import type { ContactAvatar, ListContact, ListOptions } from "./types";
import { context, validateContacts } from "./validation";

/** Design-system §2.2: Home through Permissions, identifiers only. */
export const CONTACT_HUES = Object.freeze([
  205, 250, 280, 150, 40, 320, 85, 350, 300, 170, 20, 335, 130, 10, 225,
] as const);

export function contactAvatar(contact: ListContact, options: ListOptions = {}): ContactAvatar {
  validateContacts([contact]);
  const ctx = context(options);
  let parts = nameParts(contact, ctx);
  if (contact.givenName === undefined && contact.familyName === undefined) {
    const words = [...ctx.words.segment(parts[0] as string)].filter((part) => part.isWordLike);
    parts =
      words.length > 1
        ? [words[0]?.segment as string, words[words.length - 1]?.segment as string]
        : words.map((part) => part.segment);
  }
  const initials =
    parts
      .map((part) => firstGrapheme(part, ctx))
      .join("")
      .toLocaleUpperCase(ctx.locale) || "?";
  let hash = 2166136261;
  for (let unit = 0; unit < contact.id.length; unit++) {
    hash = Math.imul(hash ^ contact.id.charCodeAt(unit), 16777619) >>> 0;
  }
  return { initials, colourIndex: hash % CONTACT_HUES.length };
}
