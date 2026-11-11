// AUTHORED-BY Codex GPT-6.1-Sol
import type { Notify } from "@jeswr/pod-access/notify";
import { type ChipRef, mentionKey, mentionNotification } from "./index.js";

/** Claim before transport: an ambiguous POST failure must never cause a duplicate on re-save. */
export function createMentionNotifier(options: {
  actor: string;
  notify: Notify;
  receipts: Pick<Storage, "getItem" | "setItem">;
}) {
  const claimed = new Set<string>();
  return async (resource: string, refs: readonly ChipRef[], excerpt: string): Promise<void> => {
    for (const ref of refs) {
      if (ref.kind !== "person" || ref.iri === options.actor) continue;
      const key = `${options.actor}:${mentionKey(resource, ref.iri)}`;
      if (claimed.has(key) || options.receipts.getItem(key)) continue;
      // Refuse delivery if durable receipts cannot be written. At-most-once is explicit.
      options.receipts.setItem(key, "attempted");
      claimed.add(key);
      await options.notify(ref.iri, {
        ...mentionNotification(resource, ref.iri, excerpt),
        actor: options.actor,
      });
    }
  };
}
