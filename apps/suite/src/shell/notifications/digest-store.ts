// AUTHORED-BY Codex GPT-6.1-Sol
import type { Digest } from "@jeswr/suite-sdk/digest";
import { z } from "zod";

const item = z.object({
  id: z.string(),
  /** Group key; snapshots from before it was stored fall back to their notificationIds. */
  key: z.string().optional(),
  notificationIds: z.array(z.string()).max(100),
  text: z.string(),
});
const schema = z
  .object({
    now: z.number().finite(),
    digestedIds: z.array(z.string()).max(500).optional(),
    count: z.number(),
    omitted: z.number(),
    headline: z.string(),
    sections: z.array(z.object({ app: z.string(), items: z.array(item).max(50) })).max(50),
  })
  .transform((digest) => ({
    ...digest,
    // Migrate earlier snapshots using their available receipts.
    digestedIds:
      digest.digestedIds ??
      digest.sections
        .flatMap((section) => section.items.flatMap((item) => item.notificationIds))
        .slice(-500),
    sections: digest.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        notificationIds: item.notificationIds.slice(0, 20),
      })),
    })),
  }));
export type StoredDigest = z.output<typeof schema>;
const memory = new Map<string, StoredDigest>();
export const digestKey = (accountId: string) => `suite.notification-digest.v1.${accountId}`;
/** Account-scoped durable snapshot, with the same visit-only fallback as preferences. */
export function readDigest(accountId: string): StoredDigest | null {
  const fallback = memory.get(accountId);
  if (fallback) return fallback;
  try {
    const raw = localStorage.getItem(digestKey(accountId));
    if (!raw) return null;
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function saveDigest(accountId: string, digest: Digest): StoredDigest {
  // Persist the card and receipt history, never full source records or unused group metadata.
  const stored = schema.parse(digest);
  try {
    localStorage.setItem(digestKey(accountId), JSON.stringify(stored));
    memory.delete(accountId);
  } catch {
    memory.set(accountId, stored);
    /* Visit-only fallback. */
  }
  return stored;
}
