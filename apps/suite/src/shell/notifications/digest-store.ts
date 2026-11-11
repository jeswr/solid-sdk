// AUTHORED-BY Codex GPT-6.1-Sol
import type { Digest } from "@jeswr/suite-sdk/digest";
import { z } from "zod";

const item = z.object({
  id: z.string(),
  notificationIds: z.array(z.string()).max(100),
  text: z.string(),
  count: z.number(),
  unread: z.number(),
  urgent: z.boolean(),
  newest: z.number(),
});
const schema = z.object({
  since: z.number().finite(),
  now: z.number().finite(),
  count: z.number(),
  omitted: z.number(),
  headline: z.string(),
  sections: z
    .array(z.object({ app: z.string(), count: z.number(), items: z.array(item).max(50) }))
    .max(50),
  agent: z.object({ actionsTaken: z.number(), approvalsWaiting: z.number() }),
});
const memory = new Map<string, Digest>();
export const digestKey = (accountId: string) => `suite.notification-digest.v1.${accountId}`;
/** Account-scoped durable snapshot, with the same visit-only fallback as preferences. */
export function readDigest(accountId: string): Digest | null {
  try {
    const raw = localStorage.getItem(digestKey(accountId));
    if (!raw) return memory.get(accountId) ?? null;
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return memory.get(accountId) ?? null;
  }
}
export function saveDigest(accountId: string, digest: Digest): void {
  try {
    localStorage.setItem(digestKey(accountId), JSON.stringify(digest));
    memory.delete(accountId);
  } catch {
    memory.set(accountId, digest);
    /* Visit-only fallback. */
  }
}
