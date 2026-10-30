// AUTHORED-BY Codex
import { IndexeddbPersistence } from "y-indexeddb";
import { Doc } from "yjs";
import { hasUnconfirmedLocalState } from "./local-state";

const PREFIX = "suite.docs.draft:";
const creations = new Map<string, Promise<unknown>>();
export function draftMirrorName(webId: string, draftId: string): string {
  return `${PREFIX}${JSON.stringify([webId, draftId])}`;
}

/** Serialise promotion across tabs, including a reload during the first PUT. */
export async function withDraftLock<T>(name: string, create: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(name, create);
  const previous = creations.get(name);
  const current = (async () => {
    await previous?.catch(() => {});
    return create();
  })();
  creations.set(name, current);
  try {
    return await current;
  } finally {
    if (creations.get(name) === current) creations.delete(name);
  }
}

/** A fresh /new navigation gets an id; reloading its URL resumes that tab's draft. */
export function currentDraftId(): string {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get("draft");
  if (existing) return existing;
  const id = crypto.randomUUID();
  url.searchParams.set("draft", id);
  window.history.replaceState(window.history.state, "", url);
  return id;
}

export interface LocalDraft {
  id: string;
  title: string;
}
/** Enumerate mirrors individually; opening the list must never merge their Y.Docs. */
export async function listLocalDrafts(webId: string): Promise<LocalDraft[]> {
  if (typeof indexedDB === "undefined" || !indexedDB.databases) return [];
  const drafts: LocalDraft[] = [];
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith(PREFIX)) continue;
    let identity: unknown;
    try {
      identity = JSON.parse(name.slice(PREFIX.length));
    } catch {
      continue;
    }
    if (!Array.isArray(identity) || identity[0] !== webId || typeof identity[1] !== "string")
      continue;
    const doc = new Doc();
    const mirror = new IndexeddbPersistence(name, doc);
    try {
      await mirror.whenSynced;
      if (await mirror.get("promoted")) continue;
      if (!(await mirror.get("pending")) && !(await hasUnconfirmedLocalState(mirror))) continue;
      const title: unknown = await mirror.get("title");
      drafts.push({
        id: identity[1],
        title: typeof title === "string" ? title : "Untitled document",
      });
    } finally {
      await mirror.destroy();
      doc.destroy();
    }
  }
  return drafts;
}
