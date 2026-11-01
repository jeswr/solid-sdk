// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The Requests inbox binding (03-home-permissions §2.5): one shared list per session, so the
 * Permissions tab badge, the Requests page and a review sheet mounted elsewhere agree. Listing and
 * decisions go only through `@jeswr/pod-access/requests-solid`; every decision is one call.
 */

import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import {
  type AccessRequestEntry,
  type DecisionResult,
  decide as decideRequest,
  listRequests,
  type RequestDecision,
} from "@jeswr/pod-access/requests-solid";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { useSuiteEnvironment } from "@/shell/environment";
import { useHomeSession } from "../components/home-app";
import { discoverDomainItems } from "../lib/model/discovery";
import { DiscoveryBudget } from "../lib/model/discovery-budget";
import { provenanceOf } from "../lib/model/provenance";
import { inStorage } from "../lib/model/rdf";
import { readTypeIndexes } from "../lib/model/type-index";
import { type RequestCaps, requestCaps } from "../lib/requests/caps";
import { type RequestCard, type RequestLists, splitRequests } from "../lib/requests/model";

/** Focus refreshes at most this often (§3). */
export const FOCUS_REFRESH_MS = 60_000;

export interface RequestsSnapshot {
  status: "loading" | "ready" | "error";
  entries: readonly AccessRequestEntry[];
}

interface RequestsStore {
  identity: string;
  snapshot: RequestsSnapshot;
  loadedAt: number;
  loading?: Promise<void> | undefined;
  generation: number;
  /** Requests decided in this session, hidden from the waiting lists whatever a listing says. */
  answered: Set<string>;
  /** The owner dismissed the note about unreadable inbox items for this session. */
  unreadableDismissed: boolean;
  listeners: Set<() => void>;
}

const stores = new WeakMap<typeof globalThis.fetch, RequestsStore>();

function storeFor(session: PodSession): RequestsStore {
  const identity = `${session.webId}\u0000${session.storageUrl}`;
  let store = stores.get(session.fetch);
  if (!store || store.identity !== identity) {
    store = {
      identity,
      snapshot: { status: "loading", entries: [] },
      loadedAt: 0,
      generation: 0,
      answered: new Set(),
      unreadableDismissed: false,
      listeners: new Set(),
    };
    stores.set(session.fetch, store);
  }
  return store;
}

function publish(store: RequestsStore, snapshot: RequestsSnapshot) {
  store.snapshot = snapshot;
  for (const listener of store.listeners) listener();
}

/** The SDK options for this session: the pod's fetch, and an unauthenticated one if it has one. */
export function requestOptions(session: PodSession) {
  return {
    fetch: session.fetch,
    webId: session.webId,
    storage: session.storageUrl,
    ...(session.mode === "extension" ? { publicFetch: session.publicFetch } : {}),
  };
}

/** Re-list the inbox; concurrent callers share one listing, and a later call supersedes it. */
function load(store: RequestsStore, session: PodSession): Promise<void> {
  if (store.loading) return store.loading;
  const generation = ++store.generation;
  const loading = (async () => {
    try {
      const entries = await listRequests(requestOptions(session));
      if (generation === store.generation) publish(store, { status: "ready", entries });
    } catch {
      // A failed refresh keeps the requests already shown.
      if (generation === store.generation && store.snapshot.status !== "ready")
        publish(store, { status: "error", entries: [] });
    } finally {
      store.loadedAt = Date.now();
      store.loading = undefined;
    }
  })();
  store.loading = loading;
  return loading;
}

export interface RequestsBinding extends RequestLists {
  status: RequestsSnapshot["status"];
  refresh(): Promise<void>;
  /**
   * One SDK decision; the inbox is re-listed afterwards whatever the outcome. A decided request
   * leaves the waiting lists as soon as the decision resolves, so it can't be decided twice while
   * the re-list runs or after it fails.
   */
  decide(entry: AccessRequestEntry, decision: RequestDecision): Promise<DecisionResult>;
  /** Whether the note about unreadable inbox items was dismissed in this session. */
  unreadableDismissed: boolean;
  dismissUnreadable(): void;
}

