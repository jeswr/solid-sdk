// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type ConnectionAction,
  type Connections,
  type ConnectorConnection,
  connectionReducer,
  demoResources,
} from "../lib/connect/connection-state";

export const CONNECTORS_KEY = "suite.connectors.v2";
const LEGACY_KEY = "suite.connectors.v1";
export const connectorKey = (webId: string, id: string) =>
  `${CONNECTORS_KEY}:${JSON.stringify([webId, id])}`;
const connectionSchema = z.object({
  connectedAt: z.iso.datetime(),
  lastSync: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  lastOutcome: z.enum(["ok", "incomplete", "error"]),
  added: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  mode: z.enum(["demo", "live", "file"]),
  resourceUrls: z.array(z.url()),
  demoResourceUrls: z.array(z.url()).optional(),
});
const schema = z.record(z.string(), z.record(z.string(), connectionSchema));
type Envelope = z.infer<typeof schema>;

/** Each account/connector owns one key. Same-connector imports hold its Web Lock;
 * different connectors never replace each other's records, even across tabs. */
export interface ConnectorPreferences {
  read(webId: string): Connections;
  write(webId: string, id: string, connection: ConnectorConnection): void;
  forResource(url: string): Connections;
}
export function createConnectorPreferences(
  storage: Pick<Storage, "getItem" | "setItem" | "key" | "length">,
): ConnectorPreferences {
  const unsaved = new Map<string, ConnectorConnection>();
  function load(): Envelope {
    let connections: Envelope = {};
    const keys = new Set(unsaved.keys());
    try {
      // Legacy records remain readable; a per-connector v2 record supersedes its v1 copy.
      const parsed = schema.safeParse(JSON.parse(storage.getItem(LEGACY_KEY) ?? "{}"));
      if (parsed.success) connections = parsed.data;
    } catch {
      /* Corrupt/blocked legacy storage must not hide newer records. */
    }
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(`${CONNECTORS_KEY}:`)) keys.add(key);
      }
    } catch {
      /* Unsaved updates remain available when storage is blocked. */
    }
    for (const key of keys) {
      try {
        const [webId, id] = z
          .tuple([z.string(), z.string()])
          .parse(JSON.parse(key.slice(CONNECTORS_KEY.length + 1)));
        const connection = connectionSchema.parse(
          unsaved.get(key) ?? JSON.parse(storage.getItem(key) ?? "null"),
        );
        connections[webId] = { ...connections[webId], [id]: connection };
      } catch {
        /* Ignore only this corrupt record. */
      }
    }
    return connections;
  }
  return {
    read: (webId) => load()[webId] ?? {},
    write(webId, id, connection) {
      // Parsing also strips unknown keys: tokens cannot enter persisted records.
      const next = connectionSchema.parse(connection);
      const key = connectorKey(webId, id);
      try {
        storage.setItem(key, JSON.stringify(next));
        unsaved.delete(key);
      } catch {
        unsaved.set(key, next);
      }
    },
    forResource(url) {
      const document = url.slice(0, url.indexOf("#") < 0 ? url.length : url.indexOf("#"));
      const entries = Object.values(load())
        .flatMap((connections) => Object.entries(connections))
        .filter(
          ([, connection]) =>
            connection.resourceUrls.includes(document) ||
            demoResources(connection).includes(document),
        );
      return Object.fromEntries(entries);
    },
  };
}
const preferences = createConnectorPreferences({
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  key: (index) => window.localStorage.key(index),
  get length() {
    return typeof window === "undefined" ? 0 : window.localStorage.length;
  },
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
      if (
        event.key?.startsWith(`${CONNECTORS_KEY}:`) ||
        event.key === LEGACY_KEY ||
        event.key === null
      )
        sync();
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
      preferences.write(webId, id, next);
      for (const listener of listeners) listener();
      return next;
    },
    [webId],
  );
  return [state.webId === webId ? state.connections : {}, update] as const;
}
