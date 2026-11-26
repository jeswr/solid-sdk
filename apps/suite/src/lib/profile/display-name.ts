// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import type { PodSession } from "../session/types";

const predicates = [
  "http://xmlns.com/foaf/0.1/name",
  "http://www.w3.org/2006/vcard/ns#fn",
  "http://schema.org/name",
  "https://schema.org/name",
];
/** Longest profile name shown, in characters; longer names are cut with an ellipsis. */
export const MAX_NAME_LENGTH = 80;
/** The label for the viewer's own entries; another profile can't claim it. */
export const OWN_LABEL = "You";
// Bidirectional overrides, isolates and marks, plus zero-width characters, can reorder or
// hide the visible label; a profile name is plain text.
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
/** A profile name as plain, bounded text, or undefined when nothing visible remains. */
export function cleanName(value: string): string | undefined {
  const name = value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (!name) return undefined;
  const characters = [...name];
  return characters.length > MAX_NAME_LENGTH
    ? `${characters.slice(0, MAX_NAME_LENGTH - 1).join("")}…`
    : name;
}
class Profile extends Agent {
  get displayName(): string | undefined {
    for (const predicate of predicates)
      for (const term of SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself)) {
        const name = term.termType === "Literal" ? cleanName(term.value) : undefined;
        if (name) return name;
      }
    return undefined;
  }
}

export function shortWebId(webId: string | undefined): string {
  try {
    return new URL(webId as string).host || "Unknown author";
  } catch {
    return "Unknown author";
  }
}

/**
 * Read a WebID's profile name, uncached: authenticated only inside the pod scope, otherwise
 * through the credential-free page transport, never following redirects, with a body cap
 * and a timeout. Falls back to the WebID's host. Another person's profile cannot claim the
 * viewer's own label: "You" there gains its host.
 */
export async function loadDisplayName(session: PodSession, webId: string): Promise<string> {
  try {
    const url = new URL(webId);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid profile URL");
    url.hash = "";
    let http: typeof fetch;
    try {
      assertWithinPodScope(session.storageUrl, url.href);
      http = createPodScopedFetch(session.storageUrl, { fetch: session.fetch });
    } catch {
      // Foreign profiles use the existing credential-free page transport,
      // never the authenticated session or extension bridge.
      http = session.mode === "demo" ? globalThis.fetch : session.publicFetch;
    }
    const { dataset } = await fetchRdf(url.href, {
      fetch: (input, init) => http(input, { ...init, credentials: "omit", redirect: "error" }),
      signal: AbortSignal.timeout(5000),
      maxBytes: 256 * 1024,
    });
    const name = new Profile(webId, dataset, DataFactory).displayName;
    if (!name) return shortWebId(webId);
    return webId !== session.webId && name.toLowerCase() === OWN_LABEL.toLowerCase()
      ? `${name} (${shortWebId(webId)})`
      : name;
  } catch {
    return shortWebId(webId);
  }
}

interface Entry {
  result: Promise<string>;
  expires: number;
}
// A new account session gets a fresh cache; old sessions can be garbage collected.
const sessions = new WeakMap<PodSession, Map<string, Entry>>();
export function resolveDisplayName(session: PodSession, webId: string): Promise<string> {
  if (webId === session.webId) return Promise.resolve(OWN_LABEL);
  let cache = sessions.get(session);
  if (!cache) {
    cache = new Map();
    sessions.set(session, cache);
  }
  const existing = cache.get(webId);
  if (existing && existing.expires > Date.now()) return existing.result;
  const entry: Entry = { result: Promise.resolve(""), expires: Number.POSITIVE_INFINITY };
  entry.result = loadDisplayName(session, webId).then((name) => {
    // A resolved name is kept longer than the host fallback, which may be a failed read.
    entry.expires = Date.now() + (name === shortWebId(webId) ? 30_000 : 300_000);
    return name;
  });
  cache.set(webId, entry);
  return entry.result;
}