export function useRequests(): RequestsBinding {
  const session = useHomeSession();
  const store = storeFor(session);
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
      },
      [store],
    ),
    () => store.snapshot,
    () => store.snapshot,
  );
  const refresh = useCallback(() => {
    // A newer refresh (after a decision, say) must not reuse a listing started before it.
    store.loading = undefined;
    return load(store, session);
  }, [store, session]);

  useEffect(() => {
    if (store.snapshot.status !== "ready" || store.loadedAt === 0) void load(store, session);
    const focus = () => {
      if (Date.now() - store.loadedAt >= FOCUS_REFRESH_MS) void load(store, session);
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [store, session]);

  const decide = useCallback(
    async (entry: AccessRequestEntry, decision: RequestDecision) => {
      try {
        const result = await decideRequest(entry, decision, requestOptions(session));
        store.answered.add(entry.id);
        publish(store, { ...store.snapshot });
        return result;
      } finally {
        void refresh();
      }
    },
    [store, session, refresh],
  );

  const dismissUnreadable = useCallback(() => {
    store.unreadableDismissed = true;
    publish(store, { ...store.snapshot });
  }, [store]);

  return {
    status: snapshot.status,
    ...splitRequests(snapshot.entries, new Date(), store.answered),
    refresh,
    decide,
    unreadableDismissed: store.unreadableDismissed,
    dismissUnreadable,
  };
}

/** Capability flags for the Requests surfaces, from the server-provided environment. */
export function useRequestCaps(): RequestCaps {
  const environment = useSuiteEnvironment();
  return requestCaps(environment.SUITE_TEST_CAPS, process.env.NEXT_PUBLIC_SUITE_CAPS);
}

export interface CardSummary {
  count: number;
  /** Connected services that provided the items ("Provided by Spotify"). */
  sources: string[];
}

/**
 * Item counts and sources for each card from the Home model's discovery. A domain whose
 * discovery failed or stopped early has no reliable count, so its cards get none.
 */
export async function summarizeCards(
  session: Pick<PodSession, "fetch" | "webId" | "storageUrl">,
  cards: readonly RequestCard[],
  signal?: AbortSignal,
): Promise<Record<string, CardSummary>> {
  const domains = [...new Set(cards.flatMap((card) => (card.domainId ? [card.domainId] : [])))];
  if (!domains.length) return {};
  const storage = session.storageUrl;
  const scoped: typeof globalThis.fetch = (input, init) =>
    session.fetch(assertWithinPodScope(storage, String(input)), { ...init, redirect: "error" });
  const budget = new DiscoveryBudget({
    maxRequests: 128,
    timeoutMs: 15_000,
    ...(signal && { signal }),
  });
  const profileUrl = session.webId.split("#")[0] as string;
  // A profile hosted elsewhere is never read with the pod's credentials here.
  const profile = inStorage(profileUrl, storage)
    ? (await fetchRdf(profileUrl, { fetch: scoped, ...(signal && { signal }) })).dataset
    : undefined;
  const { locations } = profile
    ? await readTypeIndexes(scoped, session.webId, profile, storage, { budget })
    : { locations: [] };
  const out: Record<string, CardSummary> = {};
  for (const domain of domains) {
    const found = await discoverDomainItems(domain, {
      fetch: scoped,
      storage,
      typeIndex: locations,
      webId: session.webId,
      ...(profile && { profile }),
      budget,
    });
    if (found.failures.length || found.truncated) continue;
    for (const card of cards.filter((card) => card.domainId === domain)) {
      const items = found.items.filter((item) => item.dataType?.id === card.id);
      const sources = items
        .map((item) =>
          provenanceOf(item.dataset, item.subject, item.containerUrl, {
            userWebId: session.webId,
            storage,
          }),
        )
        .filter((provenance) => provenance.kind !== "you")
        .map((provenance) => provenance.label);
      out[card.id] = { count: items.length, sources: [...new Set(sources)] };
    }
  }
  return out;
}

/** Counts and sources for the open review's cards; empty until (or unless) they are known. */
export function useCardSummaries(cards: readonly RequestCard[]): Record<string, CardSummary> {
  const session = useHomeSession();
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const key = cards.map((card) => card.id).join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the card ids are the identity.
  useEffect(() => {
    const controller = new AbortController();
    summarizeCards(session, cards, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setSummaries(next);
      },
      () => {
        /* Counts are optional: without them the cards simply show none. */
      },
    );
    return () => controller.abort();
  }, [session, key]);
  return summaries;
}
