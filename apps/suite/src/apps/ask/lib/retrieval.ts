// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { MAX_PASSAGES, type Passage, questionTerms } from "@jeswr/pod-ask";
import { createRdfEngine } from "@jeswr/rdf-engine";
import { createPodClient } from "@jeswr/storage-client";
import { createLocalSearch, type SearchResult } from "@jeswr/suite-sdk/search";
import type { AppSlug } from "@jeswr/suite-ui";
import { NS } from "@jeswr/suite-vocab";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { createSnippet, SearchIndex, tokenize } from "@/lib/search";
import type { PodSession } from "@/lib/session/pod-session";
import { podSearchResult } from "@/shell/search/pod-results";
import { warmSearchIndex } from "@/shell/search/pod-source";
import { askSearchCapabilities } from "../demo/sample";

export interface AskPassage extends Passage {
  app: AppSlug;
  href: string;
}
export interface AskRetrieval {
  scopes: AppSlug[];
  count: number;
  limited: boolean;
  /** The profile's inbox couldn't be identified, so only containers named inbox are excluded. */
  inboxUnidentified: boolean;
  retrieve(question: string, scope: AppSlug | undefined): AskPassage[];
  dispose(): void;
}

/**
 * Inboxes accept writes from anyone, so their contents are not "from your pod" in the sense
 * Ask cites. Excludes any resource under a container named `inbox`, and under the profile's
 * `ldp:inbox` wherever it lives. Other append-only containers need ACL reads (not done here).
 */
export function inInbox(url: string, inboxes: readonly string[] = []): boolean {
  const resource = new URL(url);
  resource.hash = "";
  const containers = resource.pathname.split("/").slice(0, -1);
  if (containers.some((segment) => segment.toLowerCase() === "inbox")) return true;
  return inboxes.some((inbox) => {
    const container = new URL(inbox);
    container.hash = "";
    const prefix = container.href.endsWith("/") ? container.href : `${container.href}/`;
    return resource.href === container.href || resource.href.startsWith(prefix);
  });
}

/**
 * Ask-specific ranking adapter; discovery, bounded reads and RDF projections stay shared.
 * `inboxes` is null when the profile's inbox couldn't be identified.
 */
export function rankAskSources(
  rows: readonly SearchResult[],
  root: string,
  inboxes: readonly string[] | null = [],
): AskRetrieval {
  const index = new SearchIndex();
  const sources = new Map<string, AskPassage>();
  for (const row of rows) {
    // RDF subjects can point outside the resource that described them.
    try {
      assertWithinPodScope(root, row.url);
    } catch {
      continue;
    }
    if (inInbox(row.url, inboxes ?? [])) continue;
    const mapped = podSearchResult(row);
    if (sources.has(row.url) || new URL(row.url).pathname.endsWith("/")) continue;
    const text = (row.snippet || row.title).slice(0, 4000).toWellFormed();
    if (!text.trim()) continue;
    const source: AskPassage = {
      url: row.url,
      title: row.title.trim().slice(0, 300).toWellFormed() || "Untitled resource",
      app: mapped.app,
      type: row.type ?? mapped.type,
      text,
      href: mapped.href,
      ...(row.modified ? { modified: row.modified.toISOString() } : {}),
    };
    sources.set(row.url, source);
    index.add({ id: row.url, title: source.title, body: text });
  }
  return {
    count: sources.size,
    // The shared warmer is capped too; this is always a partial, session-local view.
    limited: rows.length >= 1000,
    inboxUnidentified: inboxes === null,
    scopes: [...new Set([...sources.values()].map((source) => source.app))].sort(),
    retrieve(question, scope) {
      const scores = new Map<string, number>();
      for (const term of questionTerms(question)) {
        const query = tokenize(term)
          .map((token) => token.term)
          .join(" ");
        for (const hit of index.search(query)) {
          if (scope && sources.get(hit.document.id)?.app !== scope) continue;
          scores.set(hit.document.id, (scores.get(hit.document.id) ?? 0) + hit.score);
        }
      }
      return [...scores]
        .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
        .slice(0, MAX_PASSAGES)
        .map(([id]) => {
          const source = sources.get(id) as AskPassage;
          return {
            ...source,
            text: createSnippet(source.text, question, 3000).text.slice(0, 4000).toWellFormed(),
          };
        });
    },
    dispose() {
      for (const id of sources.keys()) index.remove(id);
      sources.clear();
    },
  };
}

const PROFILE_TIMEOUT_MS = 10_000;
const PROFILE_MAX_BYTES = 1_048_576;

class InboxOwner extends TermWrapper {
  get inboxes() {
    return [...SetFrom.subjectPredicate(this, `${NS.LDP}inbox`, TermAs.term, TermFrom.itself)];
  }
}

/**
 * Every `ldp:inbox` the session's own profile advertises, read through the session's fetch so
 * http and private-network pods work as well as public HTTPS ones. Null when the profile can't
 * be read or an advertised inbox isn't an IRI; the caller then says so rather than guessing.
 */
export async function profileInboxes(
  session: Pick<PodSession, "webId" | "fetch">,
  signal: AbortSignal,
): Promise<string[] | null> {
  try {
    const profile = new URL(session.webId);
    profile.hash = "";
    const { dataset } = await fetchRdf(profile.href, {
      fetch: session.fetch,
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROFILE_TIMEOUT_MS)]),
      maxBytes: PROFILE_MAX_BYTES,
    });
    const inboxes = new InboxOwner(session.webId, dataset, DataFactory).inboxes;
    // Excluding several advertised inboxes is safer than picking one.
    if (inboxes.some((term) => term.termType !== "NamedNode" || !URL.canParse(term.value)))
      return null;
    return inboxes.map((term) => term.value);
  } catch {
    // Containers named inbox are still excluded.
    return null;
  }
}

export async function openAskRetrieval(
  session: PodSession,
  signal: AbortSignal,
): Promise<AskRetrieval> {
  const engine = createRdfEngine();
  const inboxes = profileInboxes(session, signal);
  try {
    const { storage } = await createPodClient({
      storage: session.storageUrl,
      fetch: session.fetch,
      capabilities: await askSearchCapabilities(session, signal),
      signal,
    });
    const index = await engine.createIndex({
      maxQuads: 200000,
      persist: { load: async () => null, save: async () => {} },
    });
    await warmSearchIndex(storage, index, session.fetch, signal);
    signal.throwIfAborted();
    const page = await createLocalSearch(index).search(
      { within: [storage.root], limit: 1000 },
      { signal },
    );
    const excluded = await inboxes;
    signal.throwIfAborted();
    return rankAskSources(page.results, storage.root, excluded);
  } finally {
    engine.dispose();
  }
}
