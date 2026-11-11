// AUTHORED-BY Codex GPT-6.1
"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ConnectionState } from "../lib/connectivity";

/** The shell supplies its reachability monitor; native apps can use the browser alone. */
export const ConnectionContext = createContext<{
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ConnectionState;
} | null>(null);

const browserState = (): ConnectionState => (navigator.onLine ? "online" : "offline");
function subscribeBrowser(onChange: () => void) {
  addEventListener("online", onChange);
  addEventListener("offline", onChange);
  return () => {
    removeEventListener("online", onChange);
    removeEventListener("offline", onChange);
  };
}

/** Connection status without importing account backends or the web demo pod. */
export function useConnectionState(): ConnectionState {
  const connection = useContext(ConnectionContext);
  return useSyncExternalStore(
    connection?.subscribe ?? subscribeBrowser,
    connection?.getSnapshot ?? browserState,
    () => "online",
  );
}
