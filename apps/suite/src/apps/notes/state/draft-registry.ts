// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { createPendingDrafts, type PendingDrafts } from "./pending-drafts";

const draft = z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()) });
const optionalText = z.string().optional();
const stored = draft.extend({
  url: z.url(),
  etag: z.string().nullable(),
  location: z.enum(["active", "archived", "trashed"]),
  previous: z.enum(["active", "archived"]).optional(),
  trashedAt: optionalText,
  format: z.string(),
  created: optionalText,
  modified: optionalText,
  creator: optionalText,
  revisions: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      format: z.string(),
      generatedAt: z.string(),
      label: optionalText,
      attributedTo: optionalText,
      wasRevisionOf: optionalText,
    }),
  ),
});
const snapshots = z.array(
  z.object({ note: stored, draft, status: z.enum(["saving", "failed", "conflict"]) }),
);
const registries = new Map<string, PendingDrafts>();

/** One registry per browser document; storage survives reload even if its PUT is cancelled. */
export function getPendingDrafts(webId: string): PendingDrafts {
  const registry = registries.get(webId);
  if (registry) return registry;
  const key = `suite.notes.pending-drafts.${webId}`;
  let initial: z.infer<typeof snapshots> = [];
  try {
    const envelope = z.object({
      version: z.literal(1),
      webId: z.literal(webId),
      drafts: snapshots,
    });
    initial = envelope.parse(JSON.parse(localStorage.getItem(key) ?? "null")).drafts;
  } catch {
    // Unavailable storage still permits in-memory recovery and the unload prompt.
  }
  const pending = createPendingDrafts({
    initial,
    persist(entries) {
      try {
        localStorage.setItem(key, JSON.stringify({ version: 1, webId, drafts: entries }));
      } catch {
        // Keep the in-memory draft and prompt until its save succeeds.
      }
    },
  });
  const retry = () => void pending.retry();
  if (typeof window !== "undefined") {
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", retry);
    window.addEventListener("beforeunload", (event) => {
      pending.beforeUnload(event);
      retry();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") retry();
    });
  }
  registries.set(webId, pending);
  return pending;
}
