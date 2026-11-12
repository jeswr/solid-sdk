// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useContext, useEffect, useState } from "react";
import { SessionContext } from "../session/shell-pod-session";
import type { PodSession } from "../session/types";
import { resolveDisplayName, shortWebId } from "./display-name";

export function useDisplayNames(webIds: (string | undefined)[], supplied?: PodSession) {
  const context = useContext(SessionContext);
  const session = supplied ?? (context.status === "ready" ? context.session : undefined);
  const key = JSON.stringify(webIds);
  const [resolved, setResolved] = useState<{
    session: PodSession;
    key: string;
    names: Map<string, string>;
  }>();
  useEffect(() => {
    let live = true;
    if (session) {
      const ids = (JSON.parse(key) as (string | null)[]).filter((id) => id !== null);
      void Promise.all(
        ids.map(async (id) => [id, await resolveDisplayName(session, id)] as const),
      ).then((names) => {
        if (live) setResolved({ session, key, names: new Map(names) });
      });
    }
    return () => {
      live = false;
    };
  }, [session, key]);
  return (webId: string | undefined) => {
    if (session && webId === session.webId) return "You";
    if (webId && resolved?.session === session && resolved?.key === key)
      return resolved.names.get(webId) ?? shortWebId(webId);
    return shortWebId(webId);
  };
}
