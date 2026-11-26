// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadDisplayName, shortWebId } from "@/lib/profile/display-name";
import type { PodSession } from "@/lib/session/types";
import type { CommentThread } from "../lib/model/comments";

const AUTHOR_CACHE_LIMIT = 128;

export function useCommentAuthors(session: PodSession, threads: CommentThread[]) {
  // Completed names live in a bounded LRU; in-flight lookups are tracked separately so
  // eviction never duplicates a request. Both are discarded on session changes
  // (including account switches).
  const lookup = useMemo(() => {
    const cache = new Map<string, string>();
    const inflight = new Map<string, Promise<string>>();
    return (webId: string): Promise<string> => {
      const done = cache.get(webId);
      if (done !== undefined) {
        cache.delete(webId);
        cache.set(webId, done);
        return Promise.resolve(done);
      }
      let pending = inflight.get(webId);
      if (!pending) {
        // The same reader, name predicates, limits and fallback as version history and
        // suggestions. Comments show the author's profile name for one's own entries too.
        pending = loadDisplayName(session, webId)
          .catch(() => shortWebId(webId))
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
    (resolved?.lookup === lookup ? resolved.names.get(webId) : undefined) ?? shortWebId(webId);
}
