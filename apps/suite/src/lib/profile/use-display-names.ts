// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useContext, useEffect, useState } from "react";
import { SessionContext } from "../session/shell-pod-session";
import type { PodSession } from "../session/types";
import { OWN_LABEL, resolveDisplayName, shortWebId } from "./display-name";

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
      let names = new Map<string, string>();
      setResolved({ session, key, names });
      // Publish each name as it resolves: one slow profile must not hold back the rest.
      for (const id of new Set(ids))
        void resolveDisplayName(session, id).then((name) => {
          if (!live) return;
          names = new Map(names).set(id, name);
          setResolved({ session, key, names });
        });
    }
    return () => {
      live = false;
    };
  }, [session, key]);
  return (webId: string | undefined) => {
    if (session && webId === session.webId) return OWN_LABEL;
    if (webId && resolved?.session === session && resolved?.key === key)
      return resolved.names.get(webId) ?? shortWebId(webId);
    return shortWebId(webId);
  };
}
