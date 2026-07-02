// AUTHORED-BY Claude Fable 5
//
// The app's data-loading hook: resolve the storage root(s) from the profile
// (NEVER silently picking one of several — the user chooses), then walk the
// tree progressively (nodes stream into state as discovered) and read the type
// registrations. Pure orchestration over the lib; everything flows through the
// injected session fetch.

import { useCallback, useEffect, useState } from "react";
import type { Session } from "../auth/SessionContext.js";
import { discoverInbox } from "../lib/inbox.js";
import { storageRoots } from "../lib/profile.js";
import { type WalkedNode, walkStorage } from "../lib/storage-walk.js";
import { readTypeRegistrations, type TypeRegistration } from "../lib/type-index.js";

export interface AccessData {
  /** All advertised storages; the user picks when there are several. */
  storages: string[];
  storageRoot: string | null;
  setStorageRoot: (root: string) => void;
  /** Streamed-in nodes (progressive loading). */
  nodes: WalkedNode[];
  registrations: TypeRegistration[];
  inboxUrl: string | null;
  walking: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAccessData(session: Session): AccessData {
  const [storages, setStorages] = useState<string[]>([]);
  const [storageRoot, setStorageRoot] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WalkedNode[]>([]);
  const [registrations, setRegistrations] = useState<TypeRegistration[]>([]);
  const [inboxUrl, setInboxUrl] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  // Storage discovery (once per identity).
  useEffect(() => {
    let cancelled = false;
    setStorages([]);
    setStorageRoot(null);
    setError(null);
    storageRoots(session.webId, session.fetch)
      .then((roots) => {
        if (cancelled) return;
        setStorages(roots);
        if (roots.length === 1 && roots[0] !== undefined) setStorageRoot(roots[0]);
        if (roots.length === 0) setError("Your WebID profile advertises no pim:storage.");
      })
      .catch(() => {
        if (!cancelled) setError("Could not read your WebID profile.");
      });
    discoverInbox(session.webId, session.fetch)
      .then((url) => {
        if (!cancelled) setInboxUrl(url ?? null);
      })
      .catch(() => {
        if (!cancelled) setInboxUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // The walk + registrations (per storage root / refresh generation).
  useEffect(() => {
    void generation; // the refresh trigger — bumping it re-runs the walk
    if (!storageRoot) return;
    let cancelled = false;
    setNodes([]);
    setWalking(true);
    readTypeRegistrations(session.webId, session.fetch)
      .then((regs) => {
        if (!cancelled) setRegistrations(regs);
      })
      .catch(() => {
        if (!cancelled) setRegistrations([]);
      });
    (async () => {
      try {
        for await (const node of walkStorage(storageRoot, session.fetch)) {
          if (cancelled) return;
          setNodes((prev) => [...prev, node]);
        }
      } catch {
        if (!cancelled) setError("The storage walk failed part-way; showing what was read.");
      } finally {
        if (!cancelled) setWalking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, storageRoot, generation]);

  return {
    storages,
    storageRoot,
    setStorageRoot,
    nodes,
    registrations,
    inboxUrl,
    walking,
    error,
    refresh,
  };
}
