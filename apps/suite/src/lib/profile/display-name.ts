// AUTHORED-BY Codex GPT-6.1-Sol
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
class Profile extends Agent {
  get displayName(): string | undefined {
    for (const predicate of predicates)
      for (const term of SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself))
        if (term.termType === "Literal" && term.value.trim()) return term.value.trim();
    return undefined;
  }
}

export function shortWebId(webId: string | undefined): string {
  try {
    return new URL(webId as string).hostname || "Unknown author";
  } catch {
    return "Unknown author";
  }
}

interface Entry {
  result: Promise<string>;
  expires: number;
}
// A new account session gets a fresh cache; old sessions can be garbage collected.
const sessions = new WeakMap<PodSession, Map<string, Entry>>();
export function resolveDisplayName(session: PodSession, webId: string): Promise<string> {
  if (webId === session.webId) return Promise.resolve("You");
  let cache = sessions.get(session);
  if (!cache) {
    cache = new Map();
    sessions.set(session, cache);
  }
  const existing = cache.get(webId);
  if (existing && existing.expires > Date.now()) return existing.result;
  const entry: Entry = { result: Promise.resolve(""), expires: Number.POSITIVE_INFINITY };
  entry.result = (async () => {
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
      entry.expires = Date.now() + (name ? 300_000 : 30_000);
      return name ?? shortWebId(webId);
    } catch {
      entry.expires = Date.now() + 30_000;
      return shortWebId(webId);
    }
  })();
  cache.set(webId, entry);
  return entry.result;
}
