// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PodSession } from "@/lib/session/types";
import { loadProfileName } from "../../chat/lib/model/extras";
import type { CommentThread } from "../lib/model/comments";

const AUTHOR_CACHE_LIMIT = 128;

function authorFallback(webId: string): string {
  try {
    return new URL(webId).host || "Unknown author";
  } catch {
    return "Unknown author";
  }
}

export function useCommentAuthors(session: PodSession, threads: CommentThread[]) {
  // Keep a bounded LRU of completed and in-flight lookups across refreshes and
  // sidebar reopening; discard it on session changes (including account switches).
  const lookup = useMemo(() => {
    const cache = new Map<string, Promise<string>>();
    const publicFetch = session.mode === "demo" ? globalThis.fetch : session.publicFetch;
    return (webId: string) => {
      let pending = cache.get(webId);
      if (pending) {
        cache.delete(webId);
      } else {
        const fallback = authorFallback(webId);
        pending = loadProfileName(
          session.fetch,
          publicFetch,
          session.storageUrl,
          webId,
          fallback,
        ).catch(() => fallback);
      }
      cache.set(webId, pending);
      if (cache.size > AUTHOR_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return pending;
    };
  }, [session]);
  const [resolved, setResolved] = useState<{
    lookup: typeof lookup;
    names: Map<string, string>;
  }>();
  useEffect(() => {
    let live = true;
    const authors = new Set(
      threads.flatMap(({ root, replies }) => [
        root.creator,
        ...replies.map((reply) => reply.creator),
      ]),
    );
    setResolved((previous) => ({
      lookup,
      names: new Map(
        previous?.lookup === lookup
          ? [...previous.names].filter(([webId]) => authors.has(webId))
          : [],
      ),
    }));
    for (const webId of authors) {
      void lookup(webId).then((name) => {
        if (!live) return;
        setResolved((previous) => {
          if (previous?.lookup === lookup && previous.names.get(webId) === name) return previous;
          return {
            lookup,
            names: new Map(previous?.lookup === lookup ? previous.names : []).set(webId, name),
          };
        });
      });
    }
    return () => {
      live = false;
    };
  }, [lookup, threads]);
  return (webId: string) =>
    (resolved?.lookup === lookup ? resolved.names.get(webId) : undefined) ?? authorFallback(webId);
}
