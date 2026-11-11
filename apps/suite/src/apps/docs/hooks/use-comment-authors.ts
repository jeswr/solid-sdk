// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PodSession } from "@/lib/session/types";
import { loadProfileName } from "../../chat/lib/model/extras";
import type { CommentThread } from "../lib/model/comments";

function authorFallback(webId: string): string {
  try {
    return new URL(webId).host || "Unknown author";
  } catch {
    return "Unknown author";
  }
}

export function useCommentAuthors(session: PodSession, threads: CommentThread[]) {
  // Keep completed and in-flight lookups across refreshes and sidebar reopening,
  // but discard them when the session changes (including an account switch).
  const lookup = useMemo(() => {
    const cache = new Map<string, Promise<string>>();
    const publicFetch = session.mode === "demo" ? globalThis.fetch : session.publicFetch;
    return (webId: string) => {
      let pending = cache.get(webId);
      if (!pending) {
        const fallback = authorFallback(webId);
        pending = loadProfileName(
          session.fetch,
          publicFetch,
          session.storageUrl,
          webId,
          fallback,
        ).catch(() => fallback);
        cache.set(webId, pending);
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
    for (const webId of authors) {
      void lookup(webId).then((name) => {
        if (!live) return;
        setResolved((previous) => ({
          lookup,
          names: new Map(previous?.lookup === lookup ? previous.names : []).set(webId, name),
        }));
      });
    }
    return () => {
      live = false;
    };
  }, [lookup, threads]);
  return (webId: string) =>
    (resolved?.lookup === lookup ? resolved.names.get(webId) : undefined) ?? authorFallback(webId);
}
