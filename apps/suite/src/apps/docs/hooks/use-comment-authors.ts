// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // Completed names live in a bounded LRU; in-flight lookups are tracked separately so
  // eviction never duplicates a request. Both are discarded on session changes
  // (including account switches).
  const lookup = useMemo(() => {
    const cache = new Map<string, string>();
    const inflight = new Map<string, Promise<string>>();
    const publicFetch = session.mode === "demo" ? globalThis.fetch : session.publicFetch;
    return (webId: string): Promise<string> => {
      const done = cache.get(webId);
      if (done !== undefined) {
        cache.delete(webId);
        cache.set(webId, done);
        return Promise.resolve(done);
      }
      let pending = inflight.get(webId);
      if (!pending) {
        const fallback = authorFallback(webId);
        pending = loadProfileName(session.fetch, publicFetch, session.storageUrl, webId, fallback)
          .catch(() => fallback)
          .then((name) => {
            inflight.delete(webId);
            cache.set(webId, name);
            if (cache.size > AUTHOR_CACHE_LIMIT) {
              const oldest = cache.keys().next().value;
              if (oldest !== undefined) cache.delete(oldest);
            }
            return name;
          });
        inflight.set(webId, pending);
      }
      return pending;
    };
  }, [session]);
  const [resolved, setResolved] = useState<{
    lookup: typeof lookup;
    names: Map<string, string>;
  }>();
  const current = useRef(resolved);
  current.current = resolved;
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
      // A name already shown for this session needs no lookup on refresh.
      if (current.current?.lookup === lookup && current.current.names.has(webId)) continue;
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
