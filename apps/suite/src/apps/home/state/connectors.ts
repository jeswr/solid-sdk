// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type ConnectionAction,
  type Connections,
  connectionReducer,
} from "../lib/connect/connection-state";

export const CONNECTORS_KEY = "suite.connectors.v1";
const connectionSchema = z.object({
  connectedAt: z.iso.datetime(),
  lastSync: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  lastOutcome: z.enum(["ok", "incomplete", "error"]),
  added: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  mode: z.enum(["demo", "live", "file"]),
  resourceUrls: z.array(z.url()),
});
const schema = z.record(z.string(), z.record(z.string(), connectionSchema));
type Envelope = z.infer<typeof schema>;

/** Replace this port with pod preferences when usePreferences supports connectors.
 * Accounts share a versioned envelope, never connection records or credentials. */
export interface ConnectorPreferences {
  read(webId: string): Connections;
  write(webId: string, connections: Connections): void;
  forResource(url: string): Connections;
}
export function createConnectorPreferences(
  storage: Pick<Storage, "getItem" | "setItem">,
): ConnectorPreferences {
  let unsaved: Envelope | undefined;
  function load(): Envelope {
    if (unsaved) return unsaved;
    try {
      const parsed = schema.safeParse(JSON.parse(storage.getItem(CONNECTORS_KEY) ?? "{}"));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }
  return {
    read: (webId) => load()[webId] ?? {},
    write(webId, connections) {
      // Parsing also strips unknown keys: tokens cannot enter persisted records.
      const next = schema.parse({ ...load(), [webId]: connections });
      try {
        storage.setItem(CONNECTORS_KEY, JSON.stringify(next));
        unsaved = undefined;
      } catch {
        unsaved = next;
      }
    },
    forResource(url) {
      const document = url.slice(0, url.indexOf("#") < 0 ? url.length : url.indexOf("#"));
      const entries = Object.values(load())
        .flatMap((connections) => Object.entries(connections))
        .filter(([, connection]) => connection.resourceUrls.includes(document));
      return Object.fromEntries(entries);
    },
  };
}
const preferences = createConnectorPreferences({
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});
export const connectionsForResource = (url: string): Connections => preferences.forResource(url);
const listeners = new Set<() => void>();

export function useConnectors(webId: string) {
  const [state, setState] = useState<{ webId: string; connections: Connections }>({
    webId,
    connections: {},
  });
  useEffect(() => {
    const sync = () => setState({ webId, connections: preferences.read(webId) });
    sync();
    listeners.add(sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONNECTORS_KEY || event.key === null) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [webId]);
  const update = useCallback(
    (id: string, action: ConnectionAction) => {
      const current = preferences.read(webId);
      const next = connectionReducer(current[id], action);
      preferences.write(webId, { ...current, [id]: next });
      for (const listener of listeners) listener();
      return next;
    },
    [webId],
  );
  return [state.webId === webId ? state.connections : {}, update] as const;
}
