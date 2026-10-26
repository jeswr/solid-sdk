// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { requireAddress, text } from "./errors";
import { recipient, unicodeEmail } from "./format";
import type { RecentRecipient, Recipient, RecipientSuggestion } from "./types";

function searchKey(value: string): string {
  // Fold final sigma to sigma so casing is independent of the prefix's word boundary.
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/\u03c2/g, "\u03c3");
}

/** Prefix filter, then frequency descending, last-used descending, canonical email ascending. */
export function rankRecipients(
  query: string,
  contacts: readonly Recipient[],
  recent: readonly RecentRecipient[],
  limit = 10,
): RecipientSuggestion[] {
  text(query);
  requireAddress(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(query));
  requireAddress(Array.isArray(contacts) && Array.isArray(recent));
  requireAddress(Number.isSafeInteger(limit) && limit >= 0);
  const prefix = searchKey(query.trim());
  const candidates = new Map<string, { suggestion: RecipientSuggestion; matches: boolean }>();
  function add(value: Recipient, usage?: RecentRecipient): void {
    const address = recipient(value);
    if (usage !== undefined) {
      requireAddress(
        Number.isSafeInteger(usage.frequency) &&
          usage.frequency > 0 &&
          Number.isSafeInteger(usage.lastUsed) &&
          usage.lastUsed >= 0,
        "invalid-recipient",
      );
    }
    const matches =
      searchKey(address.email).startsWith(prefix) ||
      searchKey(unicodeEmail(address.email)).startsWith(prefix) ||
      (address.name !== undefined && searchKey(address.name).startsWith(prefix));
    let candidate = candidates.get(address.email);
    if (candidate === undefined) {
      candidate = {
        suggestion: {
          ...address,
          frequency: 0,
          lastUsed: null,
          source: usage === undefined ? "contact" : "recent",
        },
        matches,
      };
      candidates.set(address.email, candidate);
    } else {
      candidate.matches ||= matches;
      if (candidate.suggestion.name === undefined && address.name !== undefined) {
        candidate.suggestion.name = address.name;
      }
      if (usage !== undefined && candidate.suggestion.source === "contact") {
        candidate.suggestion.source = "both";
      }
    }
    if (usage !== undefined) {
      const total = candidate.suggestion.frequency + usage.frequency;
      requireAddress(Number.isSafeInteger(total), "invalid-recipient");
      candidate.suggestion.frequency = total;
      candidate.suggestion.lastUsed = Math.max(candidate.suggestion.lastUsed ?? 0, usage.lastUsed);
    }
  }
  // Contact names take precedence, while every alias remains searchable.
  for (const contact of contacts) add(contact);
  for (const entry of recent) add(entry, entry);
  return Array.from(candidates.values())
    .filter((candidate) => candidate.matches)
    .map((candidate) => candidate.suggestion)
    .sort(
      (a, b) =>
        b.frequency - a.frequency ||
        (b.lastUsed ?? -1) - (a.lastUsed ?? -1) ||
        (a.email < b.email ? -1 : 1),
    )
    .slice(0, limit);
}
